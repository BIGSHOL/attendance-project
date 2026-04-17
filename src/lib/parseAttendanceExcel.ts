import * as XLSX from "xlsx";

export interface AttendanceEntry {
  studentName: string;
  school: string;
  grade: string;
  /** F열 — 급여 tier 명 (예: "중등 3T"). SalarySettingItem.name과 매칭 */
  tierName: string;
  /** C열 — 수업 요일 배열 (예: ["화","금"]). 분반 식별용 */
  days: string[];
  attendance: Record<string, number>; // "YYYY-MM-DD" → 0|1 (빈칸 제외)
  memos: Record<string, string>;      // "YYYY-MM-DD" → 메모 텍스트 (빈값 제외)
}

export interface ParsedAttendance {
  teacherName: string;
  year: number;
  month: number; // 1~12
  billingMonth: string; // "YYYYMM"
  dateColumns: string[];
  /** 탭이 실제로 커버하는 최소 날짜 (YYYY-MM-DD) */
  minDate: string | null;
  /** 탭이 실제로 커버하는 최대 날짜 (YYYY-MM-DD) */
  maxDate: string | null;
  entries: AttendanceEntry[];
}

type Cell = string | number | null | undefined;
type Row = Cell[];

/**
 * 학교명 정규화: ijw-calander DB 표기와 맞춤
 * - "침산중학교" → "침산중"
 * - "칠성초등학교" → "칠성초"
 * - "대구일고등학교" → "대구일고"
 */
export function normalizeSchoolName(school: string): string {
  return school
    .trim()
    .replace(/초등학교$/, "초")
    .replace(/중학교$/, "중")
    .replace(/고등학교$/, "고");
}

/**
 * 2D 배열 기반 파서 (XLSX와 Google Sheets API 응답 둘 다 지원)
 * 포맷: A2=담임명, B1="YY.MM", 5행=헤더, 6행부터 학생
 * - 학생 이름 B열(1), 학교 D열(3), 학년 E열(4)
 * - 날짜 컬럼 R열(17)부터 "MM/DD (요일)"
 * @param notes 선택: 각 셀의 메모 (Google Sheets의 note)
 */
export function parseAttendanceFromArray(
  data: Row[],
  notes?: (string | undefined)[][]
): ParsedAttendance {
  if (!data || data.length < 6) {
    throw new Error("시트 데이터가 너무 짧습니다.");
  }

  // 담임명 (A2 우선, 실패 시 A1 fallback) + 월(B1) 추출
  const teacherName = String(data[1]?.[0] || data[0]?.[0] || "").trim();
  const monthCell = String(data[0]?.[1] || "").trim(); // "26.03"
  const monthMatch = monthCell.match(/(\d{2})\.(\d{1,2})/);
  if (!teacherName || !monthMatch) {
    throw new Error("시트 상단에 담임명(A2) 또는 월(B1)을 찾을 수 없습니다.");
  }
  const year = 2000 + parseInt(monthMatch[1]);
  const month = parseInt(monthMatch[2]);
  const billingMonth = `${year}${String(month).padStart(2, "0")}`;

  // 헤더 행 (인덱스 4)
  const header = data[4] || [];
  const dateColMap: { colIdx: number; date: string }[] = [];
  // "M/D" 또는 "M/D(요일)" 형태 전용 — 앞뒤 공백 허용, 그 외 텍스트가 섞이면 거절
  const dateHeaderPattern = /^\s*(\d{1,2})\/(\d{1,2})\s*(?:\(\s*[월화수목금토일]\s*\))?\s*$/;
  // 탭이 커버할 수 있는 합리적 범위: 직전 달 ~ 두 달 뒤 (세션이 한 달 이상 걸치는 경우까지)
  const tabStart = new Date(year, month - 2, 1); // 한 달 전
  const tabEnd = new Date(year, month + 2, 0); // 두 달 뒤 말일
  const formatDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  // 빈 헤더 컬럼도 복원: 직전 유효 날짜 + 1일씩 부여.
  // Google Sheets 가 시트 설정/조건부 포맷/수식 계산 이슈로 헤더 텍스트를
  // CSV export 에서 빈 값으로 반환하는 케이스 대응 (예: 4/1, 4/2 컬럼).
  let lastDate: Date | null = null;
  for (let c = 17; c < header.length; c++) {
    const cell = String(header[c] || "").trim();
    const m = cell.match(dateHeaderPattern);
    if (m) {
      const mm = parseInt(m[1]);
      const dd = parseInt(m[2]);
      // 엑셀 월보다 작으면 다음해로 보정 (12월 → 1월 넘어갈 때)
      // 단, 탭 월과의 차이가 6개월 이상일 때만 해 넘김 간주 (e.g. month=12, mm=1 → 다음해)
      let y = year;
      if (mm < month && month - mm >= 6) y = year + 1;
      else if (mm > month && mm - month >= 6) y = year - 1;
      const parsed = new Date(y, mm - 1, dd);
      if (parsed < tabStart || parsed > tabEnd) continue;
      dateColMap.push({ colIdx: c, date: formatDate(parsed) });
      lastDate = parsed;
    } else if (cell === "" && lastDate) {
      // 빈 헤더: 직전 날짜 + 1일로 유추 (범위 내에서만)
      const nextDate: Date = new Date(lastDate.getTime() + 24 * 60 * 60 * 1000);
      if (nextDate < tabStart || nextDate > tabEnd) {
        // 범위 밖이면 더 이상 확장하지 않고 종료
        break;
      }
      dateColMap.push({ colIdx: c, date: formatDate(nextDate) });
      lastDate = nextDate;
    } else {
      // 날짜도 아니고 빈값도 아닌 다른 텍스트 (합계, 메모 컬럼 등) → 여기서 종료
      break;
    }
  }
  const dateColumns = dateColMap.map((d) => d.date);

  // 학생 행 (6행부터)
  const entries: AttendanceEntry[] = [];
  // 푸터 마커 (아래 섹션은 학생이 아닌 요약 정보)
  const FOOTER_MARKERS = new Set(["퇴원생", "신규생", "반이동"]);
  for (let r = 5; r < data.length; r++) {
    const row = data[r];
    if (!row) continue;

    // A열에 푸터 마커가 나오면 학생 목록 종료
    const firstCol = String(row[0] || "").trim();
    if (FOOTER_MARKERS.has(firstCol)) break;

    const name = String(row[1] || "").trim();
    if (!name) continue;
    // 숫자만 있는 이름은 학생이 아님 (푸터 카운트 셀 등)
    if (/^\d+(\.\d+)?$/.test(name)) continue;

    const school = normalizeSchoolName(String(row[3] || ""));
    const grade = String(row[4] || "").trim();
    const tierName = String(row[5] || "").trim();
    // C열 요일 파싱 (예: "화, 금" → ["화","금"])
    const daysCell = String(row[2] || "").trim();
    const days = (daysCell.match(/[월화수목금토일]/g) || []);
    // 학교와 학년이 모두 비어 있으면 유효한 학생 행이 아님
    if (!school && !grade) continue;

    const attendance: Record<string, number> = {};
    const memos: Record<string, string> = {};
    for (const { colIdx, date } of dateColMap) {
      const v = row[colIdx];
      if (v !== "" && v !== null && v !== undefined) {
        const n = Number(v);
        if (!isNaN(n)) attendance[date] = n;
      }
      // 메모: 날짜 컬럼에 한해서 가져오기
      const note = notes?.[r]?.[colIdx];
      if (note && note.trim()) {
        memos[date] = note.trim();
      }
    }

    entries.push({ studentName: name, school, grade, tierName, days, attendance, memos });
  }

  // 날짜 범위 계산 (min/max) — 월 단위가 아닌 실제 탭 커버 범위 기준으로 덮어쓰기
  const sortedDates = [...dateColumns].sort();
  const minDate = sortedDates[0] || null;
  const maxDate = sortedDates[sortedDates.length - 1] || null;

  return {
    teacherName,
    year,
    month,
    billingMonth,
    dateColumns,
    minDate,
    maxDate,
    entries,
  };
}

/**
 * XLSX 버퍼 → 파싱
 */
export function parseAttendanceExcel(buffer: ArrayBuffer): ParsedAttendance {
  const wb = XLSX.read(buffer, { type: "array", cellStyles: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<Row>(ws, {
    header: 1,
    raw: false,
    defval: "",
  });

  // 셀 코멘트 추출: 워크시트의 각 셀에 .c 배열이 있으면 메모
  const notes: (string | undefined)[][] = [];
  const ref = ws["!ref"];
  if (ref) {
    const range = XLSX.utils.decode_range(ref);
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row: (string | undefined)[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr] as { c?: { t?: string }[] } | undefined;
        if (cell?.c && cell.c.length > 0) {
          row[c] = cell.c.map((x) => x.t || "").join("\n").trim();
        }
      }
      notes[r] = row;
    }
  }

  return parseAttendanceFromArray(data, notes);
}
