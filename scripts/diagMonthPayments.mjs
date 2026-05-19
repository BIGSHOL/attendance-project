// monthPayments "state 변형 사고" 검증
//   가설: monthPayments(709) 는 /api/billing 기본 카테고리 필터(수업,원복) 적용된 정상값.
//        비교 대상 828건은 categories=all 응답 → 119건 차이는 교재/차량비.
//   Firebase billing 을 직접 읽어 API 필터를 재현하고 차이를 분해한다.
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

const MONTH = "2026-04";
const DEFAULT_CATEGORIES = new Set(["수업", "원복"]);

// /api/billing 의 일반 모드 필터를 그대로 재현 (route.ts line 189-195)
const passesFilter = (r) =>
  DEFAULT_CATEGORIES.has(r.category || "") &&
  !((r.billingName || "").includes("교재"));

const snap = await db.collection("billing").where("month", "==", MONTH).get();
const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

const filtered = rows.filter(passesFilter);
const excluded = rows.filter((r) => !passesFilter(r));

console.log(`=== /api/billing?month=${MONTH} 필터 재현 ===`);
console.log(`전체 billing                       : ${rows.length}건  (= categories=all 응답)`);
console.log(`필터 통과 (수업+원복, 교재명 제외)  : ${filtered.length}건  (= 기본 응답 = monthPayments)`);
console.log(`필터 제외                          : ${excluded.length}건`);

// 제외 행 분해
const exclCat = new Map();
for (const r of excluded) {
  const cat = r.category || "(빈값)";
  const byName =
    DEFAULT_CATEGORIES.has(cat) && (r.billingName || "").includes("교재");
  const key = byName ? `${cat}+billingName에교재` : cat;
  exclCat.set(key, (exclCat.get(key) || 0) + 1);
}
console.log("\n제외 119건 분해:");
for (const [k, v] of [...exclCat.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(24)} ${v}건`);
}

// 이승민 / 김주연 상세 — billedAmount / paidAmount 둘 다
for (const name of ["이승민", "김주연"]) {
  console.log(`\n=== ${name} (month=${MONTH}) ===`);
  const mine = rows.filter((r) => r.studentName === name);
  if (mine.length === 0) {
    console.log("  (해당 학생 billing 없음)");
    continue;
  }
  // 학교별로 묶기 (동명이인 구분)
  const bySchool = new Map();
  for (const r of mine) {
    const sch = r.school || "(빈학교)";
    if (!bySchool.has(sch)) bySchool.set(sch, []);
    bySchool.get(sch).push(r);
  }
  for (const [sch, list] of bySchool.entries()) {
    console.log(`  [학교: ${sch}]`);
    let allBilled = 0,
      filtBilled = 0,
      allPaid = 0,
      filtPaid = 0;
    for (const r of list) {
      const pass = passesFilter(r);
      const billed = Number(r.billedAmount) || 0;
      const paid = Number(r.paidAmount) || 0;
      allBilled += billed;
      allPaid += paid;
      if (pass) {
        filtBilled += billed;
        filtPaid += paid;
      }
      console.log(
        `    [${pass ? "통과" : "제외"}] cat=${(r.category || "").padEnd(4)} ` +
          `billed=${String(billed).padStart(8)} paid=${String(paid).padStart(8)} ` +
          `name="${r.billingName}"`
      );
    }
    console.log(
      `    → billed: 전체 ${allBilled} / 필터 ${filtBilled} / 차이 ${allBilled - filtBilled}`
    );
    console.log(
      `    → paid  : 전체 ${allPaid} / 필터 ${filtPaid} / 차이 ${allPaid - filtPaid}`
    );
  }
}

process.exit(0);
