/**
 * AttendancePage 의 거대 useMemo 본체를 그대로 옮긴 helper 함수 모음.
 *
 * split-only 원칙 — 모든 로직/dep array 동작 100% 동일.
 * 호출 측은 useMemo 의 dep array 와 본체 함수 호출만 유지.
 */

import type { Enrollment, Student, Teacher, SessionPeriod, SalaryConfig } from "@/types";
import type { PaymentShare } from "@/hooks/usePaymentShares";
import {
  findStudentPayments,
  filterPaymentsForTeacherRow,
  type PaymentLite,
} from "@/lib/studentPaymentMatcher";
import { matchSalarySetting } from "@/lib/salary";
import { filterStudentsByMonth, isNewInMonth, isLeavingInMonth } from "@/lib/studentFilter";
import { extractDaysForTeacher } from "@/lib/enrollmentDays";
import { isDateInSession } from "@/lib/sessionUtils";

/** monthPayments / termCountMap / paidAmountByStudent 가 공통으로 사용하는 row-level 수납 필터.
 *   AttendancePage 의 inline filterPaymentsForRow 와 동일 동작 (split-only).
 */
function filterPaymentsForRow(
  row: Student,
  payments: ReturnType<typeof findStudentPayments>,
  opts: {
    teacherId: string;
    teacherName?: string;
    teacherEnglishName?: string;
    isMathTeacher: boolean;
  }
) {
  return filterPaymentsForTeacherRow(payments, { ...opts, rowDays: row.days });
}

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

/**
 * 영어 강사의 payment_shares 를 PaymentLite 포맷으로 변환해 monthPayments 에 합쳐 사용.
 * 비영어 강사면 rawMonthPayments 그대로 반환.
 *
 * AttendancePage.tsx 의 monthPayments useMemo 본체를 그대로 옮긴 것.
 */
export function buildMonthPayments(args: {
  isEnglishTeacher: boolean;
  teacherShares: PaymentShare[];
  rawMonthPayments: PaymentLite[];
  allStudents: Student[];
  year: number;
  month: number;
  selectedTeacherName: string | undefined;
}): PaymentLite[] {
  const {
    isEnglishTeacher,
    teacherShares,
    rawMonthPayments,
    allStudents,
    year,
    month,
    selectedTeacherName,
  } = args;

  if (!isEnglishTeacher || teacherShares.length === 0) return rawMonthPayments;
  // shares → PaymentLite 변환. 기존 findStudentPayments 매칭을 위해 이름/학교 채움.
  const byId = new Map<string, { name: string; school?: string; grade?: string; studentCode?: string }>();
  for (const s of allStudents) {
    byId.set(s.id, { name: s.name, school: s.school, grade: s.grade, studentCode: s.studentCode });
  }
  const billingMonth = `${year}${String(month).padStart(2, "0")}`;
  const converted: PaymentLite[] = teacherShares.map((sh) => {
    const stu = byId.get(sh.student_id);
    return {
      id: sh.id,
      student_code: stu?.studentCode || "",
      student_name: stu?.name || "",
      school: stu?.school,
      grade: stu?.grade,
      billing_month: billingMonth,
      // payment_name 에 class_name 을 넣어 inferTierForPrice 에서 학생 DB class 로 매칭
      payment_name: sh.class_name,
      charge_amount: sh.allocated_paid, // 납입 기준으로 처리 (기존 로직과 호환)
      discount_amount: Math.max(0, sh.allocated_charge - sh.allocated_paid),
      paid_amount: sh.allocated_paid,
      teacher_name: selectedTeacherName,
      teacher_staff_id: sh.teacher_staff_id,
    };
  });
  return converted;
}

/**
 * 단가 풀 — salaryConfig.items 의 비율제 baseTuition(+ fixed 유형의 unitPrice) 집합.
 * "수납 엔진"이 수납 금액을 이 풀의 단가로 역산 매칭하는 기준.
 *
 * AttendancePage.tsx 의 knownUnitPrices useMemo 본체를 그대로 옮긴 것.
 */
export function buildKnownUnitPrices(salaryConfigItems: SalaryConfig["items"]): number[] {
  const set = new Set<number>();
  for (const item of salaryConfigItems || []) {
    // baseTuition 과 unitPrice 둘 다 후보로 추가 (서로 다를 수 있음)
    if (item.baseTuition && item.baseTuition > 0) set.add(item.baseTuition);
    if (item.unitPrice && item.unitPrice > 0) set.add(item.unitPrice);
  }
  return Array.from(set).sort((a, b) => b - a);
}

/**
 * 행(수강)별 등록차수 = (이 수강에 해당하는 수납 합계) / (이 수강의 학생 단가)
 *
 * AttendancePage.tsx 의 termCountMap useMemo 본체를 그대로 옮긴 것.
 */
export function buildTermCountMap(args: {
  studentRows: Student[];
  monthPayments: PaymentLite[];
  selectedTeacher: Teacher | undefined;
  salaryConfig: SalaryConfig;
  tierOverrides: Record<string, string>;
  isEnglishTeacher: boolean;
  teacherShares: PaymentShare[];
}): Map<string, number> {
  const {
    studentRows,
    monthPayments,
    selectedTeacher,
    salaryConfig,
    tierOverrides,
    isEnglishTeacher,
    teacherShares,
  } = args;

  const map = new Map<string, number>();
  if (!selectedTeacher) return map;

  // 영어 강사: allocated_units 가 있으면 그대로 사용, 없으면 paid/unit_price.
  // virtual 학생이 allStudents 에 없어 findStudentPayments 매칭 실패하는 문제 회피.
  if (isEnglishTeacher && teacherShares.length > 0) {
    for (const sh of teacherShares) {
      const key = sh.class_name
        ? `${sh.student_id}|${sh.class_name}`
        : sh.student_id;
      let term = 0;
      if (typeof sh.allocated_units === "number" && sh.allocated_units > 0) {
        term = Math.round(sh.allocated_units);
      } else if (sh.unit_price && sh.unit_price > 0 && sh.allocated_paid > 0) {
        term = Math.round(sh.allocated_paid / sh.unit_price);
      }
      if (term > 0) map.set(key, (map.get(key) || 0) + term);
    }
    return map;
  }

  if (monthPayments.length === 0) return map;
  const opts = {
    teacherId: selectedTeacher.id,
    teacherName: selectedTeacher.name,
    teacherEnglishName: selectedTeacher.englishName,
    isMathTeacher: !!selectedTeacher.subjects?.some(
      (s) => s === "math" || s === "highmath"
    ),
  };

  for (const row of studentRows) {
    // tier 기반 정확 매칭된 수납 직접 사용 (studentRows 생성 시 byClass 로 이미 분류됨).
    // filterPaymentsForRow 의 요일 subset 매칭은 tier 다른 행에 같은 요일 수납을 중복 귀속시키는 버그가 있어 우회.
    const rowWithPayments = row as Student & { _payments?: PaymentLite[] };
    let filtered: PaymentLite[] | undefined = rowWithPayments._payments;
    if (!filtered) {
      // fallback: 레거시 row (분반 없는 단순 학생) — 기존 경로 유지
      const studentPayments = findStudentPayments(row, monthPayments);
      filtered = filterPaymentsForRow(row, studentPayments, opts);
    }
    if (!filtered || filtered.length === 0) continue;

    const totalCharge = filtered.reduce((s, p) => s + (p.charge_amount || 0), 0);
    if (totalCharge <= 0) continue;

    const setting = matchSalarySetting(
      row,
      salaryConfig,
      undefined,
      tierOverrides[row.id]
    );
    const unitPrice = setting?.unitPrice || 0;
    if (unitPrice <= 0) continue;

    const term = Math.round(totalCharge / unitPrice);
    if (term > 0) map.set(row.id, term);
  }
  return map;
}

/**
 * 행(수강)별 이번 달 수납 합계 — 수강 요일 세트와 일치하는 수납만 집계.
 *
 * AttendancePage.tsx 의 paidAmountByStudent useMemo 본체를 그대로 옮긴 것.
 */
export function buildPaidAmountByStudent(args: {
  studentRows: Student[];
  monthPayments: PaymentLite[];
  selectedTeacher: Teacher | undefined;
  isEnglishTeacher: boolean;
  teacherShares: PaymentShare[];
}): Map<string, number> {
  const { studentRows, monthPayments, selectedTeacher, isEnglishTeacher, teacherShares } = args;

  const map = new Map<string, number>();
  if (!selectedTeacher) return map;

  // 영어 강사: teacherShares 를 직접 row.id (`{studentId}|{className}`) 키로 매핑.
  // findStudentPayments 는 name/studentCode 매칭이라 virtual 학생 (Firebase 미등록)
  // 의 경우 allStudents 에 없어 student_name="" 로 변환되어 매칭 실패.
  // shares 는 이미 (studentId, className) 튜플을 가지고 있어 직접 키로 쓰면 정확.
  if (isEnglishTeacher && teacherShares.length > 0) {
    for (const sh of teacherShares) {
      const key = sh.class_name
        ? `${sh.student_id}|${sh.class_name}`
        : sh.student_id;
      const prev = map.get(key) || 0;
      map.set(key, prev + (sh.allocated_paid || 0));
    }
    return map;
  }

  if (monthPayments.length === 0) return map;
  const opts = {
    teacherId: selectedTeacher.id,
    teacherName: selectedTeacher.name,
    teacherEnglishName: selectedTeacher.englishName,
    isMathTeacher: !!selectedTeacher.subjects?.some(
      (s) => s === "math" || s === "highmath"
    ),
  };

  for (const row of studentRows) {
    // tier 기반 분류된 수납 직접 사용 (termCountMap 와 동일 로직)
    const rowWithPayments = row as Student & { _payments?: PaymentLite[] };
    let filtered: PaymentLite[] | undefined = rowWithPayments._payments;
    if (!filtered) {
      const studentPayments = findStudentPayments(row, monthPayments);
      filtered = filterPaymentsForRow(row, studentPayments, opts);
    }
    if (!filtered || filtered.length === 0) continue;
    const total = filtered.reduce((s, p) => s + (p.charge_amount || 0), 0);
    if (total > 0) map.set(row.id, total);
  }
  return map;
}

/**
 * 행별 유닛단가 오버라이드 (영어 payment_shares.unit_price).
 * 같은 tier 이름이어도 학년별로 단가가 다른 시트 대응.
 *
 * AttendancePage.tsx 의 unitPriceByStudent useMemo 본체를 그대로 옮긴 것.
 */
export function buildUnitPriceByStudent(args: {
  isEnglishTeacher: boolean;
  teacherShares: PaymentShare[];
}): Map<string, number> {
  const { isEnglishTeacher, teacherShares } = args;

  const map = new Map<string, number>();
  if (!isEnglishTeacher || teacherShares.length === 0) return map;
  for (const sh of teacherShares) {
    if (!sh.unit_price || sh.unit_price <= 0) continue;
    const key = sh.class_name
      ? `${sh.student_id}|${sh.class_name}`
      : sh.student_id;
    map.set(key, sh.unit_price);
  }
  return map;
}
