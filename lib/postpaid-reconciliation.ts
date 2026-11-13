import "server-only";
import crypto from "node:crypto";
import { adminDb } from "@/lib/firebase-admin";

/**
 * Winnie 後結唯讀對帳：報表讀取不觸動 Firestore，帳本按客戶代號有限量查詢。
 * 需要把 Google Sheets 分享給 FIREBASE_SERVICE_ACCOUNT_BASE64 內的 client_email，
 * 並在相同 Google Cloud project 啟用 Google Sheets API。
 */
const REPORTS = {
  "2026-10": "12voznV1LuUdXEEswI3iHiV1seAhOc2DSrKThRPd7Vfc",
  "2026-11": "1bYKuBjuLJQGBk7Bu-daOxrlITXxojB63zRACXCqj2Ew",
} as const;

export type ReportMonth = keyof typeof REPORTS;
export const SCAN_MONTHS = Object.keys(REPORTS) as ReportMonth[];
const MAX_CODES = 80;
const MAX_TRANSACTION_ROWS_PER_CODE = 350;
const MAX_WORKSHEET_ROWS = 2000;
const SCANNABLE_TABS = [
  "⚖️維尼", "⚖️0666後結", "⚖️快+50", "⚖️天+50", "⚖️調度丟單",
  "⚖️SF+50", "⚖️啾咪+50", "⚖️全全省+50",
  "⚖️店1/大統領中清路一段53號", "取消費登記",
];

export type ReconcileEntry = {
  key: string;
  month: string;
  sheet: string;
  row: number;
  date: string;
  code: string;
  originalCode: string;
  order: string;
  charge: number;
  payment: number;
};

export type ReconcileAccount = {
  code: string;
  name: string;
  firestoreCustomerId: string | null;
  currentBalance: number | null;
  openingBalance: number | null;
  reportCount: number;
  reportCharge: number;
  reportPayment: number;
  ledgerCount: number;
  ledgerCharge: number;
  ledgerPayment: number;
  chargeDifference: number;
  paymentDifference: number;
  hasTruncatedLedger: boolean;
  status: "MATCH_TOTALS" | "DIFFERENCE" | "MISSING_CUSTOMER" | "INCOMPLETE";
  rows: ReconcileEntry[];
  warnings: string[];
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function money(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : 0;
  const raw = text(value).replace(/,/g, "").replace(/[ＮＴ＄$元\s]/g, "");
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? Math.round(numeric) : 0;
}

function codeOf(raw: unknown): string {
  const fragments = text(raw).toUpperCase().split(/[\/／|｜,，、\s]+/).filter(Boolean);
  const code = fragments.find((s) => !/^V\d{2,}$/.test(s)) || "";
  // 只將 059 視為 0059；不改寫 其他編號，避免未經確認的跨戶合併。
  return code === "059" ? "0059" : code;
}

function colIndex(headers: unknown[], choices: string[]): number {
  return headers.findIndex((h) => choices.some((s) => text(h).replace(/[\s／/]/g, "").includes(s)));
}

function sheetNameA1(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

async function sheetsToken(): Promise<string> {
  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (!encoded) throw new Error("環境變數缺少 FIREBASE_SERVICE_ACCOUNT_BASE64");
  const credentials = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as {
    client_email?: string; private_key?: string;
  };
  if (!credentials.client_email || !credentials.private_key) throw new Error("Service Account 不完整");
  const now = Math.floor(Date.now() / 1000);
  const jwtHeader = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const jwtPayload = base64url(JSON.stringify({
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3500,
  }));
  const unsigned = `${jwtHeader}.${jwtPayload}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), credentials.private_key);
  const assertion = `${unsigned}.${base64url(signature)}`;
  const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", body, cache: "no-store", signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json() as {access_token?: string; error_description?: string};
  if (!response.ok || !payload.access_token) {
    throw new Error(`Google Sheets 授權失敗：${payload.error_description || response.status}`);
  }
  return payload.access_token;
}

async function readMonth(month: ReportMonth, accessToken: string): Promise<ReconcileEntry[]> {
  const spreadsheetId = REPORTS[month];
  // BatchGet 只讀指定分頁的前 2000 行，避開逐格呼叫。
  const params = new URLSearchParams({ valueRenderOption: "FORMATTED_VALUE" });
  for (const tab of SCANNABLE_TABS) params.append("ranges", `${sheetNameA1(tab)}!A1:R${MAX_WORKSHEET_ROWS}`);
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(45000) },
  );
  if (!response.ok) {
    const payload = (await response.text()).slice(0, 500);
    throw new Error(`${month} Google 報表讀取失敗 (${response.status})；請確認已分享試算表給服務帳號並啟用 Sheets API。${payload}`);
  }
  const data = await response.json() as { valueRanges?: Array<{range?: string;values?: unknown[][]}> };
  const collected: ReconcileEntry[] = [];
  (data.valueRanges || []).forEach((range, tabIndex) => {
    const sheet = SCANNABLE_TABS[tabIndex];
    const rows = range.values || [];
    const headers = rows[0] || [];
    const codeCol = colIndex(headers, ["客人代號", "客戶代號"]);
    const orderCol = colIndex(headers, ["單號"]);
    const dateCol = colIndex(headers, ["日期"]);
    const chargeCol = colIndex(headers, ["後結"]);
    const paymentCol = colIndex(headers, ["儲值收款", "收款儲值", "儲值"]);
    // 後結與代號欄不齊全時不猜測對應欄位；只有「天+50」允許空白代號歸天。
    if (dateCol < 0 || chargeCol < 0 || orderCol < 0 || (codeCol < 0 && sheet !== "⚖️天+50")) return;
    rows.slice(2).forEach((row, index) => {
      const lineNumber = index + 3;
      const date = text(row[dateCol]);
      const order = text(row[orderCol]);
      if (!date || !order) return;
      const originalCode = codeCol >= 0 ? text(row[codeCol]) : "";
      const code = codeOf(originalCode) || (sheet === "⚖️天+50" ? "天" : "");
      if (!code) return;
      const charge = money(row[chargeCol]);
      const payment = paymentCol >= 0 ? money(row[paymentCol]) : 0;
      if (charge === 0 && payment === 0) return; // 現金單不計入後結。
      // 日期必須落於目前月；避免表格誤貼跨月資料。
      const parts = date.match(/^(\d{1,2})\s*[\/\-]\s*(\d{1,2})/);
      if (!parts || Number(parts[1]) !== Number(month.slice(5))) return;
      collected.push({
        key: `${month}:${sheet}:${lineNumber}`,
        month, sheet, row: lineNumber, date, code, originalCode, order,
        charge, payment,
      });
    });
  });
  return collected;
}

function ledgerMonth(value: unknown): string {
  return text(value).slice(0, 7);
}

export async function reconcilePostpaid(months: ReportMonth[]): Promise<{
  months: string[]; generatedAt: string; scannedSheets: number; scannedRows: number;
  firestoreDocumentReadsUpperBound: number; accounts: ReconcileAccount[]; warnings: string[];
}> {
  if (months.length < 1 || months.length > 2 || months.some((month) => !(month in REPORTS))) {
    throw new Error("只允許選擇 2026-10 與 2026-11");
  }
  const accessToken = await sheetsToken();
  const batches = await Promise.all(months.map((month) => readMonth(month, accessToken)));
  const entries = batches.flat();
  const grouped = new Map<string, ReconcileEntry[]>();
  entries.forEach((entry) => grouped.set(entry.code, [...(grouped.get(entry.code) || []), entry]));
  if (grouped.size > MAX_CODES) throw new Error(`客戶超過 ${MAX_CODES} 位，請縮小掃描月份以保護讀取配額`);
  const warnings: string[] = [];
  // 按客戶查必要帳本，不下載整個 postpaidTransactions 集合。
  const accounts: ReconcileAccount[] = [];
  let estimatedReads = 0;
  for (const [code, rows] of grouped) {
    if (estimatedReads + MAX_TRANSACTION_ROWS_PER_CODE > 15000) {
      warnings.push("達本次保守讀取預算，後續客戶未核對；請分月份重新掃描");
      break;
    }
    const docId = crypto.createHash("sha256").update(code).digest("hex").slice(0, 40);
    const customerSnap = await adminDb.collection("postpaidCustomers").doc(docId).get();
    estimatedReads += 1;
    const customer = customerSnap.exists ? customerSnap.data() || {} : {};
    const codesToLookup = code === "0059" ? ["0059", "059"] : [code];
    let ledgerRows: Array<Record<string, unknown>> = [];
    let truncated = false;
    for (const lookup of codesToLookup) {
      const snapshot = await adminDb.collection("postpaidTransactions")
        .where("customerCode", "==", lookup)
        .limit(MAX_TRANSACTION_ROWS_PER_CODE + 1)
        .get();
      estimatedReads += snapshot.size;
      if (snapshot.size > MAX_TRANSACTION_ROWS_PER_CODE) truncated = true;
      ledgerRows = ledgerRows.concat(snapshot.docs.slice(0, MAX_TRANSACTION_ROWS_PER_CODE).map((d) => ({ id: d.id, ...d.data() })));
    }
    const valid = ledgerRows.filter((d) =>
      text(d.status) !== "reversed" && text(d.source) === "google_sheets_report" && months.includes(ledgerMonth(d.rideDate) as ReportMonth),
    );
    const bookedCharge = valid.reduce((sum, row) => sum + money(row.chargeAmount), 0);
    const bookedPayment = valid.reduce((sum, row) => sum + money(row.paymentAmount), 0);
    const reportCharge = rows.reduce((sum, row) => sum + row.charge, 0);
    const reportPayment = rows.reduce((sum, row) => sum + row.payment, 0);
    const issues: string[] = [];
    if (truncated) issues.push("交易文件達查詢上限，結果不完整，禁止據此修正");
    if (!customerSnap.exists) issues.push("找不到客戶主檔；需先建立或確認客戶代號");
    if (code === "天") issues.push("天為分頁歸帳規則；需確認後台客戶代號也設定為「天」");
    if (code === "0532") issues.push("人工確認欠款 -430 且乘車金已用完；月總額不等於最終餘額");
    const differences = reportCharge !== bookedCharge || reportPayment !== bookedPayment || rows.length !== valid.length;
    accounts.push({
      code, name: text(customer.name) || code,
      firestoreCustomerId: customerSnap.exists ? customerSnap.id : null,
      currentBalance: customerSnap.exists ? money(customer.balance) : null,
      openingBalance: customerSnap.exists && customer.openingBalance != null ? money(customer.openingBalance) : null,
      reportCount: rows.length, reportCharge, reportPayment,
      ledgerCount: valid.length, ledgerCharge: bookedCharge, ledgerPayment: bookedPayment,
      chargeDifference: reportCharge - bookedCharge,
      paymentDifference: reportPayment - bookedPayment,
      hasTruncatedLedger: truncated,
      status: truncated ? "INCOMPLETE" : !customerSnap.exists ? "MISSING_CUSTOMER" : differences ? "DIFFERENCE" : "MATCH_TOTALS",
      rows, warnings: issues,
    });
  }
  accounts.sort((a, b) => a.code.localeCompare(b.code, "zh-TW"));
  return { months, generatedAt: new Date().toISOString(), scannedSheets: months.length * SCANNABLE_TABS.length,
    scannedRows: entries.length, firestoreDocumentReadsUpperBound: estimatedReads, accounts, warnings };
}
