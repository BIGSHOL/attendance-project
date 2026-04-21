/**
 * 선생님 월별 실급여 계산 — AttendancePage와 SettlementPage가 공유하는 순수 함수.
 *
 * 엑셀 수식처럼: 같은 입력 → 같은 출력.
 * AttendancePage에서 한 번 계산한 값이 캐시되는 게 아니라, 양쪽이 동일 함수를
 * 호출해 실시간으로 동일한 결과를 냄. DB 캐시(teacher_month_payroll) 불필요.
 *
 * 원본 로직은 AttendancePage.tsx 의 studentRows + paidAmountByStudent +
 * unitPriceByStudent + stats + finalSalary 파이프라인을 그대로 추출.
 */

import type { Student, Teacher, SalaryConfig, MonthlySettlement } from "@/types";
import type { PaymentLite } from "@/lib/studentPaymentMatcher";
import type { PaymentShare } from "@/hooks/usePaymentShares";
import {
  calculateStats,
  calculateFinalSalary,
  matchSalarySetting,
  calculateStudentSalary,
  getEffectiveRatio,
  isAttendanceCountable,
  gradeToGroup,
  type SalaryType,
  type SalarySubject,
} from "@/lib/salary";
import {
  findStudentPayments,
  filterPaymentsForTeacherRow,
  extractPaymentDays,
} from "@/lib/studentPaymentMatcher";

/** 선생님 1명·월 1회 계산에 필요한 모든 입력 */
export interface TeacherPayrollInput {
  teacher: Teacher;
  /** 이 선생님에게 담당된 학생들 (이미 담당/월 필터 적용됨) */
  filteredStudents: Student[];
  /** 전체 학생 (영어 share 경로에서 Student 메타 lookup용) */
  allStudents: Student[];
  /** 이 선생님 이외 포함한 월 수납 전체 (영어 share 경로에서 payment_name 매칭용) */
  rawMonthPayments: PaymentLite[];
  /** 월 수납 — 영어는 이미 shares 변환된 것일 수 있음 */
  monthPayments: PaymentLite[];
  /** 이 선생님의 payment_shares (영어 선생님 전용, 다른 선생님은 빈 배열) */
  teacherShares: PaymentShare[];
  /** 급여 설정 */
  salaryConfig: SalaryConfig;
  /** (studentId | `${studentId}|${className}`) → 출석 데이터 맵 */
  studentDataMap: Map<
    string,
    {
      attendance: Record<string, number>;
      memos?: Record<string, string>;
      homework?: Record<string, boolean>;
      cellColors?: Record<string, string>;
    }
  >;
  /** 시트 F열 동기화에서 저장된 student tier 오버라이드 (이 선생님 것) */
  tierOverrides: Record<string, string>;
  /** 월별 정산 오버라이드 (블로그/재원유지/기타 + 확정 여부) */
  settlement: MonthlySettlement;
  /** 행정수당 gross (비율·수수료 반영 전). 0이면 미사용. */
  adminSalary: number;
  /** 블로그 패널티 적용 여부 (의무 + 미작성) */
  blogPenalty: boolean;
  year: number;
  month: number;
  /** 집계 기준 — 월별 뷰는 달력 월, 세션 뷰는 세션 범위 */
  isDateInPeriod: (dateKey: string) => boolean;
  /** 선생님의 급여 유형 + mixed 시 비율제 요일 */
  salaryType: SalaryType;
  commissionDays: string[];
  /** 선생님의 주 과목 (subjectHint 용) */
  subject: SalarySubject | undefined;
  /** 영어 선생님 여부 (teacherShares 경로 활성화) */
  isEnglishTeacher: boolean;
}

export interface TeacherPayrollResult {
  /** 행정수당 포함 최종 실급여 */
  finalSalary: number;
  /** 학생·행 단위 기본 급여 합계 (인센티브/행정수당 제외) */
  totalSalary: number;
  /** 인센티브 합계 (블로그/재원/기타 포함) */
  incentiveTotal: number;
  /** 행정수당 최종 지급액 */
  adminSalary: number;
  /** 고유 학생 수 */
  studentCount: number;
  /** 월 전체 출석 시수 */
  totalAttendance: number;
  /** 급여 유형에 따라 인정되는 출석 시수 */
  countableAttendance: number;
  /** 학생×분반 단위로 분리된 행들 — 출석표 렌더에 사용 */
  rows: Student[];
  /** 행별 수납 합계 (캡 적용용) */
  paidAmountByStudent: Map<string, number>;
  /** 행별 unit_price 오버라이드 (영어) */
  unitPriceByStudent: Map<string, number>;
}

/** 수납명 끝의 요일 토큰을 제거한 prefix (분반/tier 폴백 식별자) */
function paymentClassKey(paymentName: string): string {
  return (paymentName || "").replace(/\s[월화수목금토일]+\s*$/, "").trim();
}

/**
 * 단가 풀에서 charge 금액에 대응하는 단가를 역산.
 *   charge = 단가 × 시수 가정. 시수가 1~16 범위 들어오는 가장 큰 단가 선택.
 */
function makeInferUnitPrice(salaryConfig: SalaryConfig) {
  const set = new Set<number>();
  for (const item of salaryConfig.items || []) {
    if (item.baseTuition && item.baseTuition > 0) set.add(item.baseTuition);
    if (item.unitPrice && item.unitPrice > 0) set.add(item.unitPrice);
  }
  const knownUnitPrices = Array.from(set).sort((a, b) => b - a);
  return (charge: number): number | null => {
    if (charge <= 0) return null;
    for (const price of knownUnitPrices) {
      if (charge % price !== 0) continue;
      const n = charge / price;
      if (n >= 1 && n <= 16) return price;
    }
    return null;
  };
}

/** 학교명 정규화 — 영어 share 경로 매칭용 */
function normSchool(s: string | undefined): string {
  return (s || "")
    .trim()
    .replace(/초등학교$/, "초")
    .replace(/중학교$/, "중")
    .replace(/고등학교$/, "고");
}

/**
 * AttendancePage의 studentRows 로직을 그대로 추출.
 * 학생을 "수납 분반(=payment_name prefix)" 기준으로 분리한 행 목록.
 */
function buildStudentRows(input: TeacherPayrollInput): Student[] {
  const {
    teacher,
    filteredStudents,
    allStudents,
    rawMonthPayments,
    monthPayments,
    teacherShares,
    salaryConfig,
    studentDataMap,
    isEnglishTeacher,
    year,
    month,
  } = input;

  const inferUnitPrice = makeInferUnitPrice(salaryConfig);

  // 영어 교사 전용 — shares 기반 직접 구성
  if (isEnglishTeacher && teacherShares.length > 0) {
    const studentById = new Map<string, Student>();
    for (const stu of allStudents) studentById.set(stu.id, stu);

    const teacherFullName = teacher.name;
    const teacherEng = teacher.englishName;
    const teacherPayments = rawMonthPayments.filter((p) => {
      if (!p.payment_name) return false;
      const tn = p.teacher_name || "";
      return (
        (!!teacherFullName && tn.includes(teacherFullName)) ||
        (!!teacherEng && tn.includes(teacherEng))
      );
    });
    const paymentNameByShareStudent = new Map<string, string>();
    for (const sh of teacherShares) {
      if (paymentNameByShareStudent.has(sh.student_id)) continue;
      const stu = studentById.get(sh.student_id);
      if (!stu) continue;
      const match = teacherPayments.find((p) => {
        if (p.student_code && stu.studentCode && stu.studentCode === p.student_code)
          return true;
        return (
          !!p.student_name &&
          p.student_name === stu.name &&
          normSchool(p.school) === normSchool(stu.school)
        );
      });
      if (match?.payment_name) {
        paymentNameByShareStudent.set(sh.student_id, match.payment_name);
      }
    }

    const engRows: Student[] = [];
    for (const sh of teacherShares) {
      const stu = studentById.get(sh.student_id);
      if (!stu) continue;
      const tierName = sh.class_name || "";
      const attendanceKey = tierName ? `${stu.id}|${tierName}` : stu.id;
      const rowData = studentDataMap.get(attendanceKey);
      const paymentName = paymentNameByShareStudent.get(sh.student_id);
      const rowId = attendanceKey;
      const groupLabel = paymentName || tierName || "미분류";

      const attendanceDayLabels = new Set<string>();
      for (const dateKey of Object.keys(rowData?.attendance || {})) {
        const v = rowData?.attendance[dateKey] ?? 0;
        if (v <= 0) continue;
        const d = new Date(dateKey);
        if (!isNaN(d.getTime())) {
          attendanceDayLabels.add(
            ["일", "월", "화", "수", "목", "금", "토"][d.getDay()]
          );
        }
      }

      const sharePaymentLite: PaymentLite = {
        id: sh.id,
        student_code: stu.studentCode || "",
        student_name: stu.name,
        school: stu.school,
        grade: stu.grade,
        billing_month: `${year}${String(month).padStart(2, "0")}`,
        payment_name: paymentName || tierName,
        charge_amount: sh.allocated_paid,
        discount_amount: Math.max(0, sh.allocated_charge - sh.allocated_paid),
        paid_amount: sh.allocated_paid,
        teacher_name: teacher.name,
        teacher_staff_id: sh.teacher_staff_id,
      };

      engRows.push({
        ...stu,
        id: rowId,
        group: groupLabel,
        days: Array.from(attendanceDayLabels).sort(),
        attendance: rowData?.attendance ?? {},
        memos: rowData?.memos ?? {},
        homework: rowData?.homework ?? {},
        cellColors: rowData?.cellColors ?? {},
        _payments: [sharePaymentLite],
      } as Student & { _payments: PaymentLite[] });
    }
    return engRows;
  }

  // 수학/기타 — 수납 분반(=payment_name prefix) 기준으로 행 분리
  const rows: Student[] = [];
  const opts = {
    teacherId: teacher.id,
    teacherName: teacher.name,
    teacherEnglishName: teacher.englishName,
    isMathTeacher: !!teacher.subjects?.some(
      (s) => s === "math" || s === "highmath"
    ),
  };

  for (const s of filteredStudents) {
    const studentPayments = findStudentPayments(s, monthPayments);
    const teacherPayments = studentPayments.filter((p) => {
      if (p.teacher_staff_id && p.teacher_staff_id === opts.teacherId) return true;
      const pt = p.teacher_name || "";
      if (!pt) return false;
      if (opts.teacherName && pt.includes(opts.teacherName)) return true;
      if (opts.teacherEnglishName && pt.includes(opts.teacherEnglishName))
        return true;
      return false;
    });

    const dbClassNames = new Set<string>();
    for (const key of studentDataMap.keys()) {
      if (key === s.id) dbClassNames.add("");
      else if (key.startsWith(s.id + "|")) dbClassNames.add(key.slice(s.id.length + 1));
    }
    const studentGroup = gradeToGroup(s.grade);

    const nonEmptyDbClassNames = [...dbClassNames].filter((c) => c);
    const inferTierForPrice = (
      price: number | null,
      chargeAmount?: number
    ): string | null => {
      if (nonEmptyDbClassNames.length === 1) return nonEmptyDbClassNames[0];

      if (nonEmptyDbClassNames.length > 0) {
        if (price !== null) {
          for (const cn of nonEmptyDbClassNames) {
            const item = (salaryConfig.items || []).find((i) => i.name === cn);
            if (!item) continue;
            if (item.baseTuition === price || item.unitPrice === price) return cn;
          }
        }
        if (chargeAmount !== undefined && chargeAmount > 0) {
          for (const cn of nonEmptyDbClassNames) {
            const item = (salaryConfig.items || []).find((i) => i.name === cn);
            if (!item) continue;
            for (const unit of [item.baseTuition, item.unitPrice]) {
              if (!unit || unit <= 0) continue;
              if (chargeAmount % unit !== 0) continue;
              const n = chargeAmount / unit;
              if (n >= 1 && n <= 16) return cn;
            }
          }
        }
        return null;
      }

      if (price === null) return null;
      const candidates = (salaryConfig.items || []).filter(
        (i) => i.baseTuition === price || i.unitPrice === price
      );
      if (candidates.length === 0) return null;
      const fromGroup = candidates.find((c) => c.group === studentGroup);
      if (fromGroup) return fromGroup.name;
      return candidates[0].name;
    };

    const byClass = new Map<
      string,
      {
        tierName: string | null;
        daySet: Set<string>;
        payments: typeof teacherPayments;
        label: string;
      }
    >();
    if (nonEmptyDbClassNames.length > 0) {
      for (const cn of nonEmptyDbClassNames) {
        byClass.set(cn, {
          tierName: cn,
          daySet: new Set<string>(),
          payments: [],
          label: cn,
        });
      }
    }

    for (const p of teacherPayments) {
      const charge = p.charge_amount || 0;
      const price = inferUnitPrice(charge);
      let classKey: string | null = null;

      if (nonEmptyDbClassNames.length > 0) {
        const inferred = inferTierForPrice(price, charge);
        if (inferred && byClass.has(inferred)) {
          classKey = inferred;
        } else if (nonEmptyDbClassNames.length === 1) {
          classKey = nonEmptyDbClassNames[0];
        }
      } else {
        const tierName = inferTierForPrice(price, charge);
        classKey =
          tierName ||
          (price !== null ? `price:${price}` : paymentClassKey(p.payment_name || ""));
      }
      if (!classKey) continue;

      const entry = byClass.get(classKey) || {
        tierName: classKey.startsWith("price:") ? null : classKey,
        daySet: new Set<string>(),
        payments: [],
        label: classKey.startsWith("price:")
          ? price !== null
            ? `${price.toLocaleString()}원 수업`
            : classKey
          : classKey,
      };
      for (const d of extractPaymentDays(p.payment_name || "")) entry.daySet.add(d);
      entry.payments.push(p);
      byClass.set(classKey, entry);
    }

    if (byClass.size === 0) {
      rows.push(s);
      continue;
    }

    for (const [, entry] of byClass) {
      const tierName = entry.tierName || "";
      const rowKey = tierName ? `${s.id}|${tierName}` : s.id;
      const rowData = studentDataMap.get(rowKey);
      const paymentDays = Array.from(entry.daySet).sort();

      let displayDays: string[];
      if (paymentDays.length > 0) {
        displayDays = paymentDays;
      } else {
        const attendanceDayLabels = new Set<string>();
        for (const dateKey of Object.keys(rowData?.attendance || {})) {
          const v = rowData?.attendance[dateKey] ?? 0;
          if (v <= 0) continue;
          const d = new Date(dateKey);
          if (!isNaN(d.getTime())) {
            attendanceDayLabels.add(
              ["일", "월", "화", "수", "목", "금", "토"][d.getDay()]
            );
          }
        }
        if (attendanceDayLabels.size > 0) {
          displayDays = Array.from(attendanceDayLabels).sort();
        } else if (byClass.size === 1) {
          displayDays = (s.days || []).slice().sort();
        } else {
          displayDays = [];
        }
      }
      rows.push({
        ...s,
        id: rowKey,
        group: entry.label,
        days: displayDays,
        attendance: rowData?.attendance ?? {},
        memos: rowData?.memos ?? {},
        homework: rowData?.homework ?? {},
        cellColors: rowData?.cellColors ?? {},
        _payments: entry.payments,
      } as Student & { _payments: typeof entry.payments });
    }
  }
  return rows;
}

/** 행별 수납 합계 맵 — termCount/paidAmount 계산 공유 로직 */
function buildPaidAmountByStudent(
  rows: Student[],
  input: TeacherPayrollInput
): Map<string, number> {
  const { teacher, monthPayments, isEnglishTeacher, teacherShares } = input;
  const map = new Map<string, number>();

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
    teacherId: teacher.id,
    teacherName: teacher.name,
    teacherEnglishName: teacher.englishName,
    isMathTeacher: !!teacher.subjects?.some(
      (s) => s === "math" || s === "highmath"
    ),
  };

  for (const row of rows) {
    const rowWithPayments = row as Student & { _payments?: PaymentLite[] };
    let filtered: PaymentLite[] | undefined = rowWithPayments._payments;
    if (!filtered) {
      const studentPayments = findStudentPayments(row, monthPayments);
      filtered = filterPaymentsForTeacherRow(studentPayments, {
        ...opts,
        rowDays: row.days,
      });
    }
    if (!filtered || filtered.length === 0) continue;
    const total = filtered.reduce((s, p) => s + (p.charge_amount || 0), 0);
    if (total > 0) map.set(row.id, total);
  }
  return map;
}

function buildUnitPriceByStudent(
  input: TeacherPayrollInput
): Map<string, number> {
  const { isEnglishTeacher, teacherShares } = input;
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

/**
 * 선생님 1명의 월별 실급여 계산 — 메인 함수.
 * AttendancePage / SettlementPage 가 양쪽에서 호출하면 완벽히 동일한 값 반환.
 */
export function computeTeacherMonthPayroll(
  input: TeacherPayrollInput
): TeacherPayrollResult {
  const rows = buildStudentRows(input);
  const paidAmountByStudent = buildPaidAmountByStudent(rows, input);
  const unitPriceByStudent = buildUnitPriceByStudent(input);

  const stats = calculateStats(
    rows,
    input.salaryConfig,
    input.year,
    input.month,
    input.salaryType,
    input.commissionDays,
    input.subject,
    input.teacher.name,
    input.blogPenalty,
    input.tierOverrides,
    paidAmountByStudent,
    input.isDateInPeriod,
    unitPriceByStudent
  );

  // 출석 인정 시수 — 행 별로 재계산 (calculateStats 는 totalAttendance 만 반환)
  let countableAttendance = 0;
  for (const row of rows) {
    if (!row.attendance) continue;
    for (const [dateKey, value] of Object.entries(row.attendance)) {
      if (!input.isDateInPeriod(dateKey) || value <= 0) continue;
      if (isAttendanceCountable(dateKey, input.salaryType, input.commissionDays)) {
        countableAttendance += value;
      }
    }
  }

  const withIncentive = calculateFinalSalary(
    stats.totalSalary,
    input.salaryConfig.incentives,
    input.settlement
  );
  const incentiveTotal = withIncentive - stats.totalSalary;
  const finalSalary = withIncentive + input.adminSalary;

  return {
    finalSalary,
    totalSalary: stats.totalSalary,
    incentiveTotal,
    adminSalary: input.adminSalary,
    studentCount: stats.studentCount,
    totalAttendance: stats.totalAttendance,
    countableAttendance,
    rows,
    paidAmountByStudent,
    unitPriceByStudent,
  };
}
