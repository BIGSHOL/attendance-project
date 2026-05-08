/**
 * AttendancePage 의 거대 useMemo 본체를 그대로 옮긴 helper 함수 모음.
 *
 * split-only 원칙 — 모든 로직/dep array 동작 100% 동일.
 * 호출 측은 useMemo 의 dep array 와 본체 함수 호출만 유지.
 */

import type { Enrollment, Student, Teacher, SessionPeriod } from "@/types";
import { filterStudentsByMonth, isNewInMonth, isLeavingInMonth } from "@/lib/studentFilter";
import { extractDaysForTeacher } from "@/lib/enrollmentDays";
import { isDateInSession } from "@/lib/sessionUtils";

/** useAttendanceData().studentDataMap 의 형태 — helper 가 사용하는 필드만 좁게 추출. */
export type StudentDataMap = Map<string, {
  attendance?: Record<string, number>;
  memos?: Record<string, string>;
  homework?: Record<string, boolean>;
  cellColors?: Record<string, string>;
}>;

/**
 * 선택된 선생님 + 월 기준으로 학생 목록 필터링 + Supabase 출석 데이터 머지.
 * AttendancePage.tsx 의 filteredStudents useMemo 본체를 그대로 옮긴 것.
 */
export function buildFilteredStudents(args: {
  selectedTeacherId: string;
  selectedTeacher: Teacher | undefined;
  allStudents: Student[];
  isTeacherMatch: (
    e: { staffId?: string; teacher?: string; subject?: string },
    t: Teacher
  ) => boolean;
  studentDataMap: StudentDataMap;
  year: number;
  month: number;
  hideZeroAttendance: boolean;
  sessionPeriods: SessionPeriod[];
}): Student[] {
  const {
    selectedTeacherId,
    selectedTeacher,
    allStudents,
    isTeacherMatch,
    studentDataMap,
    year,
    month,
    hideZeroAttendance,
    sessionPeriods,
  } = args;

  if (!selectedTeacherId || !selectedTeacher) return [];

  // 1. 해당 선생님 담당 학생
  let filtered = allStudents.filter((s) =>
    s.enrollments?.some((e) => isTeacherMatch(e, selectedTeacher))
  );

  // 2. 해당 월에 재원 중이었던 학생만 (신입생/퇴원생 월별 처리)
  filtered = filterStudentsByMonth(filtered, year, month);

  const dataMap = studentDataMap;
  const ymPrefix = `${year}-${String(month).padStart(2, "0")}`;

  return filtered
    .map((s): Student => {
      const supaData = dataMap.get(s.id);
      // 선택된 선생님과 매칭되는 모든 enrollments (재수강 · 반이동 대응).
      // 원본 DB 에 필드가 전부 빈 쓰레기 enrollment 가 있으면 isTeacherMatch 가
      // 이름 매칭 "" === "" 로 통과시키므로, className 이 있고 교사 매칭되는 것만 취함.
      // (반이동 직후 startDate/endDate 가 빈 값으로 저장되는 Firebase 이슈 대응 —
      //  같은 선생님 직전 enrollment 의 endDate 를 startDate 로 유추.)
      const rawTeacherEnrollments =
        s.enrollments?.filter(
          (e) => (e.className || e.startDate || e.endDate) && isTeacherMatch(e, selectedTeacher)
        ) || [];
      const teacherEnrollments: Enrollment[] = rawTeacherEnrollments.map((e) => {
        if (e.startDate) return e;
        // startDate 비어있으면 같은 선생님 직전 enrollment endDate 로 유추
        // (CR1D 처럼 월목 반이 Firebase 에 start/end 둘 다 빈 값으로 저장된 케이스 대응)
        const priorEnd = rawTeacherEnrollments
          .filter((x) => x !== e && x.endDate)
          .map((x) => x.endDate || "")
          .sort()
          .reverse()[0];
        return priorEnd ? { ...e, startDate: priorEnd } : e;
      });
      // 표시용 반이름/시작일/종료일: 현재 진행 중인 것 우선, 없으면 마지막
      const today = new Date().toISOString().slice(0, 10);
      const primaryEnrollment =
        teacherEnrollments.find((e) => !e.endDate || e.endDate >= today) ||
        teacherEnrollments[teacherEnrollments.length - 1];
      // 해당 선생님 수업의 요일만 추출 (schedule "월 1" → "월")
      const days = extractDaysForTeacher(s.enrollments, (e) => isTeacherMatch(e, selectedTeacher));

      return {
        ...s,
        group: primaryEnrollment?.className || s.group || "미분류",
        // enrollments 를 해당 선생님 것으로 한정 — studentFilter 함수들이
        // 이 배열을 보고 재원 구간 판정하므로 per-teacher 정확도 확보
        enrollments: teacherEnrollments,
        // 참고용 top-level 날짜 (일부 레거시 UI 용) — primary 기준
        startDate: primaryEnrollment?.startDate || "",
        endDate: primaryEnrollment?.endDate || "",
        days,
        attendance: supaData?.attendance ?? s.attendance ?? {},
        memos: supaData?.memos ?? s.memos ?? {},
        homework: supaData?.homework ?? s.homework ?? {},
        cellColors: supaData?.cellColors ?? s.cellColors ?? {},
      };
    })
    .filter((s) => {
      // 세션 범위 기반 집계 (없으면 월 prefix 폴백) — isDateInCurrentPeriod 을
      // 여기 인라인으로 계산해 useMemo 순환 참조 회피.
      const currentMonthSession = sessionPeriods.find((sp) => sp.month === month);
      const inPeriod = currentMonthSession
        ? (dk: string) => isDateInSession(dk, currentMonthSession)
        : (dk: string) => dk.startsWith(ymPrefix);
      const periodAttendanceTotal = Object.entries(s.attendance || {}).reduce(
        (sum, [key, v]) => sum + (inPeriod(key) && v > 0 ? v : 0),
        0
      );
      const monthAttendanceTotal = Object.entries(s.attendance || {}).reduce(
        (sum, [key, v]) => sum + (key.startsWith(ymPrefix) && v > 0 ? v : 0),
        0
      );
      const effectiveAttendance = Math.max(periodAttendanceTotal, monthAttendanceTotal);
      // 토글: 이번 세션(또는 월) 출석이 0이면 전부 숨김
      if (hideZeroAttendance && effectiveAttendance === 0) return false;
      // 토글 OFF이어도, 이번 달 신입/퇴원 뱃지 대상이면서 출석 0인 학생은 숨김
      // (수업을 1회도 하지 않은 학생은 신입도 퇴원도 아니므로 노출 제외)
      const isNew = isNewInMonth(s, year, month);
      const isLeaving = isLeavingInMonth(s, year, month);
      if (isNew || isLeaving) return effectiveAttendance > 0;
      return true;
    });
}
