// 특정 학생(류다인) 의 billing 문서 모든 필드 확인 — 담임강사 필드명 추적용
import { readFileSync } from "fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

try {
  const envText = readFileSync("D:/attendance/.env.local", "utf-8");
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
} catch (e) {
  console.error("env load:", e.message);
  process.exit(1);
}

const app = initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
  projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
});
const db = getFirestore(app, "restore20260319");

// 류다인 2026-04 billing 전체
console.log("=== 류다인 2026-04 billing 전체 필드 ===");
const snap = await db
  .collection("billing")
  .where("studentName", "==", "류다인")
  .where("month", "==", "2026-04")
  .get();

for (const d of snap.docs) {
  console.log(`\n--- id: ${d.id} ---`);
  console.log(JSON.stringify(d.data(), null, 2));
}

// 다른 학생도 샘플로 — 강사명이 들어있는 케이스
console.log("\n\n=== 2026-04 billing 첫 10건 — 모든 필드 키 ===");
const sampleSnap = await db
  .collection("billing")
  .where("month", "==", "2026-04")
  .limit(10)
  .get();

const allKeys = new Set();
for (const d of sampleSnap.docs) {
  const data = d.data();
  Object.keys(data).forEach((k) => allKeys.add(k));
  console.log(`\n--- ${data.studentName} / ${data.billingName} ---`);
  console.log(JSON.stringify(data, null, 2));
}

console.log("\n=== 발견된 모든 필드 키 ===");
console.log(Array.from(allKeys).sort());

process.exit(0);
