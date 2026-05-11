// 김민주 선생님 26.04 시트 vs Supabase 비교 진단 스크립트
// 사용: node scripts/compare-kimminju.mjs
import { JWT } from "google-auth-library";
import { createClient } from "@supabase/supabase-js";
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

const SHEET_ID = "1QDOae3XsO1-Q26TJV-SLDYShMSmb18M2C7L0NxOl7sc";
const TAB = "26.04";

// 1) 시트 fetch
async function fetchSheet() {
  const jwt = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const { token } = await jwt.getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?ranges=${encodeURIComponent(`${TAB}!A1:AZ500`)}&includeGridData=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets API failed ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const rowData = data.sheets?.[0]?.data?.[0]?.rowData || [];
  const values = rowData.map((r) =>
    (r.values || []).map((c) => c?.formattedValue ?? "")
  );
  return values;
}

// 2) 시트에서 학생 행 + 일자 컬럼 + 출석값 + 금액 컬럼 추출
function parseSheet(values) {
  // header row 5 (index 4) 에 컬럼 라벨, dates 시작은 컬럼 R (index 17) 부근
  const headerRow = values[4] || [];
  const dateCols = [];
  for (let c = 0; c < headerRow.length; c++) {
    const cell = String(headerRow[c] || "").trim();
    const m = cell.match(/^(\d{2})\/(\d{2})/);
    if (m) {
      dateCols.push({ col: c, date: `2026-${m[1]}-${m[2]}` });
    }
  }

  // 금액 컬럼: J=회당단가(9), K=발행예정(10), L=납입금액(11), M=금액정산용(12), N=실급여(13)
  const num = (v) => {
    const s = String(v || "").replace(/[원,\s]/g, "").trim();
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  };

  // students: 6행부터 시작, B열=이름, D열=학교, E열=학년
  const students = [];
  for (let r = 5; r < values.length; r++) {
    const name = String(values[r]?.[1] || "").trim();
    if (!name) continue;
    const school = String(values[r]?.[3] || "").trim();
    const grade = String(values[r]?.[4] || "").trim();
    const cells = {};
    let total = 0;
    for (const dc of dateCols) {
      const v = String(values[r]?.[dc.col] || "").trim();
      if (v) {
        cells[dc.date] = v;
        const x = parseFloat(v);
        if (!isNaN(x)) total += x;
      }
    }
    students.push({
      row: r + 1,
      name,
      school,
      grade,
      cells,
      total,
      // 금액 컬럼
      unitPrice: num(values[r]?.[9]),    // J 회당단가
      issueAmount: num(values[r]?.[10]), // K 발행예정금액
      paidAmount: num(values[r]?.[11]),  // L 납입금액
      settleAmount: num(values[r]?.[12]),// M 금액 정산용
      realSalary: num(values[r]?.[13]),  // N 실급여
    });
  }
  return { dateCols, students };
}

// 3) Supabase attendance 조회 (김민주 + 2026-04)
async function fetchSupabase() {
  // service_role 키가 없으니 anon — RLS 통과 가능한지 확인
  const supa = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  // 0) RLS 진단 — 전체 카운트 / 다른 월
  const { count: totalCount, error: countErr } = await supa
    .from("attendance")
    .select("*", { count: "exact", head: true });
  console.log(`[RLS check] attendance 전체 count: ${totalCount ?? "?"}, err: ${countErr?.message || "none"}`);

  const { data: mar, error: marErr } = await supa
    .from("attendance")
    .select("teacher_id, date, hours")
    .gte("date", "2026-03-01")
    .lte("date", "2026-03-31")
    .limit(3);
  console.log(`[RLS check] 2026-03 sample (${mar?.length ?? 0} rows):`, mar?.slice(0, 3), marErr?.message || "");

  // 1) 전체 attendance 2026-04 의 distinct teacher_id 먼저 확인
  const { data: allApr, error: allErr } = await supa
    .from("attendance")
    .select("teacher_id, student_id, date, hours")
    .gte("date", "2026-04-01")
    .lte("date", "2026-04-30")
    .limit(5000);
  if (allErr) console.error("[attendance all 2026-04] error:", allErr);
  const allRows = allApr || [];
  const teacherIds = [...new Set(allRows.map((a) => a.teacher_id))];
  console.log(`\n[diagnostic] 2026-04 attendance 전체: ${allRows.length} rows, ${teacherIds.length} unique teacher_id`);
  console.log(`[diagnostic] teacher_id samples:`, teacherIds.slice(0, 20));

  // 김민주 포함하는 teacher_id 찾기
  const kimTids = teacherIds.filter((t) => t && t.includes("김민주"));
  console.log(`[diagnostic] 김민주 포함 teacher_id: `, kimTids);

  const { data: virtuals, error: vErr } = await supa
    .from("virtual_students")
    .select("*")
    .ilike("teacher_staff_id", "%김민주%");
  if (vErr) console.error("[virtual_students] error:", vErr);

  // 김민주의 attendance (kimTids 모두 합치기)
  const attByName = allRows.filter((a) => kimTids.includes(a.teacher_id));

  return { virtuals: virtuals || [], attendance: attByName, kimTids, totalAprRows: allRows.length };
}

// 4) main
const sheetValues = await fetchSheet();
const { dateCols, students: sheetStudents } = parseSheet(sheetValues);

// JSON 출력 (다른 곳에서 import 가능)
if (process.env.JSON_OUT) {
  const jsonData = {
    dateCols: dateCols,
    students: sheetStudents.map((s) => ({
      name: s.name,
      school: s.school,
      grade: s.grade,
      total: s.total,
      cells: s.cells,
      unitPrice: s.unitPrice,
      issueAmount: s.issueAmount,
      paidAmount: s.paidAmount,
      settleAmount: s.settleAmount,
      realSalary: s.realSalary,
    })),
  };
  // 행정/메타 row 필터링
  jsonData.students = jsonData.students.filter(
    (s) => !/^행정\d*$/.test(s.name) && !/^\d+$/.test(s.name) && s.name.length >= 2
  );
  console.log(JSON.stringify(jsonData, null, 2));
  process.exit(0);
}

const { virtuals, attendance } = await fetchSupabase();

// 4-a. 시트 합계
const sheetTotal = sheetStudents.reduce((s, st) => s + st.total, 0);
console.log("=== SHEET 26.04 ===");
console.log(`  date cols: ${dateCols.length} (${dateCols[0]?.date} ~ ${dateCols[dateCols.length - 1]?.date})`);
console.log(`  student rows (non-empty name): ${sheetStudents.length}`);
console.log(`  total hours (sum of all cells): ${sheetTotal.toFixed(2)}`);

// 4-b. Supabase 합계 by student_id
const attByStudent = new Map();
for (const a of attendance) {
  const arr = attByStudent.get(a.student_id) || [];
  arr.push(a);
  attByStudent.set(a.student_id, arr);
}
const supaTotal = attendance.reduce((s, a) => s + (parseFloat(a.hours) || 0), 0);
console.log("\n=== SUPABASE attendance 2026-04 김민주 ===");
console.log(`  total rows: ${attendance.length}`);
console.log(`  unique student_ids: ${attByStudent.size}`);
console.log(`  total hours: ${supaTotal.toFixed(2)}`);
console.log(`  unique teacher_ids: ${[...new Set(attendance.map((a) => a.teacher_id))].join(", ")}`);

// 4-c. virtual_students
console.log("\n=== Supabase virtual_students for 김민주 ===");
console.log(`  rows: ${virtuals.length}`);
console.log(`  sample ids:`, virtuals.slice(0, 5).map((v) => v.id));

// 4-d. 학생 단위 비교
console.log("\n=== STUDENT-LEVEL COMPARISON ===");
const supaNameByStudentId = new Map();
for (const v of virtuals) supaNameByStudentId.set(v.id, v.name);

const sheetByName = new Map();
for (const s of sheetStudents) {
  const key = `${s.name}|${s.school}`;
  sheetByName.set(key, s);
}

// sheet 학생 별 — supabase attendance 매칭 시도
const mismatches = [];
const matched = [];
const unmatchedFromSheet = [];

// 학생 매칭: 시트 학생을 supabase virtual_students 와 매칭 + attendance 합계
for (const sStudent of sheetStudents) {
  // virtual_students 에서 같은 이름 + 학교 찾기
  const matchVirt = virtuals.find(
    (v) => v.name === sStudent.name && (v.school || "") === sStudent.school
  );
  if (!matchVirt) {
    unmatchedFromSheet.push(sStudent);
    continue;
  }
  // supabase attendance 합계
  const studentAtts = attendance.filter((a) => a.student_id === matchVirt.id);
  const supaHours = studentAtts.reduce((s, a) => s + (parseFloat(a.hours) || 0), 0);
  if (Math.abs(supaHours - sStudent.total) > 0.01) {
    mismatches.push({
      name: sStudent.name,
      school: sStudent.school,
      grade: sStudent.grade,
      sheetTotal: sStudent.total,
      supaTotal: supaHours,
      diff: supaHours - sStudent.total,
      virtualId: matchVirt.id,
      attCount: studentAtts.length,
      sheetCells: sStudent.cells,
      supaDates: studentAtts.map((a) => `${a.date}=${a.hours}`),
    });
  } else {
    matched.push({ name: sStudent.name, hours: sStudent.total });
  }
}

console.log(`\n[match] sheet 학생 ${sheetStudents.length} 중`);
console.log(`  ✓ supabase 와 시수 일치: ${matched.length}명`);
console.log(`  ✗ 시수 불일치: ${mismatches.length}명`);
console.log(`  ✗ supabase virtual_students 에 없음: ${unmatchedFromSheet.length}명`);

console.log("\n=== MISMATCHES (sheet vs supabase 시수 불일치) ===");
for (const m of mismatches.slice(0, 20)) {
  console.log(
    `  ${m.name} (${m.school} ${m.grade}): sheet=${m.sheetTotal.toFixed(1)}h supa=${m.supaTotal.toFixed(1)}h diff=${m.diff.toFixed(1)}h`
  );
}
if (mismatches.length > 20) console.log(`  ... +${mismatches.length - 20} more`);

console.log("\n=== UNMATCHED FROM SHEET (virtual_students 에 없음) ===");
for (const u of unmatchedFromSheet.slice(0, 30)) {
  console.log(`  ${u.name} (${u.school} ${u.grade}): sheet ${u.total.toFixed(1)}h`);
}
if (unmatchedFromSheet.length > 30) console.log(`  ... +${unmatchedFromSheet.length - 30} more`);

// 4-e. supabase 에만 있는 학생 (시트엔 없음)
const sheetNamesSet = new Set(sheetStudents.map((s) => `${s.name}|${s.school}`));
const supaOnlyVirtuals = virtuals.filter(
  (v) => !sheetNamesSet.has(`${v.name}|${v.school || ""}`)
);
console.log(`\n=== SUPABASE virtual_students 에는 있지만 sheet 에 없음 ===`);
console.log(`  ${supaOnlyVirtuals.length}명`);
for (const v of supaOnlyVirtuals.slice(0, 20)) {
  const att = attendance.filter((a) => a.student_id === v.id);
  const hours = att.reduce((s, a) => s + (parseFloat(a.hours) || 0), 0);
  console.log(`  ${v.name} (${v.school || "—"}): virtual_id=${v.id} attendance=${att.length}rows, ${hours.toFixed(1)}h`);
}
if (supaOnlyVirtuals.length > 20) console.log(`  ... +${supaOnlyVirtuals.length - 20} more`);
