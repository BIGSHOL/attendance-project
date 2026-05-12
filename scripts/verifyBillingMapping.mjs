// Firebase billing ↔ Supabase payments 류다인 케이스 1:1 비교
// 강사 추출 로직도 함께 검증

import { readFileSync } from "fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createClient } from "@supabase/supabase-js";

// .env.local
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

// Firebase
const app = initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
  projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
});
const fsDb = getFirestore(app, "restore20260319");

// Supabase — SERVICE_ROLE_KEY 미설정 시 비교 단계 skip
const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sb = sbKey
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, sbKey)
  : null;

// 강사 추출 함수 (TS 와 동일 로직 — extractTeacherFromBillingName.ts)
function extractTeacher(billingName, staff) {
  if (!billingName) return {};
  const tokens = billingName.split(/[\s_()\[\]]+/).filter(Boolean);
  for (const t of tokens) {
    const f = staff.find((s) => s.englishName && s.englishName === t);
    if (f) return { staffId: f.id, teacherName: f.name };
  }
  for (const t of tokens) {
    const f = staff.find((s) => s.name === t);
    if (f) return { staffId: f.id, teacherName: f.name };
  }
  for (const t of tokens) {
    const f = staff.find((s) => s.name.length >= 3 && t.startsWith(s.name));
    if (f) return { staffId: f.id, teacherName: f.name };
  }
  return {};
}

// 1) staff 로드
const staffSnap = await fsDb.collection("staff").where("status", "==", "active").get();
const staff = staffSnap.docs.map((d) => {
  const data = d.data();
  return { id: d.id, name: data.name, englishName: data.englishName };
});
console.log(`staff: ${staff.length}명 (active)`);

// 2) 류다인 4월 billing
const ryuBilling = await fsDb
  .collection("billing")
  .where("studentName", "==", "류다인")
  .where("month", "==", "2026-04")
  .get();
const ryuFB = ryuBilling.docs.map((d) => {
  const data = d.data();
  const m = extractTeacher(data.billingName, staff);
  return {
    id: d.id,
    billingName: data.billingName,
    billed: data.billedAmount,
    paid: data.paidAmount,
    discount: data.discountAmount,
    paidDate: data.paidDate,
    category: data.category,
    teacherName: m.teacherName || "(none)",
    teacherStaffId: m.staffId || "(none)",
  };
});

// 3) Supabase 류다인 4월 payments
let ryuSB = [];
if (sb) {
  const { data, error } = await sb
    .from("payments")
    .select("*")
    .eq("student_name", "류다인")
    .eq("billing_month", "202604");
  if (error) console.log("[supabase] err:", error.message);
  ryuSB = data || [];
}

console.log("\n=== 류다인 4월 — Firebase billing ===");
console.log(JSON.stringify(ryuFB, null, 2));

console.log("\n=== 류다인 4월 — Supabase payments ===");
console.log(
  JSON.stringify(
    (ryuSB || []).map((p) => ({
      id: p.id,
      payment_name: p.payment_name,
      charge: p.charge_amount,
      paid: p.paid_amount,
      discount: p.discount_amount,
      payment_date: p.payment_date,
      teacher_name: p.teacher_name,
      teacher_staff_id: p.teacher_staff_id,
    })),
    null,
    2
  )
);

// 4) 합계 비교
const fbSum = {
  billed: ryuFB.reduce((a, b) => a + b.billed, 0),
  paid: ryuFB.reduce((a, b) => a + b.paid, 0),
};
const sbSum = {
  billed: ryuSB.reduce((a, b) => a + b.charge_amount, 0),
  paid: ryuSB.reduce((a, b) => a + b.paid_amount, 0),
};
console.log("\n=== 합계 비교 ===");
console.log("Firebase:", fbSum);
console.log("Supabase:", sbSum);

// 5) 강사 매칭 통계 — 4월 전체 billing
const aprAll = await fsDb.collection("billing").where("month", "==", "2026-04").get();
const stat = { total: 0, matchedEng: 0, matchedKor: 0, none: 0, byCategory: {} };
const unmatchedSamples = [];
for (const d of aprAll.docs) {
  const data = d.data();
  stat.total++;
  stat.byCategory[data.category] = (stat.byCategory[data.category] || 0) + 1;
  const m = extractTeacher(data.billingName, staff);
  if (m.staffId) {
    // 영어/한국 구분
    const found = staff.find((s) => s.id === m.staffId);
    if (found?.englishName && data.billingName?.includes(found.englishName)) stat.matchedEng++;
    else stat.matchedKor++;
  } else {
    stat.none++;
    if (data.category === "수업" && unmatchedSamples.length < 5) {
      unmatchedSamples.push(data.billingName);
    }
  }
}
console.log("\n=== 4월 billing 강사 매칭 통계 ===");
console.log(JSON.stringify(stat, null, 2));
console.log("\n수업 카테고리 강사 매칭 실패 샘플:");
for (const s of unmatchedSamples) console.log("  -", s);

process.exit(0);
