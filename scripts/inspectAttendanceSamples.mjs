// Supabase attendance 5월 샘플 — student_id 패턴 확인
import { readFileSync } from "fs";
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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

console.log("=== 5월 attendance 전체 카운트 ===");
const { count: cnt5 } = await supabase
  .from("attendance")
  .select("*", { count: "exact", head: true })
  .gte("date", "2026-05-01")
  .lte("date", "2026-05-31");
console.log(`  5월: ${cnt5} rows`);

const { count: cnt4 } = await supabase
  .from("attendance")
  .select("*", { count: "exact", head: true })
  .gte("date", "2026-04-01")
  .lte("date", "2026-04-30");
console.log(`  4월: ${cnt4} rows`);

console.log("\n=== 5월 attendance 샘플 10건 ===");
const { data: sample } = await supabase
  .from("attendance")
  .select("*")
  .gte("date", "2026-05-01")
  .lte("date", "2026-05-31")
  .limit(10);
for (const r of sample || []) {
  console.log(`  date=${r.date} teacher_id=${r.teacher_id} student_id=${r.student_id} hours=${r.hours}`);
}

console.log("\n=== student_id 패턴 분포 (5월) ===");
const { data: idSample } = await supabase
  .from("attendance")
  .select("student_id")
  .gte("date", "2026-05-01")
  .lte("date", "2026-05-31")
  .limit(2000);
const patternCount = new Map();
for (const r of idSample || []) {
  const sid = r.student_id || "";
  let pat = "other";
  if (sid.startsWith("virtual_")) pat = "virtual_*";
  else if (/^[가-힣]+_[가-힣]+_/.test(sid)) pat = "이름_학교_학년";
  else if (/^[가-힣]+_/.test(sid)) pat = "이름_*";
  patternCount.set(pat, (patternCount.get(pat) || 0) + 1);
}
console.log(Object.fromEntries(patternCount));

console.log("\n=== 김은정 / 김화영 강사의 5월 student_id (학생들) ===");
for (const tid of ["김은정", "김화영", "이승아"]) {
  const { data: tRows } = await supabase
    .from("attendance")
    .select("student_id, date, hours")
    .eq("teacher_id", tid)
    .gte("date", "2026-05-01")
    .lte("date", "2026-05-31");
  const studentSet = new Set(tRows?.map((r) => r.student_id));
  console.log(`  teacher_id="${tid}" : ${tRows?.length || 0} rows, ${studentSet.size} unique students`);
  // 류다인 매칭되는 id 있는지
  for (const sid of studentSet) {
    if (sid?.includes("류다인")) console.log(`    류다인 매칭 → ${sid}`);
  }
}

process.exit(0);
