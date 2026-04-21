import "server-only";

import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * Firebase Admin SDK — 서버 전용
 *   - Firestore Rules를 우회하여 서버 인증 기반으로 안전하게 접근
 *   - ijw-calander 프로젝트의 서비스 계정 키 사용 (동일 Firebase 프로젝트)
 *   - 사용: API 라우트, Server Action 등 서버 환경에서만
 *
 * 필요 환경변수 (.env.local):
 *   FIREBASE_ADMIN_PROJECT_ID
 *   FIREBASE_ADMIN_CLIENT_EMAIL
 *   FIREBASE_ADMIN_PRIVATE_KEY
 */

const DATABASE_ID = "restore20260319";

function buildCredentials() {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  // .env의 "\n" 이스케이프를 실제 개행 문자로 치환
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "[firebase-admin] 필수 환경변수 누락: FIREBASE_ADMIN_PROJECT_ID / FIREBASE_ADMIN_CLIENT_EMAIL / FIREBASE_ADMIN_PRIVATE_KEY 를 .env.local에 설정하세요."
    );
  }

  return { projectId, clientEmail, privateKey };
}

let cachedApp: App | undefined;

function getAdminApp(): App {
  if (cachedApp) return cachedApp;
  const existing = getApps().find((a) => a.name === "admin");
  if (existing) {
    cachedApp = existing;
    return existing;
  }
  const creds = buildCredentials();
  cachedApp = initializeApp(
    {
      credential: cert(creds),
      projectId: creds.projectId,
    },
    "admin"
  );
  return cachedApp;
}

let cachedDb: Firestore | undefined;

/**
 * ijw-calander Firebase의 `restore20260319` DB에 대한 Admin Firestore 인스턴스
 */
export function getAdminDb(): Firestore {
  if (cachedDb) return cachedDb;
  cachedDb = getFirestore(getAdminApp(), DATABASE_ID);
  return cachedDb;
}
