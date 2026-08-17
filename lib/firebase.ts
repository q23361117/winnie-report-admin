import { getApp, getApps, initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

/**
 * Firebase 前端設定
 *
 * 所有 NEXT_PUBLIC_FIREBASE_* 環境變數
 * 請放在專案根目錄：
 *
 * .env.local
 */

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId:
    process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

/**
 * 檢查必要 Firebase 環境變數
 *
 * measurementId 不是 Firestore 必要欄位，
 * 所以即使沒有設定也不會阻止系統啟動。
 */
const missingConfig = Object.entries(firebaseConfig)
  .filter(([key, value]) => {
    if (key === "measurementId") {
      return false;
    }

    return !value;
  })
  .map(([key]) => key);

if (missingConfig.length > 0) {
  throw new Error(
    `Firebase 環境變數缺少：${missingConfig.join(", ")}`
  );
}

/**
 * Next.js 開發模式可能會因為 Hot Reload
 * 重複執行模組。
 *
 * 因此：
 * - 已存在 Firebase App → 直接使用
 * - 尚未建立 → initializeApp
 *
 * 避免 Firebase App 重複初始化。
 */
export const firebaseApp =
  getApps().length > 0
    ? getApp()
    : initializeApp(firebaseConfig);

/**
 * Firestore Database
 *
 * 頁面需要即時更新時：
 *
 * import { collection, onSnapshot } from "firebase/firestore";
 * import { db } from "@/lib/firebase";
 *
 * useEffect(() => {
 *   const unsubscribe = onSnapshot(
 *     collection(db, "你的集合名稱"),
 *     (snapshot) => {
 *       // Firebase 資料一更新
 *       // 這裡會立即重新執行
 *     }
 *   );
 *
 *   return unsubscribe;
 * }, []);
 */
export const db = getFirestore(firebaseApp);