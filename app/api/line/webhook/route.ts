import crypto from "crypto";
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

type LineMessage = {
  id?: string;
  type?: string;
  text?: string;
};

type LineWebhookEvent = {
  type?: string;
  timestamp?: number;
  source?: LineSource;
  message?: LineMessage;
  postback?: {
    data?: string;
  };
};

type LineWebhookBody = {
  destination?: string;
  events?: LineWebhookEvent[];
};

type LineProfile = {
  displayName?: string;
  pictureUrl?: string;
  statusMessage?: string;
};

function verifyLineSignature(
  rawBody: string,
  signature: string | null
) {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;

  if (!channelSecret) {
    throw new Error("缺少 LINE_CHANNEL_SECRET");
  }

  if (!signature) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac("sha256", channelSecret)
    .update(rawBody)
    .digest("base64");

  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (receivedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    receivedBuffer,
    expectedBuffer
  );
}

function createDocumentId(lineUserId: string) {
  return crypto
    .createHash("sha256")
    .update(lineUserId)
    .digest("hex")
    .slice(0, 40);
}

function getMessageDescription(event: LineWebhookEvent) {
  const message = event.message;

  if (event.type === "follow") {
    return {
      messageType: "follow",
      lastMessage: "【加入好友】",
      messageId: "",
    };
  }

  if (event.type === "unfollow") {
    return {
      messageType: "unfollow",
      lastMessage: "【封鎖或取消好友】",
      messageId: "",
    };
  }

  if (event.type === "postback") {
    return {
      messageType: "postback",
      lastMessage:
        event.postback?.data || "【選單操作】",
      messageId: "",
    };
  }

  if (!message) {
    return {
      messageType: event.type || "unknown",
      lastMessage: "",
      messageId: "",
    };
  }

  if (message.type === "text") {
    return {
      messageType: "text",
      lastMessage: String(message.text || "").slice(0, 500),
      messageId: String(message.id || ""),
    };
  }

  const labels: Record<string, string> = {
    image: "圖片",
    video: "影片",
    audio: "語音",
    file: "檔案",
    location: "位置",
    sticker: "貼圖",
  };

  return {
    messageType: String(message.type || "unknown"),
    lastMessage: `【${
      labels[String(message.type)] ||
      String(message.type || "訊息")
    }】`,
    messageId: String(message.id || ""),
  };
}

async function getLineProfile(
  lineUserId: string
): Promise<LineProfile> {
  const channelAccessToken =
    process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!channelAccessToken) {
    throw new Error(
      "缺少 LINE_CHANNEL_ACCESS_TOKEN"
    );
  }

  const response = await fetch(
    `https://api.line.me/v2/bot/profile/${encodeURIComponent(
      lineUserId
    )}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${channelAccessToken}`,
      },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `LINE Profile API 錯誤：${response.status} ${errorText}`
    );
  }

  return (await response.json()) as LineProfile;
}

async function savePendingLineUser(
  event: LineWebhookEvent
) {
  const source = event.source;
  const lineUserId = String(source?.userId || "").trim();

  if (!lineUserId) {
    return;
  }

  const supportedTypes = [
    "message",
    "follow",
    "unfollow",
    "postback",
  ];

  if (
    !event.type ||
    !supportedTypes.includes(event.type)
  ) {
    return;
  }

  const documentId = createDocumentId(lineUserId);
  const documentRef = adminDb
    .collection("pendingLineUsers")
    .doc(documentId);

  const existingSnapshot = await documentRef.get();
  const existingData = existingSnapshot.exists
    ? existingSnapshot.data() || {}
    : {};

  let profile: LineProfile = {
    displayName: String(existingData.displayName || ""),
    pictureUrl: String(existingData.pictureUrl || ""),
    statusMessage: String(
      existingData.statusMessage || ""
    ),
  };

  if (event.type !== "unfollow") {
    try {
      profile = await getLineProfile(lineUserId);
    } catch (error) {
      console.error(
        "取得 LINE 使用者資料失敗：",
        error
      );
    }
  }

  const messageInfo = getMessageDescription(event);

  await documentRef.set(
    {
      lineUserId,
      displayName: String(profile.displayName || ""),
      pictureUrl: String(profile.pictureUrl || ""),
      statusMessage: String(
        profile.statusMessage || ""
      ),

      sourceType: String(source?.type || "user"),
      groupId: String(source?.groupId || ""),
      roomId: String(source?.roomId || ""),

      eventType: String(event.type || ""),
      messageType: messageInfo.messageType,
      lastMessage: messageInfo.lastMessage,
      lastMessageId: messageInfo.messageId,

      bindingStatus: String(
        existingData.bindingStatus || "pending"
      ),

      boundCustomerId: String(
        existingData.boundCustomerId || ""
      ),

      boundCustomerCode: String(
        existingData.boundCustomerCode || ""
      ),

      boundCustomerName: String(
        existingData.boundCustomerName || ""
      ),

      boundAt: existingData.boundAt || null,

      isFriend: event.type !== "unfollow",

      rawTimestamp: Number(event.timestamp || 0),

      firstSeenAt:
        existingData.firstSeenAt ||
        FieldValue.serverTimestamp(),

      lastSeenAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    {
      merge: true,
    }
  );
}

export async function GET() {
  return NextResponse.json({
    success: true,
    message: "LINE Webhook API 正常運作",
  });
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();

    const signature = request.headers.get(
      "x-line-signature"
    );

    const validSignature = verifyLineSignature(
      rawBody,
      signature
    );

    if (!validSignature) {
      return NextResponse.json(
        {
          success: false,
          message: "LINE 簽章驗證失敗",
        },
        {
          status: 401,
        }
      );
    }

    const body = JSON.parse(rawBody) as LineWebhookBody;

    const events = Array.isArray(body.events)
      ? body.events
      : [];

    await Promise.all(
      events.map((event) =>
        savePendingLineUser(event)
      )
    );

    return NextResponse.json(
      {
        success: true,
        received: events.length,
      },
      {
        status: 200,
      }
    );
  } catch (error) {
    console.error("LINE Webhook 處理失敗：", error);

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "LINE Webhook 處理失敗",
      },
      {
        status: 500,
      }
    );
  }
}