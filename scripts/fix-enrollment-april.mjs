// 박지율 + 김선아 김민주 enrollment startDate 정정
// 사용:
//   DRY=1 node scripts/fix-enrollment-april.mjs   # 변경만 미리 보기
//   node scripts/fix-enrollment-april.mjs         # 실제 적용
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "fs";

// .env.local 수동 파싱
const envText = readFileSync(".env.local", "utf-8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z][A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  let val = m[2];
  if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
  process.env[m[1]] = val;
}

const DRY = !!process.env.DRY;
const NEW_START = "2026-04-01";
const TEACHER_ID = "김민주";

const app = initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
});
const db = getFirestore(app, "restore20260319");

const studentIds = ["박지율_침산초_초6", "김선아_칠성초_초6"];

console.log(`Mode: ${DRY ? "DRY-RUN (변경 없음)" : "APPLY (실제 적용)"}`);
console.log(`Target: ${TEACHER_ID} active enrollments → startDate = ${NEW_START}\n`);

let totalUpdated = 0;
for (const sid of studentIds) {
  const ref = db.collection("students").doc(sid);
  const docSnap = await ref.get();
  if (!docSnap.exists) {
    console.log(`✗ Student doc not found: ${sid}\n`);
    continue;
  }
  const data = docSnap.data();
  console.log(`=== ${sid} (${data.name} ${data.school} ${data.grade}) ===`);

  const enrSnap = await ref.collection("enrollments").get();
  for (const eDoc of enrSnap.docs) {
    const e = eDoc.data();
    const isTeacher = e.staffId === TEACHER_ID || e.teacher === TEACHER_ID;
    const isActive = !e.endDate;
    const tag = isTeacher
      ? isActive
        ? "[TARGET]"
        : "[김민주 but endDate set]"
      : "[other teacher]";
    console.log(
      `  ${eDoc.id} ${tag} staffId=${e.staffId} className=${e.className} start=${e.startDate} end=${e.endDate || "(empty)"}`
    );

    if (isTeacher && isActive && e.startDate !== NEW_START) {
      const action = `startDate: ${e.startDate} → ${NEW_START}`;
      if (DRY) {
        console.log(`    → WOULD UPDATE: ${action}`);
      } else {
        await eDoc.ref.update({ startDate: NEW_START });
        console.log(`    → UPDATED: ${action}`);
      }
      totalUpdated++;
    }
  }
  console.log();
}

console.log(`Summary: ${totalUpdated} enrollment(s) ${DRY ? "would be" : ""} updated.`);
console.log(DRY ? "Re-run without DRY=1 to apply." : "Done. Refresh /api/students cache (or reload the page) to see changes.");
