import type { Teacher } from "@/types";

/**
 * 상담 페이지 공유 헬퍼 — V1/V2 공용.
 *
 * 모두 순수 함수. 동작 변경 없이 ConsultationsPageV2.tsx 에서 분리됨.
 */

/**
 * 학교명 정규화
 *   "대구일중학교" → "대구일중"
 *   "경명여자중학교" → "경명여중"
 *   "서울남자고등학교" → "서울남고"
 *   "옥산초등학교" → "옥산초"
 */
export function normalizeSchoolName(raw: string): string {
  let s = (raw || "").trim();
  // 학교 유형 접미사 축약 — 긴 패턴 먼저
  s = s.replace(/고등학교$/, "고");
  s = s.replace(/중학교$/, "중");
  s = s.replace(/초등학교$/, "초");
  s = s.replace(/대학교$/, "대");
  // 남녀 표기 축약
  s = s.replace(/여자/g, "여");
  s = s.replace(/남자/g, "남");
  return s;
}

/**
 * 학교·학년 포맷: "대구일중 중2" → "대구일중2", "경명여자중학교 중1" → "경명여중1"
 *   school 정규화 + 마지막 글자(중/초/고/대)가 grade 첫 글자와 같으면 중복 제거.
 */
export function formatSchoolGrade(school?: string, grade?: string): string {
  const s = school ? normalizeSchoolName(school) : "";
  if (!s && !grade) return "—";
  if (!s) return grade || "—";
  if (!grade) return s;
  const last = s.slice(-1);
  if (/[중초고대]/.test(last) && grade.startsWith(last)) {
    return s + grade.slice(1);
  }
  return `${s} ${grade}`;
}

// 과목별 뱃지 팔레트 — HomeroomPicker 와 동일 체계
const SUBJECT_BADGE: Record<string, string> = {
  수학: "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300",
  영어: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  국어: "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
  과학: "bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300",
  고등수학: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300",
  사회: "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300",
};
const MULTI_BADGE = "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300";
const NONE_BADGE = "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";

export function subjectBadgeClass(label: string): string {
  if (!label) return NONE_BADGE;
  if (label.includes("/")) return MULTI_BADGE;
  return SUBJECT_BADGE[label] ?? NONE_BADGE;
}

/**
 * 이름 문자열에서 가능한 모든 표기 추출 (V1 동일 로직)
 *   "정유진(Yoojin)" → ["정유진(Yoojin)", "정유진", "Yoojin"]
 */
export function extractNameAliases(raw: string | undefined): string[] {
  const s = (raw ?? "").trim();
  if (!s) return [];
  const result = new Set<string>([s]);
  const m = s.match(/^(.+?)\s*\(\s*(.+?)\s*\)$/);
  if (m) {
    result.add(m[1].trim());
    result.add(m[2].trim());
  }
  const stripped = s.replace(/\s*\([^)]*\)\s*/g, "").trim();
  if (stripped) result.add(stripped);
  return Array.from(result);
}

/**
 * 상담자 이름이 특정 선생님과 일치하는지 판정.
 *   - consultantName 의 모든 alias(본명/영어명/괄호안팎)와
 *     teacher 의 name/englishName alias 를 대소문자 무시 교집합으로 비교
 */
export function matchesTeacher(
  consultantName: string | undefined,
  teacher: Teacher | undefined
): boolean {
  if (!consultantName || !teacher) return false;
  const consultantAliases = new Set(
    extractNameAliases(consultantName).map((n) => n.toLowerCase())
  );
  const teacherSources = [teacher.name, teacher.englishName].filter(Boolean) as string[];
  for (const src of teacherSources) {
    for (const alias of extractNameAliases(src)) {
      if (consultantAliases.has(alias.toLowerCase())) return true;
    }
  }
  return false;
}

// 도넛 색상 — 완료율 기준 단계적
export function donutColor(pct: number): string {
  if (pct >= 70) return "#16a34a"; // green-600
  if (pct >= 40) return "#d97706"; // amber-600
  return "#dc2626"; // red-600
}
