// Firebase billing collection 샘플 + sync log 확인
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

// 1) billing 샘플 3건
console.log("=== billing — 샘플 3건 ===");
const billingSnap = await db.collection("billing").limit(3).get();
for (const d of billingSnap.docs) {
  console.log(JSON.stringify({ id: d.id, ...d.data() }, null, 2));
  console.log("---");
}

// 2) month 값 분포 (전체 billing 의 month 컬럼)
console.log("\n=== billing.month 값 분포 ===");
const allSnap = await db.collection("billing").select("month", "category", "status").get();
const monthCount = new Map();
const categoryCount = new Map();
const statusCount = new Map();
for (const d of allSnap.docs) {
  const data = d.data();
  monthCount.set(data.month, (monthCount.get(data.month) || 0) + 1);
  categoryCount.set(data.category, (categoryCount.get(data.category) || 0) + 1);
  statusCount.set(data.status, (statusCount.get(data.status) || 0) + 1);
}
console.log("month:", JSON.stringify(Object.fromEntries([...monthCount.entries()].sort()), null, 2));
console.log("category:", JSON.stringify(Object.fromEntries(categoryCount), null, 2));
console.log("status:", JSON.stringify(Object.fromEntries(statusCount), null, 2));

// 3) 2026-04 billing 만 카운트 + 첫 5건 한 줄 요약
console.log("\n=== billing where month=='2026-04' ===");
for (const candidate of ["2026-04", "202604", "2026/04", "2026.04"]) {
  const s = await db.collection("billing").where("month", "==", candidate).get();
  console.log(`  month==${candidate} : ${s.size}건`);
}

// 4) 가장 최근 sync log
console.log("\n=== makeEduBillingSyncLogs 최근 ===");
const logSnap = await db
  .collection("makeEduBillingSyncLogs")
  .orderBy("executedAt", "desc")
  .limit(3)
  .get();
for (const d of logSnap.docs) {
  console.log(JSON.stringify({ id: d.id, ...d.data() }, null, 2));
}

// 5) textbook_billings 샘플
console.log("\n=== textbook_billings 샘플 1건 ===");
const tbSnap = await db.collection("textbook_billings").limit(1).get();
for (const d of tbSnap.docs) {
  console.log(JSON.stringify({ id: d.id, ...d.data() }, null, 2));
}

process.exit(0);
