import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LineSource = {
  type?: "user" | "group" | "room";
  userId?: string;
  groupId?: string;
  roomId?: string;
};
type LineMessage = { id?: string; type?: string; text?: string };
type LineEvent = {
  type?: string;
  webhookEventId?: string;
  timestamp?: number;
  source?: LineSource;
  message?: LineMessage;
  postback?: { data?: string };
};
type LineBody = { events?: LineEvent[] };
type Profile = {
  displayName?: string;
  pictureUrl?: string;
  statusMessage?: string;
};

const PROFILE_REFRESH_MS = 24 * 60 * 60 * 1000;
const COLLECTION = "pendingLineUsers";
const MAX_TOKENS = 240;

function verifySignature(body: string, signature: string | null): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function documentId(uid: string) {
  return crypto.createHash("sha256").update(uid).digest("hex").slice(0, 40);
}

function normalize(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFKC").trim().toLowerCase() : "";
}

/**
 * Must stay in sync with tokenize() in app/api/postpaid/line-bindings/route.ts.
 * Iterate by Unicode code point, never by UTF-16 code unit: splitting an emoji
 * with String.slice(i, j) can create a lone surrogate rejected by Firestore.
 */
function searchTokens(values: unknown[]): string[] {
  const tokens = new Set<string>();
  for (const value of values) {
    // Also discard any pre-existing malformed isolated surrogate code points.
    const chars = Array.from(normalize(value))
      .filter((ch) => {
        const cp = ch.codePointAt(0);
        return cp !== undefined && !(cp >= 0xd800 && cp <= 0xdfff);
      })
      .slice(0, 36);

    for (let i = 0; i < chars.length && tokens.size < MAX_TOKENS; i++) {
      for (let j = i + 1; j <= Math.min(chars.length, i + 24) && tokens.size < MAX_TOKENS; j++) {
        tokens.add(chars.slice(i, j).join(""));
      }
    }
    if (tokens.size >= MAX_TOKENS) break;
  }
  return [...tokens];
}

function getEventMessage(event: LineEvent) {
  if (event.type === "follow") return { messageType: "follow", lastMessage: "【加入好友】", lastMessageId: "" };
  if (event.type === "unfollow") return { messageType: "unfollow", lastMessage: "【封鎖或取消好友】", lastMessageId: "" };
  if (event.type === "postback") return { messageType: "postback", lastMessage: "【選單操作】", lastMessageId: "" };
  const message = event.message;
  if (!message) return { messageType: event.type || "unknown", lastMessage: "", lastMessageId: "" };
  const type = String(message.type || "unknown");
  const label: Record<string, string> = {
    image: "圖片", video: "影片", audio: "語音", file: "檔案", location: "位置", sticker: "貼圖",
  };
  return {
    messageType: type,
    lastMessage: type === "text" ? String(message.text || "").slice(0, 500) : `【${label[type] || type}】`,
    lastMessageId: String(message.id || ""),
  };
}

async function fetchProfile(uid: string): Promise<Profile> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("缺少 LINE_CHANNEL_ACCESS_TOKEN");
  const response = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(uid)}`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) throw new Error(`LINE Profile HTTP ${response.status}`);
  return (await response.json()) as Profile;
}

async function processEvent(event: LineEvent): Promise<"stored" | "ignored"> {
  const type = event.type || "";
  if (!["message", "follow", "unfollow", "postback"].includes(type)) return "ignored";
  const uid = String(event.source?.userId || "").trim();
  if (!uid) return "ignored";

  const ref = adminDb.collection(COLLECTION).doc(documentId(uid));
  const before = await ref.get(); // one document lookup, no full collection scan
  const old = before.data() || {};
  const eventId = String(event.webhookEventId || "");
  const info = getEventMessage(event);
  const oldTimestamp = Number(old.rawTimestamp || 0);
  const incomingTimestamp = Number(event.timestamp || 0);
  if (eventId && old.lastWebhookEventId === eventId) return "ignored";
  if (info.lastMessageId && old.lastMessageId === info.lastMessageId) return "ignored";
  if (incomingTimestamp > 0 && oldTimestamp > incomingTimestamp) return "ignored";

  const sourceType = String(event.source?.type || "user");
  const update: Record<string, unknown> = {
    lineUserId: uid,
    sourceType,
    groupId: String(event.source?.groupId || ""),
    roomId: String(event.source?.roomId || ""),
    eventType: type,
    ...info,
    rawTimestamp: incomingTimestamp || oldTimestamp,
    lastSeenAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (!before.exists) {
    update.firstSeenAt = FieldValue.serverTimestamp();
    update.bindingStatus = "pending";
    update.boundCustomerId = "";
    update.boundCustomerCode = "";
    update.boundCustomerName = "";
    update.boundAt = null;
  }
  if (eventId) update.lastWebhookEventId = eventId;
  if (type === "follow") update.isFriend = true;
  else if (type === "unfollow") update.isFriend = false;
  else if (!before.exists && sourceType === "user") update.isFriend = true;
  // A group event does not prove friendship with the official account.

  const lastProfileFetch = old.profileFetchedAt?.toMillis?.() || 0;
  const needsProfile = type !== "unfollow" && (
    !before.exists || !old.displayName || Date.now() - lastProfileFetch >= PROFILE_REFRESH_MS
  );
  let displayName = String(old.displayName || "");
  if (needsProfile) {
    try {
      const profile = await fetchProfile(uid);
      displayName = String(profile.displayName || old.displayName || "");
      update.displayName = displayName;
      update.pictureUrl = String(profile.pictureUrl || old.pictureUrl || "");
      update.statusMessage = String(profile.statusMessage || old.statusMessage || "");
      update.profileFetchedAt = FieldValue.serverTimestamp();
    } catch (error) {
      console.warn("LINE Profile 取得失敗（仍會保存事件）", error instanceof Error ? error.message : error);
      if (!before.exists) {
        update.displayName = "";
        update.pictureUrl = "";
        update.statusMessage = "";
      }
    }
  }

  // New users are indexed on their first event; existing users with missing or
  // outdated tokens are repaired when they interact, with no collection scan.
  const tokens = searchTokens([
    displayName,
    old.adminAlias || "",
    old.boundCustomerCode || "",
    old.boundCustomerName || "",
  ]);
  const previousTokens = Array.isArray(old.searchTokens) ? old.searchTokens : [];
  if (!Array.isArray(old.searchTokens) || JSON.stringify(previousTokens) !== JSON.stringify(tokens)) {
    update.searchTokens = tokens;
  }

  // merge:true preserves existing binding information and account balances.
  await ref.set(update, { merge: true });
  return "stored";
}

export async function GET() {
  return NextResponse.json({ success: true, message: "LINE Webhook endpoint OK（不代表實際事件已寫入）" });
}

export async function POST(request: NextRequest) {
  try {
    const bodyText = await request.text();
    if (!verifySignature(bodyText, request.headers.get("x-line-signature"))) {
      return NextResponse.json({ success: false, message: "LINE 簽章驗證失敗" }, { status: 401 });
    }
    const body = JSON.parse(bodyText) as LineBody;
    const events = Array.isArray(body.events) ? body.events : [];
    let stored = 0;
    for (const event of events) {
      if ((await processEvent(event)) === "stored") stored++;
    }
    console.info("LINE_WEBHOOK_RECEIVED", { received: events.length, stored });
    return NextResponse.json({ success: true, received: events.length, stored });
  } catch (error) {
    console.error("LINE_WEBHOOK_ERROR", error);
    return NextResponse.json({ success: false, message: "LINE Webhook 處理失敗" }, { status: 500 });
  }
}
