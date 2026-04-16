import type { Student, Enrollment } from "@/types";

export interface TransferInfo {
  teacher: string;
  className: string;
}

/**
 * 반이동 판정용 과목 정규화
 * ijw-calander 규칙: 영어는 대문자 2-3자 + 숫자 (예: AB1, ABC2), 그 외(수학/고급수학/수능 등)는 모두 math 계열로 묶음
 */
function normalizeSubjectForTransfer(subject?: string, className?: string): string {
  if (subject === "english") return "english";
  if (subject && subject.length > 0) return "math";
  if (className && /^[A-Z]{2,3}\d/.test(className)) return "english";
  return "math";
}

/**
 * 유효한 재원 구간들을 학생 enrollments 에서 추출.
 * enrollments 가 없으면 top-level startDate/endDate 를 단일 구간으로 fallback.
 *
 * 재수강(종료 → 재수강) 케이스를 정확히 다루기 위해 반드시 enrollments 전체를 고려해야 한다.
 * 단일 top-level endDate 는 과거 종료 반의 찌꺼기일 수 있으므로 우선 사용하지 않는다.
 */
function getEnrollmentPeriods(student: Student): { start: string; end: string }[] {
  const periods = (student.enrollments || [])
    .filter((e) => e.startDate) // 시작일 없는 빈 enrollment 무시
    .map((e) => ({ start: e.startDate || "", end: e.endDate || "" }));
  if (periods.length > 0) return periods;
  // fallback: 구식 데이터 대비 top-level 단일 구간
  if (student.startDate || student.endDate) {
    return [{ start: student.startDate || "", end: student.endDate || "" }];
  }
  return [];
}

/**
 * 해당 날짜에 학생이 재원 중이었는지 확인.
 * enrollments 중 하나라도 해당 날짜를 포함하면 true (재수강 반영).
 */
export function isDateValidForStudent(dateKey: string, student: Student): boolean {
  const periods = getEnrollmentPeriods(student);
  if (periods.length === 0) return true; // 시작/종료 정보 전혀 없으면 유효로 취급
  return periods.some(({ start, end }) => {
    if (start && dateKey < start) return false;
    if (end && dateKey > end) return false;
    return true;
  });
}

/**
 * 해당 월이 학생의 "신입" 달인지.
 * 이번 달에 시작한 enrollment 가 있어도, 그 이전에 끝난 다른 enrollment 가 있으면
 * 재수강이므로 신입 아님.
 */
export function isNewInMonth(student: Student, year: number, month: number): boolean {
  const periods = getEnrollmentPeriods(student);
  if (periods.length === 0) return false;
  const ym = `${year}-${String(month).padStart(2, "0")}`;
  return periods.some(({ start }) => {
    if (!start || !start.startsWith(ym)) return false;
    // 이 enrollment 시작일 이전에 끝난 다른 enrollment 가 있으면 재수강 → 신입 아님
    const hasPriorEnrollment = periods.some((p) => p.end && p.end < start);
    return !hasPriorEnrollment;
  });
}

/**
 * 해당 월이 학생의 "퇴원" 달인지 — 이번 달에 종료된 enrollment 가 있고,
 * 그 종료일 이후에 시작하는 다른 enrollment 가 없으면 퇴원(재수강 아님).
 */
export function isLeavingInMonth(student: Student, year: number, month: number): boolean {
  const periods = getEnrollmentPeriods(student);
  if (periods.length === 0) return false;
  const ym = `${year}-${String(month).padStart(2, "0")}`;
  // 이번 달에 끝난 enrollment
  const endedThisMonth = periods.filter(({ end }) => end && end.startsWith(ym));
  if (endedThisMonth.length === 0) return false;
  // 그 끝 이후에 시작되는 다른 enrollment 가 있으면 재수강이므로 퇴원 아님
  return endedThisMonth.some(({ end }) => {
    const hasLater = periods.some(({ start }) => start && end && start > end);
    return !hasLater;
  });
}

/**
 * 해당 월에 보여야 할 학생 필터링.
 * 재원 구간들 중 하나라도 조회 월과 겹치면 포함.
 */
export function filterStudentsByMonth(
  students: Student[],
  year: number,
  month: number
): Student[] {
  const monthFirstDay = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDate = new Date(year, month, 0).getDate();
  const monthLastDay = `${year}-${String(month).padStart(2, "0")}-${String(lastDate).padStart(2, "0")}`;

  return students.filter((s) => {
    const periods = getEnrollmentPeriods(s);
    if (periods.length === 0) return true;
    // 하나의 구간이라도 조회 월과 겹치면 포함
    return periods.some(({ start, end }) => {
      // 월 시작일 이후에 종료된 구간 & 월 말 이전에 시작한 구간
      if (end && end < monthFirstDay) return false;
      if (start && start > monthLastDay) return false;
      return true;
    });
  });
}

/**
 * 현재 반(group)의 시작일이 dateKey일 때, 그 이전에 존재한 같은 과목의 다른 반을 찾는다.
 * ijw-calander 의 getPreviousEnrollmentOnDate 포팅.
 * @returns 이전 반 정보 또는 null
 */
export function findTransferFromOnDate(
  student: Student,
  dateKey: string
): TransferInfo | null {
  if (!student.enrollments?.length || !student.group) return null;

  const currentEnrollment = student.enrollments.find(
    (e) => (e.className || "") === student.group
  );
  if (!currentEnrollment) return null;
  const currentStartDate = currentEnrollment.startDate || "";
  if (!currentStartDate || dateKey !== currentStartDate) return null;

  const currentSubject = normalizeSubjectForTransfer(
    currentEnrollment.subject,
    student.group
  );

  const target = student.enrollments.find((e: Enrollment) => {
    const className = e.className || "";
    if (className === student.group) return false;
    const enrollmentSubject = normalizeSubjectForTransfer(e.subject, className);
    if (enrollmentSubject !== currentSubject) return false;
    const startDate = e.startDate || "";
    return startDate.length > 0 && startDate < currentStartDate;
  });

  if (!target) return null;
  return {
    teacher: target.teacher || "",
    className: target.className || "",
  };
}

/**
 * 현재 반이 종료되었을 때, 오늘 기준 활성인 같은 과목의 다른 반을 찾는다.
 * ijw-calander 의 transferToInfo 포팅.
 */
export function findTransferToToday(student: Student): TransferInfo | null {
  if (!student.endDate || !student.enrollments?.length || !student.group) return null;

  const today = new Date().toISOString().slice(0, 10);

  const currentEnrollment = student.enrollments.find(
    (e) => (e.className || "") === student.group
  );
  const currentSubject = normalizeSubjectForTransfer(
    currentEnrollment?.subject,
    student.group
  );

  const target = student.enrollments.find((e: Enrollment) => {
    const className = e.className || "";
    if (className === student.group) return false;
    const enrollmentSubject = normalizeSubjectForTransfer(e.subject, className);
    if (enrollmentSubject !== currentSubject) return false;
    const startDate = e.startDate || "";
    const endDate = e.endDate || "";
    return startDate.length > 0 && startDate <= today && (!endDate || endDate >= today);
  });

  if (!target) return null;
  return {
    teacher: target.teacher || "",
    className: target.className || "",
  };
}
