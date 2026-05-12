// ijw-calander Firestore(restore20260319 DB) 의 root collection 목록 +
// 각 collection 의 샘플 doc 1건 + 필드 키 + sub-collection 진단
//
// 사용: node scripts/inspectFirestore.mjs

import { readFileSync } from "fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// .env.local 수동 로드
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
  console.error("env 읽기 실패:", e.message);
  process.exit(1);
}

const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

if (!projectId || !clientEmail || !privateKey) {
  console.error("FIREBASE_ADMIN_* env 누락");
  process.exit(1);
}

const app = initializeApp({
  credential: cert({ projectId, clientEmail, privateKey }),
  projectId,
});
const db = getFirestore(app, "restore20260319");

const collections = await db.listCollections();
console.log(`# root collections: ${collections.length}\n`);

for (const col of collections) {
  // 정확한 count
  let count = 0;
  try {
    const agg = await col.count().get();
    count = agg.data().count;
  } catch {
    // count() unavailable on some DBs
  }

  const snap = await col.limit(3).get();
  const sample = snap.docs[0];
  const subColIds = [];
  if (sample) {
    const subs = await sample.ref.listCollections();
    for (const sc of subs) subColIds.push(sc.id);
  }

  console.log(`## ${col.id}  (count=${count})`);
  if (sample) {
    console.log(`   sample id: ${sample.id}`);
    console.log(`   keys: ${Object.keys(sample.data()).join(", ")}`);
    if (subColIds.length > 0) {
      console.log(`   sub-collections: ${subColIds.join(", ")}`);
    }
  }
  console.log();
}

process.exit(0);
