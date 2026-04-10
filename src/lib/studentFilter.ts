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
 * 해당 날짜에 학생이 재원 중이었는지 확인
 * - startDate 이전이면 false
 * - endDate 이후이면 false
 */
export function isDateValidForStudent(dateKey: string, student: Student): boolean {
  if (student.startDate && dateKey < student.startDate) return false;
  if (student.endDate && dateKey > student.endDate) return false;
  return true;
}

/**
 * 해당 월이 학생의 신입 달인지 (startDate가 월 내)
 */
export function isNewInMonth(student: Student, year: number, month: number): boolean {
  if (!student.startDate) return false;
  const ym = `${year}-${String(month).padStart(2, "0")}`;
  return student.startDate.startsWith(ym);
}

/**
 * 해당 월이 학생의 퇴원 달인지 (endDate가 월 내)
 */
export function isLeavingInMonth(student: Student, year: number, month: number): boolean {
  if (!student.endDate) return false;
  const ym = `${year}-${String(month).padStart(2, "0")}`;
  return student.endDate.startsWith(ym);
}

/**
 * 해당 월에 보여야 할 학생 필터링 (ijw-calander 방식)
 * - 퇴원생: endDate가 조회 월 내이면 포함, 이전이면 제외
 * - 신입생: startDate가 조회 월 이후면 제외
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
    // 퇴원생: endDate가 조회 월 시작일보다 이전이면 제외
    if (s.endDate && s.endDate < monthFirstDay) return false;
    // 신입생: startDate가 조회 월 마지막일보다 이후면 제외
    if (s.startDate && s.startDate > monthLastDay) return false;
    return true;
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
