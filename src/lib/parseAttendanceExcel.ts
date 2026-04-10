import * as XLSX from "xlsx";

export interface AttendanceEntry {
  studentName: string;
  school: string;
  grade: string;
  attendance: Record<string, number>; // "YYYY-MM-DD" → 0|1 (빈칸 제외)
}

export interface ParsedAttendance {
  teacherName: string;
  year: number;
  month: number; // 1~12
  billingMonth: string; // "YYYYMM"
  dateColumns: string[];
  entries: AttendanceEntry[];
}

type Cell = string | number | null | undefined;
type Row = Cell[];

/**
 * 2D 배열 기반 파서 (XLSX와 Google Sheets API 응답 둘 다 지원)
 * 포맷: A1=담임명, B1="YY.MM", 5행=헤더, 6행부터 학생
 * - 학생 이름 B열(1), 학교 D열(3), 학년 E열(4)
 * - 날짜 컬럼 R열(17)부터 "MM/DD (요일)"
 */
export function parseAttendanceFromArray(data: Row[]): ParsedAttendance {
  if (!data || data.length < 6) {
    throw new Error("시트 데이터가 너무 짧습니다.");
  }

  // 담임명 + 월 추출
  const teacherName = String(data[0]?.[0] || "").trim();
  const monthCell = String(data[0]?.[1] || "").trim(); // "26.03"
  const monthMatch = monthCell.match(/(\d{2})\.(\d{1,2})/);
  if (!teacherName || !monthMatch) {
    throw new Error("시트 상단에 담임명(A1) 또는 월(B1)을 찾을 수 없습니다.");
  }
  const year = 2000 + parseInt(monthMatch[1]);
  const month = parseInt(monthMatch[2]);
  const billingMonth = `${year}${String(month).padStart(2, "0")}`;

  // 헤더 행 (인덱스 4)
  const header = data[4] || [];
  const dateColMap: { colIdx: number; date: string }[] = [];
  for (let c = 17; c < header.length; c++) {
    const cell = String(header[c] || "").trim();
    const m = cell.match(/(\d{1,2})\/(\d{1,2})/);
    if (m) {
      const mm = parseInt(m[1]);
      const dd = parseInt(m[2]);
      // 엑셀 월보다 작으면 다음해로 보정 (12월 → 1월 넘어갈 때)
      let y = year;
      if (mm < month) y = year + 1;
      const date = `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
      dateColMap.push({ colIdx: c, date });
    }
  }
  const dateColumns = dateColMap.map((d) => d.date);

  // 학생 행 (6행부터)
  const entries: AttendanceEntry[] = [];
  for (let r = 5; r < data.length; r++) {
    const row = data[r];
    if (!row) continue;
    const name = String(row[1] || "").trim();
    if (!name) continue;

    const school = String(row[3] || "").trim();
    const grade = String(row[4] || "").trim();

    const attendance: Record<string, number> = {};
    for (const { colIdx, date } of dateColMap) {
      const v = row[colIdx];
      if (v === "" || v === null || v === undefined) continue;
      const n = Number(v);
      if (isNaN(n)) continue;
      attendance[date] = n;
    }

    entries.push({ studentName: name, school, grade, attendance });
  }

  return {
    teacherName,
    year,
    month,
    billingMonth,
    dateColumns,
    entries,
  };
}

/**
 * XLSX 버퍼 → 파싱
 */
export function parseAttendanceExcel(buffer: ArrayBuffer): ParsedAttendance {
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<Row>(ws, {
    header: 1,
    raw: false,
    defval: "",
  });
  return parseAttendanceFromArray(data);
}
