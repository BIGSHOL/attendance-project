// 류다인의 students/enrollments 데이터 확인 — billing 의 분반 코드를 어떻게 매칭하는지
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

// 류다인 student 문서
console.log("=== students where name=='류다인' ===");
const snap = await db.collection("students").where("name", "==", "류다인").get();
for (const d of snap.docs) {
  console.log(`\n--- id: ${d.id} ---`);
  console.log(JSON.stringify(d.data(), null, 2));

  const enrollSnap = await db.collection("students").doc(d.id).collection("enrollments").get();
  console.log(`\n  enrollments (${enrollSnap.size}):`);
  for (const e of enrollSnap.docs) {
    console.log(`  - id: ${e.id}`);
    console.log(`    ${JSON.stringify(e.data())}`);
  }
}

// classes / classGroups 같은 컬렉션이 있는지 확인 — MS2B / JJ2I 식별
console.log("\n\n=== 분반 관련 컬렉션 탐색 ===");
const rootCols = await db.listCollections();
for (const c of rootCols) {
  console.log(`- ${c.id}`);
}

process.exit(0);
