"use client";
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { type FormEvent, useMemo, useState } from "react";

type LineUser = {
  id: string; lineUserId: string; displayName: string; pictureUrl: string;
  statusMessage: string; adminAlias: string; lastMessage: string; eventType: string;
  bindingStatus: string; boundCustomerId: string; boundCustomerCode: string;
  boundCustomerName: string; isFriend: boolean; lastSeenAt?: number;
};
type Customer = {
  id: string; customerCode: string; name: string; phone: string;
  lineUserId: string; status: string;
};
type ApiResult = {
  success: boolean; users: LineUser[]; customers: Customer[];
  hasMore?: boolean; nextCursor?: string | null; note?: string; error?: string;
};

function formatDate(ms?: number) {
  if (!ms) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(ms));
}
function maskUid(uid: string) {
  return uid.length > 12 ? `${uid.slice(0, 7)}••••••${uid.slice(-5)}` : uid || "—";
}

export default function BindPostpaidLinePage() {
  const [users, setUsers] = useState<LineUser[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [keyword, setKeyword] = useState("");
  const [filter, setFilter] = useState("pending");
  const [mode, setMode] = useState<"recent" | "search">("recent");
  const [searched, setSearched] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [indexCursor, setIndexCursor] = useState("");
  const [indexDone, setIndexDone] = useState(false);
  const [indexProgress, setIndexProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);

  async function requestUsers(nextMode: "recent" | "search", query = "", nextCursor: string | null = null, append = false) {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ mode: nextMode });
      if (nextMode === "search") params.set("search", query);
      if (nextCursor) params.set("cursor", nextCursor);
      const response = await fetch(`/api/postpaid/line-bindings?${params.toString()}`, {
        credentials: "same-origin", cache: "no-store",
      });
      const result = (await response.json()) as ApiResult;
      if (!response.ok || !result.success) throw new Error(result.error || "LINE 資料讀取失敗");
      setUsers(prev => append ? [...prev, ...result.users.filter(item => !prev.some(p => p.id === item.id))] : result.users);
      setCustomers(result.customers);
      setCursor(result.nextCursor || null);
      setHasMore(Boolean(result.hasMore));
      setMode(nextMode);
      setSearched(query);
      setLoaded(true);
      setMessage(result.note || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "LINE 資料讀取失敗");
    } finally { setLoading(false); }
  }

  async function searchUsers(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = keyword.trim();
    if (!q || q.length > 24) { setError("搜尋文字請輸入 1 至 24 個字"); return; }
    setFilter("all");
    await requestUsers("search", q);
  }

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/postpaid/line-bindings", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const result = await res.json() as { success?: boolean; error?: string; processed?: number; updated?: number; nextCursor?: string | null; hasMore?: boolean };
    if (!res.ok || !result.success) throw new Error(result.error || "操作失敗");
    return result;
  }

  async function runIndexBatch() {
    if (working || loading || indexDone) return;
    if (!indexCursor && !window.confirm("確定開始分批建立舊 LINE 名單搜尋索引？每次最多讀取 25 筆，不會修改後結餘額或點數。")) return;
    setWorking("index"); setError(""); setMessage("");
    try {
      const r = await post({ action: "indexBatch", cursor: indexCursor });
      setIndexCursor(r.nextCursor || "");
      setIndexProgress(n => n + (r.processed || 0));
      setIndexDone(!r.hasMore);
      setMessage(`本批處理 ${r.processed || 0} 筆，更新 ${r.updated || 0} 筆。${r.hasMore ? "請再按一次繼續下一批。" : "舊資料搜尋索引建立完成。"}`);
    } catch (e) { setError(e instanceof Error ? e.message : "建立索引失敗"); }
    finally { setWorking(""); }
  }

  async function changeBinding(action: "bind" | "unbind", user: LineUser) {
    const customerId = selected[user.id] || "";
    const customer = customers.find(c => c.id === customerId);
    if (action === "bind" && !customer) return setError("請先選擇後結客戶");
    if (action === "bind" && customer?.lineUserId && customer.lineUserId !== user.lineUserId) return setError("這位客戶已綁其他 LINE，請先解除");
    const label = action === "bind" ? `將 ${user.displayName || user.adminAlias || "LINE 使用者"} 綁定至 ${customer?.customerCode}｜${customer?.name}` : `解除 ${user.displayName || user.adminAlias || "LINE 使用者"} 的 LINE 綁定`;
    if (!window.confirm(`確定${label}？此操作不會更動客戶餘額。`)) return;
    setWorking(user.id); setError(""); setMessage("");
    try {
      await post({ action, pendingId: user.id, customerId });
      setMessage(action === "bind" ? "綁定成功，未更改後結餘額與點數。" : "解除綁定成功。");
      await requestUsers(mode, searched);
    } catch (e) { setError(e instanceof Error ? e.message : "操作失敗"); }
    finally { setWorking(""); }
  }

  async function saveAlias(user: LineUser) {
    const alias = window.prompt("輸入管理員搜尋別名（例如：天／自搭百折）。這不會修改 LINE 官方聊天室名稱。", user.adminAlias);
    if (alias === null) return;
    setWorking(user.id); setError("");
    try {
      await post({ action: "setAlias", pendingId: user.id, alias });
      setUsers(old => old.map(u => u.id === user.id ? { ...u, adminAlias: alias.slice(0, 36).trim() } : u));
      setMessage("搜尋別名已儲存");
    } catch (e) { setError(e instanceof Error ? e.message : "別名儲存失敗"); }
    finally { setWorking(""); }
  }

  const activeCustomers = customers.filter(c => c.status === "active");
  const filtered = useMemo(() => users.filter(u => filter === "all" || (filter === "bound" ? u.bindingStatus === "bound" : u.bindingStatus !== "bound")), [users, filter]);
  const pendingCount = users.filter(u => u.bindingStatus !== "bound").length;
  const boundCount = users.filter(u => u.bindingStatus === "bound").length;

  return (
    <main className="min-h-screen bg-[#f4f7fb] px-5 py-8 text-slate-900">
      <div className="mx-auto max-w-7xl">
        <header className="mb-7 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-emerald-700">LINE 官方帳號綁定</p>
            <h1 className="mt-1 text-3xl font-bold">後結 LINE 使用者綁定</h1>
            <p className="mt-2 text-sm text-slate-500">按需讀取最近傳訊客人；已建立索引的名稱可直接搜尋。</p>
          </div>
          <div className="flex gap-3">
            <Link href="/postpaid" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">返回後結帳務</Link>
            <Link href="/postpaid/new" className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white">新增後結客戶</Link>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl bg-white p-6 shadow-sm"><p className="text-sm text-slate-500">本次已載入待綁定</p><p className="mt-3 text-3xl font-bold text-amber-600">{pendingCount} 位</p></div>
          <div className="rounded-2xl bg-white p-6 shadow-sm"><p className="text-sm text-slate-500">本次已載入已綁定</p><p className="mt-3 text-3xl font-bold text-emerald-600">{boundCount} 位</p></div>
          <div className="rounded-2xl bg-white p-6 shadow-sm"><p className="text-sm text-slate-500">可選後結客戶</p><p className="mt-3 text-3xl font-bold text-blue-600">{activeCustomers.length} 位</p></div>
        </section>

        {(error || message) && <div className={`mt-5 rounded-xl p-4 text-sm ${error ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-800"}`}>{error || message}</div>}

        <section className="mt-5 rounded-2xl bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold">LINE 使用者名單</h2>
            <button type="button" disabled={loading || Boolean(working)} onClick={() => { setFilter("all"); void requestUsers("recent"); }} className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">載入最新 20 位</button>
          </div>
          <p className="mt-2 text-xs text-slate-500">不會在開啟頁面時自動查詢 Firebase。LINE 官方人工自訂的聊天室名稱需在此另設搜尋別名。</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <select value={filter} onChange={e => setFilter(e.target.value)} className="rounded-xl border px-4 py-3 text-sm">
              <option value="pending">等待綁定</option><option value="bound">已綁定</option><option value="all">全部</option>
            </select>
            <form onSubmit={searchUsers} className="flex min-w-[280px] flex-1 flex-wrap gap-2">
              <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="搜尋原始暱稱、管理別名、客戶代號" className="min-w-[220px] flex-1 rounded-xl border px-4 py-3 text-sm" />
              <button disabled={loading || Boolean(working)} className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">索引搜尋</button>
            </form>
            <button type="button" disabled={loading || Boolean(working)} onClick={() => { setKeyword(""); setFilter("all"); void requestUsers("recent"); }} className="rounded-xl border px-4 py-3 text-sm">清除並看最新</button>
          </div>
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
            <p className="font-semibold text-amber-900">舊有 LINE 名單一次性補建搜尋索引</p>
            <p className="mt-1 text-amber-800">每按一次最多處理 25 筆；已有的客戶綁定、餘額、集點均不變。若 Firestore 今日配額已滿，請等額度恢復再執行。</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" disabled={loading || Boolean(working) || indexDone} onClick={() => void runIndexBatch()} className="rounded-lg bg-amber-700 px-4 py-2 font-semibold text-white disabled:opacity-50">{working === "index" ? "建立中..." : indexDone ? "索引已完成" : indexCursor ? "繼續下一批（25 筆）" : "開始分批建索引"}</button>
              <span className="text-xs text-amber-800">本次已檢查 {indexProgress} 筆</span>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {loading && <div className="py-10 text-center text-slate-500">讀取中...</div>}
            {!loading && !loaded && <div className="rounded-xl border border-dashed p-12 text-center text-slate-500">尚未查詢。點「載入最新 20 位」查看最近收到訊息的客人。</div>}
            {!loading && loaded && filtered.length === 0 && <div className="rounded-xl border border-dashed p-12 text-center text-slate-500">目前沒有符合篩選條件的 LINE 使用者。若是舊資料，請先分批補建索引。</div>}
            {!loading && filtered.map(user => (
              <article key={user.id} className="flex flex-col gap-4 rounded-2xl border border-slate-200 p-5 xl:flex-row xl:items-center">
                <div className="flex min-w-0 flex-1 items-start gap-4">
                  {user.pictureUrl ? <img src={user.pictureUrl} alt="LINE 頭像" className="h-16 w-16 shrink-0 rounded-xl object-cover" /> : <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-2xl">👤</div>}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-lg">{user.displayName || "未取得 LINE 暱稱"}</strong>
                      <span className={`rounded-full px-2 py-1 text-xs ${user.bindingStatus === "bound" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{user.bindingStatus === "bound" ? "已綁定" : "待綁定"}</span>
                      {!user.isFriend && <span className="rounded-full bg-red-100 px-2 py-1 text-xs text-red-700">可能已封鎖</span>}
                    </div>
                    {user.adminAlias && <p className="mt-1 text-sm text-blue-700">管理別名：{user.adminAlias}</p>}
                    <p className="mt-2 break-words text-sm text-slate-600">最近訊息：{user.lastMessage || "—"}</p>
                    <p className="mt-1 text-xs text-slate-400">最後互動：{formatDate(user.lastSeenAt)}｜UID：{maskUid(user.lineUserId)}</p>
                    {user.bindingStatus === "bound" && <p className="mt-1 text-sm text-emerald-700">已綁定：{user.boundCustomerCode}｜{user.boundCustomerName}</p>}
                    <button type="button" disabled={Boolean(working)} onClick={() => void saveAlias(user)} className="mt-2 text-sm font-semibold text-blue-600 underline disabled:opacity-50">設定搜尋別名</button>
                  </div>
                </div>
                {user.bindingStatus === "bound" ? (
                  <button type="button" disabled={Boolean(working) || loading} onClick={() => void changeBinding("unbind", user)} className="rounded-xl bg-red-50 px-5 py-3 text-sm font-bold text-red-700 disabled:opacity-50">解除綁定</button>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    <select value={selected[user.id] || ""} onChange={e => setSelected(old => ({ ...old, [user.id]: e.target.value }))} className="min-w-[220px] rounded-xl border px-3 py-3 text-sm">
                      <option value="">選擇要綁定的後結客戶</option>
                      {activeCustomers.map(c => <option key={c.id} value={c.id}>{c.customerCode}｜{c.name}{c.lineUserId ? "（已綁 LINE）" : ""}</option>)}
                    </select>
                    <button type="button" disabled={Boolean(working) || loading} onClick={() => void changeBinding("bind", user)} className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">確認綁定</button>
                  </div>
                )}
              </article>
            ))}
          </div>
          {mode === "recent" && hasMore && <div className="mt-5 text-center"><button type="button" disabled={loading || Boolean(working)} onClick={() => void requestUsers("recent", "", cursor, true)} className="rounded-xl border px-5 py-3 text-sm font-bold disabled:opacity-50">載入更多 20 位</button></div>}
        </section>
      </div>
    </main>
  );
}
