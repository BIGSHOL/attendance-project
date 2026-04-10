import type { Student } from "@/types";

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
