import {
  cert,
  getApps,
  initializeApp,
} from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

type FirebaseServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

function getServiceAccount(): FirebaseServiceAccount {
  const encoded =
    process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;

  if (!encoded) {
    throw new Error(
      "缺少 FIREBASE_SERVICE_ACCOUNT_BASE64"
    );
  }

  try {
    const jsonText = Buffer.from(
      encoded.trim(),
      "base64"
    ).toString("utf8");

    const serviceAccount = JSON.parse(
      jsonText
    ) as FirebaseServiceAccount;

    if (
      !serviceAccount.project_id ||
      !serviceAccount.client_email ||
      !serviceAccount.private_key
    ) {
      throw new Error(
        "Firebase 服務帳戶資料不完整"
      );
    }

    return serviceAccount;
  } catch (error) {
    throw new Error(
      `Firebase 服務帳戶解析失敗：${
        error instanceof Error
          ? error.message
          : "未知錯誤"
      }`
    );
  }
}

const serviceAccount = getServiceAccount();

const adminApp =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({
        credential: cert({
          projectId: serviceAccount.project_id,
          clientEmail: serviceAccount.client_email,
          privateKey: serviceAccount.private_key,
        }),
      });

export const adminDb = getFirestore(adminApp);