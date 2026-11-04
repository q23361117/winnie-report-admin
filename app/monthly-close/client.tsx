"use client";

import { useCallback, useEffect, useState } from "react";

type Archive = {
  id?: string;
  month?: string;
  archived?: boolean;
  verified?: boolean;
  archiveSpreadsheetId?: string;
  spreadsheetId?: string;
  archiveSpreadsheetName?: string;
  spreadsheetName?: string;
  archiveUrl?: string;
  reportUrl?: string;
};

type ArchiveResponse = {
  success?: boolean;
  months?: Archive[];
  message?: string;
};

const LIVE_ID = "1bYKuBjuLJQGBk7Bu-daOxrlITXxojB63zRACXCqj2Ew";
const ARCHIVE_10_ID = "12voznV1LuUdXEEswI3iHiV1seAhOc2DSrKThRPd7Vfc";

function safeSheetUrl(value: string | undefined, fallbackId?: string) {
  if (value) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol === "https:" && parsed.hostname === "docs.google.com" && parsed.pathname.startsWith("/spreadsheets/d/")) {
        return parsed.toString();
      }
    } catch {
      // Use the recorded spreadsheet ID instead.
    }
  }
  const id = fallbackId || "";
  return /^[A-Za-z0-9_-]{20,}$/.test(id)
    ? `https://docs.google.com/spreadsheets/d/${id}/edit`
    : null;
}

export default function MonthlyClosePage() {
  const [archives, setArchives] = useState<Archive[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  const loadArchives = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/report-archives", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(`讀取失敗（HTTP ${response.status}）`);
      const data = (await response.json()) as ArchiveResponse;
      if (!data.success || !Array.isArray(data.months)) {
        throw new Error(data.message || "伺服器未回傳正確的封存清單");
      }
      setArchives(data.months.filter((item) => item.id !== "init"));
      setLoaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "無法讀取歷史封存");
    } finally {
      setLoading(false);
    }
  }, []);

  // Don't read Firestore on page entry. The list loads only after a click.
  // This page never calls any mutation / rollover endpoint.
  useEffect(() => {
    document.title = "每月報表管理中心｜車隊後台";
  }, []);

  const card: React.CSSProperties = {
    border: "1px solid #e2e8f0", borderRadius: 16,
    background: "white", padding: 22, boxShadow: "0 2px 8px rgba(15,23,42,.04)",
  };
  const link: React.CSSProperties = {
    display: "inline-block", padding: "10px 15px", borderRadius: 10,
    color: "white", background: "#2563eb", textDecoration: "none", fontWeight: 600,
  };

  return (
    <main style={{ minHeight: "100vh", background: "#f5f7fb", color: "#0f172a", padding: "32px 18px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <a href="/" style={{ color: "#475569", textDecoration: "none" }}>← 返回營運總覽</a>
        <header style={{ margin: "24px 0" }}>
          <p style={{ margin: 0, color: "#2563eb", fontWeight: 700 }}>月結與歷史報表</p>
          <h1 style={{ fontSize: 30, margin: "8px 0" }}>每月報表管理中心</h1>
          <p style={{ color: "#64748b", margin: 0 }}>查詢目前工作報表及歷史封存；本頁為安全唯讀模式。</p>
        </header>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px,1fr))", gap: 16 }}>
          <div style={card}>
            <p style={{ color: "#64748b", marginTop: 0 }}>目前工作月份</p>
            <h2 style={{ fontSize: 27, margin: "8px 0" }}>2026 年 11 月</h2>
            <p style={{ color: "#166534" }}>工作報表已啟用（先前核對結果）</p>
            <a href={safeSheetUrl(undefined, LIVE_ID) || "#"} target="_blank" rel="noopener noreferrer" style={link}>開啟工作報表</a>
          </div>
          <div style={card}>
            <p style={{ color: "#64748b", marginTop: 0 }}>上個月歷史封存</p>
            <h2 style={{ fontSize: 27, margin: "8px 0" }}>2026 年 10 月</h2>
            <p style={{ color: "#166534" }}>已完成封存（先前核對結果）</p>
            <a href={safeSheetUrl(undefined, ARCHIVE_10_ID) || "#"} target="_blank" rel="noopener noreferrer" style={link}>開啟歷史副本</a>
          </div>
          <div style={card}>
            <p style={{ color: "#64748b", marginTop: 0 }}>正式換月功能</p>
            <h2 style={{ fontSize: 27, margin: "8px 0" }}>尚未開放</h2>
            <p style={{ color: "#b45309" }}>需先完成後結、集點及封存核對</p>
            <button type="button" disabled style={{ padding: "10px 15px", border: 0, borderRadius: 10, color: "#64748b", background: "#e2e8f0", cursor: "not-allowed" }}>一鍵換月（停用）</button>
          </div>
        </section>

        <section style={{ ...card, marginTop: 18 }}>
          <div style={{ display: "flex", gap: 16, justifyContent: "space-between", flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <h2 style={{ margin: "0 0 5px" }}>歷史封存清單</h2>
              <p style={{ margin: 0, color: "#64748b", fontSize: 14 }}>只有按下查詢才會呼叫後台 API；不自動刷新。</p>
            </div>
            <button onClick={() => void loadArchives()} disabled={loading} style={{ ...link, border: 0, cursor: loading ? "wait" : "pointer", opacity: loading ? 0.6 : 1 }}>
              {loading ? "查詢中…" : "查詢歷史封存"}
            </button>
          </div>
          {error && <p role="alert" style={{ color: "#b91c1c" }}>{error}</p>}
          {loaded && (
            archives.length === 0 ? <p style={{ color: "#64748b" }}>目前沒有查到歷史月份。</p> :
            <div style={{ overflowX: "auto", marginTop: 18 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                <thead><tr style={{ borderBottom: "1px solid #cbd5e1" }}><th style={{ padding: 12 }}>月份</th><th style={{ padding: 12 }}>封存狀態</th><th style={{ padding: 12 }}>驗證狀態</th><th style={{ padding: 12 }}>歷史副本</th></tr></thead>
                <tbody>
                  {archives.map((entry, index) => {
                    const id = entry.archiveSpreadsheetId || entry.spreadsheetId;
                    const url = safeSheetUrl(entry.archiveUrl || entry.reportUrl, id);
                    return <tr key={`${entry.id || entry.month || "month"}-${index}`} style={{ borderBottom: "1px solid #e2e8f0" }}>
                      <td style={{ padding: 12 }}>{entry.month || entry.id || "未命名"}</td>
                      <td style={{ padding: 12 }}>{entry.archived === true ? "已封存" : "尚未確認"}</td>
                      <td style={{ padding: 12 }}>{entry.verified === true ? "已標記驗證" : "未驗證"}</td>
                      <td style={{ padding: 12 }}>{url ? <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb" }}>開啟副本</a> : "無連結"}</td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section style={{ ...card, marginTop: 18, borderLeft: "4px solid #eab308" }}>
          <h2 style={{ marginTop: 0 }}>換月前安全檢查</h2>
          <p style={{ color: "#475569", marginBottom: 0 }}>必須確認後結交易、會員集點、LINE 通知及報表副本一致，才能在未來版本啟用正式換月。此頁沒有清空、重新入帳或修改 Firestore 的操作。</p>
        </section>
      </div>
    </main>
  );
}
