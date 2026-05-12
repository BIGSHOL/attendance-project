// 류다인 attendance 매칭 검증
//   1) Supabase attendance 에 5월 류다인 row 가 있는지
//   2) attendance.student_id 가 firebase student.id 또는 virtual_id 와 매칭되는지
//   3) studentChecks 의 studentToGroup 매칭이 정상인지
import { readFileSync } from "fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createClient } from "@supabase/supabase-js";

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
const db = getFirestore(app, "restore20260319");

// Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

console.log("=== 1) firebase students 의 류다인 id ===");
const fbSnap = await db.collection("students").where("name", "==", "류다인").get();
for (const d of fbSnap.docs) {
  console.log(`  ${d.id}  (school=${d.data().school}, grade=${d.data().grade})`);
}

console.log("\n=== 2) virtual_students 의 류다인 row ===");
const { data: virtualRows } = await supabase
  .from("virtual_students")
  .select("*")
  .eq("name", "류다인");
for (const v of virtualRows || []) {
  console.log(`  id=${v.id}  name=${v.name}  school=${v.school}  grade=${v.grade}  teacher=${v.teacher_staff_id}  class=${v.class_name}`);
}

console.log("\n=== 3) Supabase attendance 5월 류다인 행 ===");
// firebase id 패턴 + virtual_ 패턴 둘 다 시도
const allLikelyIds = ["류다인_수창초_초5"];
for (const v of virtualRows || []) allLikelyIds.push(v.id);

for (const sid of allLikelyIds) {
  const { data: attRows } = await supabase
    .from("attendance")
    .select("*")
    .eq("student_id", sid)
    .gte("date", "2026-05-01")
    .lte("date", "2026-05-31")
    .order("date");
  console.log(`  student_id="${sid}" : ${attRows?.length || 0} rows`);
  for (const r of attRows || []) {
    console.log(`    ${r.date} teacher=${r.teacher_id} hours=${r.hours} class=${r.class_name}`);
  }
}

console.log("\n=== 4) 5월 attendance 에서 student_id LIKE '%류다인%' ===");
const { data: likeRows } = await supabase
  .from("attendance")
  .select("*")
  .ilike("student_id", "%류다인%")
  .gte("date", "2026-05-01")
  .lte("date", "2026-05-31")
  .order("date");
console.log(`  ${likeRows?.length || 0} rows`);
for (const r of likeRows || []) {
  console.log(`    student_id="${r.student_id}" date=${r.date} teacher=${r.teacher_id} hours=${r.hours}`);
}

console.log("\n=== 5) 4월 attendance 도 같이 보자 ===");
for (const sid of allLikelyIds) {
  const { data: attRows } = await supabase
    .from("attendance")
    .select("*")
    .eq("student_id", sid)
    .gte("date", "2026-04-01")
    .lte("date", "2026-04-30")
    .order("date");
  console.log(`  student_id="${sid}" : ${attRows?.length || 0} rows`);
  for (const r of attRows || []) {
    console.log(`    ${r.date} teacher=${r.teacher_id} hours=${r.hours}`);
  }
}

process.exit(0);
