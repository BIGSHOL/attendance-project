// 정산 버그 진단:
//   1) 2026-04 billing 중 teacher 매칭 비율 (수학 강사 청구에 teacher 정보 없는지)
//   2) 한 수학 강사 케이스로 payment_shares 가 있는데 billing 만 본 paidAmount 결과
//
// 가설: Firebase billing 은 수학 분반 청구에서 강사 정보 부재 →
//   computeTeacherMonthPayroll 의 비-영어 분기에서 paidAmountByStudent Map 비어있음 →
//   calculateStats 가 `Map.get(id) ?? 0` 로 학생 paidAmount=0 처리 →
//   Math.min(0, gross)=0 → 비율제 학생 급여 0 → 수학 강사 실급여 폭락.

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

// 1) staff 로딩
const staffSnap = await db.collection("staff").where("status", "==", "active").get();
const staff = staffSnap.docs.map(d => ({ id: d.id, ...d.data() }));
console.log(`staff active: ${staff.length}`);

function extractTeacherFromBillingName(billingName, staff) {
  if (!billingName) return {};
  const tokens = billingName.split(/[\s_()\[\]]+/).filter(Boolean);
  for (const t of tokens) {
    const found = staff.find(s => s.englishName && s.englishName === t);
    if (found) return { staffId: found.id, teacherName: found.name };
  }
  for (const t of tokens) {
    const found = staff.find(s => s.name === t);
    if (found) return { staffId: found.id, teacherName: found.name };
  }
  for (const t of tokens) {
    const found = staff.find(s => s.name.length >= 3 && t.startsWith(s.name));
    if (found) return { staffId: found.id, teacherName: found.name };
  }
  return {};
}

// 2) 2026-04 billing 매칭 비율 (category 수업/원복 만)
const billingSnap = await db.collection("billing").where("month", "==", "2026-04").get();
const all = billingSnap.docs.map(d => d.data());
const filtered = all.filter(b =>
  ["수업","원복"].includes(b.category || "") &&
  !(b.billingName || "").includes("교재")
);
console.log(`\n=== 2026-04 billing rows (수업/원복, 교재 제외): ${filtered.length} ===`);

let matched = 0, unmatched = 0;
const unmatchedSamples = [];
const matchByEnglish = new Map();  // 영어이름 매칭은 영어강사 청구
const matchByKorean = new Map();   // 한국이름 매칭

for (const b of filtered) {
  const r = extractTeacherFromBillingName(b.billingName, staff);
  if (r.staffId) {
    matched++;
    const sf = staff.find(s => s.id === r.staffId);
    if (sf?.englishName && b.billingName.includes(sf.englishName)) {
      matchByEnglish.set(r.teacherName, (matchByEnglish.get(r.teacherName) || 0) + 1);
    } else {
      matchByKorean.set(r.teacherName, (matchByKorean.get(r.teacherName) || 0) + 1);
    }
  } else {
    unmatched++;
    if (unmatchedSamples.length < 8) {
      unmatchedSamples.push(b.billingName);
    }
  }
}

console.log(`매칭 성공: ${matched} (${(matched/filtered.length*100).toFixed(1)}%)`);
console.log(`매칭 실패: ${unmatched} (${(unmatched/filtered.length*100).toFixed(1)}%)`);

console.log(`\n영어이름으로 매칭된 강사:`);
for (const [k,v] of [...matchByEnglish.entries()].sort((a,b)=>b[1]-a[1])) {
  console.log(`  ${k}: ${v}건`);
}
console.log(`\n한국이름으로 매칭된 강사 (수학/기타 가능성):`);
for (const [k,v] of [...matchByKorean.entries()].sort((a,b)=>b[1]-a[1])) {
  console.log(`  ${k}: ${v}건`);
}
console.log(`\n매칭 실패 billingName 샘플 (보통 수학/과학 분반 코드):`);
for (const n of unmatchedSamples) console.log(`  "${n}"`);

// 3) 청구액 합산 — 매칭 성공/실패 별
const totalCharge = filtered.reduce((a,b)=>a+(Number(b.billedAmount)||0),0);
const matchedCharge = filtered.filter(b => extractTeacherFromBillingName(b.billingName, staff).staffId)
  .reduce((a,b)=>a+(Number(b.billedAmount)||0),0);
const unmatchedCharge = totalCharge - matchedCharge;
console.log(`\n=== 2026-04 청구액 분포 ===`);
console.log(`전체: ${totalCharge.toLocaleString()}원`);
console.log(`매칭 성공 (teacher_name 채워짐): ${matchedCharge.toLocaleString()}원`);
console.log(`매칭 실패 (teacher_name="", computeTeacherMonthPayroll 비-영어 분기에서 누락): ${unmatchedCharge.toLocaleString()}원`);
