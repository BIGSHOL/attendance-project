/**
 * SettlementPage 의 거대 settlements useMemo 본체를 그대로 옮긴 helper 함수.
 *
 * split-only 원칙 — 모든 로직/dep array 동작 100% 동일.
 * closure 캡처 함수들 (getByTeacher / resolveSalary / hasPostForTeacher 등) 은
 * args 로 명시 전달 — useMemo 의 dep array 와 동일.
 */

import type { SalaryConfig, Student, Teacher, SessionPeriod, MonthlySettlement } from "@/types";
import type { SalaryType } from "@/hooks/useUserRole";
import type { PaymentShare } from "@/hooks/usePaymentShares";
import {
  findStudentPayments,
  filterPaymentsForTeacherRow,
  type PaymentLite,
} from "@/lib/studentPaymentMatcher";
import {
  calculateStudentSalary,
  matchSalarySetting,
  isAttendanceCountable,
  getEffectiveRatio,
} from "@/lib/salary";
import { isDateInSession } from "@/lib/sessionUtils";
import { filterStudentsByMonth } from "@/lib/studentFilter";
import { computeTeacherMonthPayroll } from "@/lib/teacherPayroll";

interface AttendanceRecord {
  id: string;
  teacher_id: string;
  student_id: string;
  class_name: string;
  date: string;
  hours: number;
  memo: string;
  cell_color?: string;
  homework?: boolean;
  is_makeup?: boolean;
}

interface AdminAllowance {
  tierId: string | null;
  baseAmount: number;
}

/**
 * 선생님별 정산 계산 (+ 과목별 breakdown).
 * SettlementPage.tsx 의 settlements useMemo 본체를 그대로 옮긴 것.
 */
export function computeSettlements(args: {
  visibleTeachers: Teacher[];
  students: Student[];
  attendanceRecords: AttendanceRecord[];
  salaryConfig: SalaryConfig;
  monthPayments: PaymentLite[];
  tierOverrides: Record<string, string>;
  year: number;
  month: number;
  allShares: PaymentShare[];
  mathSessions: SessionPeriod[];
  englishSessions: SessionPeriod[];
  payMode: "monthly" | "session";
  // closure 함수들 (useMemo dep array 와 동일하게 args 로 전달)
  getByTeacher: (teacherId: string) => MonthlySettlement;
  resolveSalary: (teacherId: string) => { type: SalaryType; days: string[] };
  hasPostForTeacher: (teacherId: string) => boolean;
  isBlogRequired: (teacherId: string) => boolean;
  getAdminAllowance: (teacherId: string) => AdminAllowance | null;
  isTeacherMatch: (
    e: { staffId?: string; teacher?: string },
    t: Teacher
  ) => boolean;
  isActiveInMonth: (e: { startDate?: string; endDate?: string }) => boolean;
}) {
  const {
    visibleTeachers,
    students,
    attendanceRecords,
    salaryConfig,
    monthPayments,
    tierOverrides,
    year,
    month,
    allShares,
    mathSessions,
    englishSessions,
    payMode,
    getByTeacher,
    resolveSalary,
    hasPostForTeacher,
    isBlogRequired,
    getAdminAllowance,
    isTeacherMatch,
    isActiveInMonth,
  } = args;

  return visibleTeachers.map((teacher) => {
    const settlement = getByTeacher(teacher.id);
    const effectiveConfig = settlement.isFinalized && settlement.salaryConfig
      ? settlement.salaryConfig
      : salaryConfig;

    // payment_shares 경로 — 영어/수학/과학 무관. sync 된 모든 선생님이 shares 저장됨.
    // 키는 `{student_id}|{class_name}` 으로 분반까지 분리 — 같은 학생이 여러 tier
    // 수강하는 경우 각 share 마다 독립 계산되어 출석부 탭과 완벽 일치.
    const teacherShares = allShares.filter((sh) => sh.teacher_staff_id === teacher.id);
    const useSharePath = teacherShares.length > 0;
    const isEnglishTeacher = !!teacher.subjects?.includes("english");
    const paidByRow = new Map<string, number>();
    const unitPriceByRow = new Map<string, number>();
    if (useSharePath) {
      for (const sh of teacherShares) {
        const key = sh.class_name
          ? `${sh.student_id}|${sh.class_name}`
          : sh.student_id;
        paidByRow.set(key, (paidByRow.get(key) || 0) + (sh.allocated_paid || 0));
        if (sh.unit_price && !unitPriceByRow.has(key)) {
          unitPriceByRow.set(key, sh.unit_price);
        }
      }
    }

    // 담당 학생 목록.
    // sync 된 선생님 (shares 있음): teacherShares.student_id 기준 — 출석부 탭과 동일.
    //   학생 대상이 Firebase + virtual 중복되지 않도록 shares 가 권위.
    // 미동기화 선생님: enrollments 매칭 + isActiveInMonth fallback.
    const studentById = new Map(students.map((s) => [s.id, s]));
    const teacherStudents = useSharePath
      ? (() => {
          const uniqueIds = new Set(teacherShares.map((sh) => sh.student_id));
          const list: Student[] = [];
          for (const id of uniqueIds) {
            const stu = studentById.get(id);
            if (stu) list.push(stu);
          }
          return list;
        })()
      : students.filter((s) =>
          s.enrollments?.some((e) => isTeacherMatch(e, teacher) && isActiveInMonth(e))
        );
    // 학생 id → subjects (이 선생님이 해당 학생에게 가르치는 과목들)
    const studentSubjects = new Map<string, Set<string>>();
    for (const s of teacherStudents) {
      const subs = new Set<string>();
      for (const e of s.enrollments || []) {
        if (isTeacherMatch(e, teacher) && isActiveInMonth(e)) {
          subs.add(e.subject || "기타");
        }
      }
      studentSubjects.set(s.id, subs);
    }

    const salaryInfo = resolveSalary(teacher.id);
    const salaryType = salaryInfo.type;
    const commissionDays = salaryInfo.days;
    const blogRequired = isBlogRequired(teacher.id);
    const blogPenalty = blogRequired && !hasPostForTeacher(teacher.id);

    // 이 선생님의 과목에 맞는 세션 범위 — 출석부 탭 세션모드와 동일.
    // 복수 과목이면 자신의 과목 세션 합집합. 세션 없으면 달력 월 prefix fallback.
    const monthStr = `${year}-${String(month).padStart(2, "0")}`;
    const teacherSubjectSet = new Set(teacher.subjects || []);
    const teacherSessions: SessionPeriod[] = [];
    if (teacherSubjectSet.has("math") || teacherSubjectSet.has("highmath")) {
      const ms = mathSessions.find((s) => s.month === month);
      if (ms) teacherSessions.push(ms);
    }
    if (teacherSubjectSet.has("english")) {
      const es = englishSessions.find((s) => s.month === month);
      if (es) teacherSessions.push(es);
    }
    const isDateInTeacherPeriod = (dateKey: string): boolean => {
      if (teacherSessions.length === 0) return dateKey.startsWith(monthStr);
      return teacherSessions.some((s) => isDateInSession(dateKey, s));
    };

    // 학생별 시수 (전체/countable).
    // 영어 교사: 학생×분반(class_name) 단위로도 별도 집계 — 출석부 탭과 동일.
    const studentUnitMap = new Map<string, number>();
    const studentTotalMap = new Map<string, number>();
    const rowUnitMap = new Map<string, number>(); // `{sid}|{class_name}`
    const rowTotalMap = new Map<string, number>();
    let totalAttendance = 0;
    let countableAttendance = 0;

    for (const r of attendanceRecords) {
      if (r.teacher_id !== teacher.id) continue;
      if (r.hours <= 0) continue;
      // 이 선생님 과목 세션 범위 밖은 제외 (출석부 탭 세션모드와 동일)
      if (!isDateInTeacherPeriod(r.date)) continue;
      const cn = r.class_name || "";
      const rowKey = cn ? `${r.student_id}|${cn}` : r.student_id;
      totalAttendance += r.hours;
      studentTotalMap.set(r.student_id, (studentTotalMap.get(r.student_id) || 0) + r.hours);
      rowTotalMap.set(rowKey, (rowTotalMap.get(rowKey) || 0) + r.hours);
      if (isAttendanceCountable(r.date, salaryType, commissionDays)) {
        countableAttendance += r.hours;
        studentUnitMap.set(r.student_id, (studentUnitMap.get(r.student_id) || 0) + r.hours);
        rowUnitMap.set(rowKey, (rowUnitMap.get(rowKey) || 0) + r.hours);
      }
    }

    // 과목별 집계
    const subjectAgg = new Map<string, {
      subject: string;
      studentCount: number;
      totalAttendance: number;
      countableAttendance: number;
      baseSalary: number;
    }>();
    const ensureSub = (sub: string) => {
      if (!subjectAgg.has(sub)) {
        subjectAgg.set(sub, {
          subject: sub,
          studentCount: 0,
          totalAttendance: 0,
          countableAttendance: 0,
          baseSalary: 0,
        });
      }
      return subjectAgg.get(sub)!;
    };

    let baseSalary = 0;

    // 선생님 subject → subjectHint 도출 (출석부 탭 selectedSubject 와 동일 의미)
    const teacherSubjectHint: "math" | "english" | "other" | undefined =
      teacherSubjectSet.has("english")
        ? "english"
        : teacherSubjectSet.has("math") || teacherSubjectSet.has("highmath")
          ? "math"
          : teacherSubjectSet.size > 0
            ? "other"
            : undefined;

    // 공통 계산 헬퍼 — 한 "행(row)" = 학생×분반 단위의 급여.
    // 영어는 share 단위로, 수학/기타는 학생 단위로 loop.
    const computeRow = (params: {
      student: Student;
      className: string;  // "" 이면 분반 미지정
      classUnits: number;
      totalUnits: number;
      paidAmount: number | null;
      unitPriceOverride: number | undefined;
    }) => {
      const { student, className, classUnits, totalUnits, paidAmount, unitPriceOverride } = params;
      if (classUnits <= 0) return { studentBase: 0, classUnits: 0, totalUnits: 0 };
      // tier override 키: 출석부 탭과 동일 — `{teacher_id}|{student_id}|{class_name}`
      // useAllTierOverrides 가 이 키로 저장. 레거시는 `{teacher_id}|{student_id}`.
      const overrideId =
        tierOverrides[`${teacher.id}|${student.id}|${className}`] ??
        tierOverrides[`${teacher.id}|${student.id}`];
      // subjectHint — 선생님 subjects 기반 (출석부 탭의 selectedSubject 와 동일)
      const settingItem = matchSalarySetting(student, effectiveConfig, teacherSubjectHint, overrideId);
      const baseRatio = settingItem
        ? getEffectiveRatio(settingItem, effectiveConfig, teacher.name)
        : undefined;
      const effectiveSetting =
        settingItem && baseRatio !== undefined
          ? { ...settingItem, ratio: baseRatio }
          : settingItem;
      const studentBase = calculateStudentSalary(
        effectiveSetting,
        effectiveConfig.academyFee,
        classUnits,
        paidAmount,
        blogPenalty,
        unitPriceOverride
      );
      return { studentBase, classUnits, totalUnits };
    };

    if (useSharePath) {
      // share 단위 loop — 출석부 탭 studentRows 와 1:1 대응.
      // 영어/수학/과학 무관 — shares 에 이 선생님의 분반별 할당 수납 정보가 있으면 사용.
      const subjectForShares = isEnglishTeacher
        ? "english"
        : teacherSubjectSet.has("math") || teacherSubjectSet.has("highmath")
          ? "math"
          : "other";
      for (const sh of teacherShares) {
        const student = studentById.get(sh.student_id);
        if (!student) continue;
        const className = sh.class_name || "";
        const rowKey = className ? `${sh.student_id}|${className}` : sh.student_id;
        const classUnits = rowUnitMap.get(rowKey) || 0;
        const totalUnits = rowTotalMap.get(rowKey) || 0;
        const paidAmount = sh.allocated_paid ?? null;
        const unitPriceOverride = sh.unit_price ?? undefined;
        const { studentBase } = computeRow({
          student,
          className,
          classUnits,
          totalUnits,
          paidAmount,
          unitPriceOverride,
        });
        baseSalary += studentBase;
        const row = ensureSub(subjectForShares);
        row.studentCount += 1;
        row.totalAttendance += totalUnits;
        row.countableAttendance += classUnits;
        row.baseSalary += studentBase;
      }
    } else {
      // 수학/기타 — 기존 student 단위 loop
      const isMathTeacher = !!teacher.subjects?.some(
        (s) => s === "math" || s === "highmath"
      );
      for (const student of teacherStudents) {
        const subs = Array.from(studentSubjects.get(student.id) || []);
        if (subs.length === 0) continue;
        const classUnits = studentUnitMap.get(student.id) || 0;
        const totalUnits = studentTotalMap.get(student.id) || 0;
        const share = 1 / subs.length;
        // 출석부 탭과 동일하게 filterPaymentsForTeacherRow 적용 —
        // 해당 선생님 + 수학 선생님이면 요일 패턴 포함 수납만.
        // (이 필터 없을 경우 다른 선생님 수납/행정 수납이 섞여 paidAmount 부풀려짐)
        const studentPayments = findStudentPayments(student, monthPayments);
        const filtered = filterPaymentsForTeacherRow(studentPayments, {
          teacherId: teacher.id,
          teacherName: teacher.name,
          teacherEnglishName: teacher.englishName,
          isMathTeacher,
        });
        const paidAmount =
          filtered.length > 0
            ? filtered.reduce((a, p) => a + (p.charge_amount || 0), 0)
            : null;
        const { studentBase } = computeRow({
          student,
          className: "",
          classUnits,
          totalUnits,
          paidAmount,
          unitPriceOverride: undefined,
        });
        baseSalary += studentBase;
        for (const sub of subs) {
          const row = ensureSub(sub);
          row.studentCount += share;
          row.totalAttendance += totalUnits * share;
          row.countableAttendance += classUnits * share;
          row.baseSalary += studentBase * share;
        }
      }
    }

    const subjects = Array.from(subjectAgg.values())
      .map((x) => ({
        ...x,
        studentCount: Math.round(x.studentCount * 10) / 10,
        totalAttendance: Math.round(x.totalAttendance * 10) / 10,
        countableAttendance: Math.round(x.countableAttendance * 10) / 10,
        baseSalary: Math.round(x.baseSalary),
      }))
      .sort((a, b) => b.baseSalary - a.baseSalary);

    // ⭐ 출석부 탭과 완벽히 동일한 값 — 공유 순수 함수 computeTeacherMonthPayroll 호출.
    //   기존 SettlementPage 자체 로직(위 baseSalary 계산)은 subject breakdown 용으로만 유지.
    //   최종 합계(baseSalary/finalSalary)는 출석부 탭과 동일한 파이프라인으로 덮어씀.
    const payrollFilteredStudents = filterStudentsByMonth(teacherStudents, year, month);
    const teacherDataMap = new Map<string, {
      attendance: Record<string, number>;
      memos: Record<string, string>;
      homework: Record<string, boolean>;
      cellColors: Record<string, string>;
    }>();
    for (const r of attendanceRecords) {
      if (r.teacher_id !== teacher.id) continue;
      const key = r.class_name ? `${r.student_id}|${r.class_name}` : r.student_id;
      let d = teacherDataMap.get(key);
      if (!d) {
        d = { attendance: {}, memos: {}, homework: {}, cellColors: {} };
        teacherDataMap.set(key, d);
      }
      if (r.hours > 0) d.attendance[r.date] = r.hours;
      if (r.memo) d.memos[r.date] = r.memo;
      if (r.homework) d.homework[r.date] = true;
      if (r.cell_color) d.cellColors[r.date] = r.cell_color;
    }
    // 이 선생님에 해당하는 tier override 만 payroll 포맷 (student_id | student_id|className) 으로 변환
    const teacherTierOverrides: Record<string, string> = {};
    const prefix = `${teacher.id}|`;
    for (const [k, v] of Object.entries(tierOverrides)) {
      if (!k.startsWith(prefix)) continue;
      const rest = k.slice(prefix.length);
      // rest = "studentId" 또는 "studentId|className"
      teacherTierOverrides[rest] = v;
    }
    // 행정수당
    const aa = getAdminAllowance(teacher.id);
    let adminSalary = 0;
    if (aa) {
      const item = (effectiveConfig.items || []).find((i) => i.id === aa.tierId);
      if (item) {
        const ratio = getEffectiveRatio(item, effectiveConfig, teacher.name);
        adminSalary = Math.floor(
          aa.baseAmount * (ratio / 100) * (1 - effectiveConfig.academyFee / 100)
        );
      }
    }
    const monthStrFmt = `${year}-${String(month).padStart(2, "0")}`;
    const isDateInPeriodMonthly = (dk: string) => dk.startsWith(monthStrFmt);
    // 세션별 모드: 선생님 주과목의 해당 월 세션을 찾아 그 범위로 집계.
    //   - 영어 선생님 → englishSessions, 수학/고등수학/과학 등 → mathSessions
    //   - 해당 월 세션이 없으면 안전하게 월별 fallback
    let isDateInPeriod: (dk: string) => boolean = isDateInPeriodMonthly;
    if (payMode === "session") {
      const useEnglishSessions = isEnglishTeacher;
      const pool = useEnglishSessions ? englishSessions : mathSessions;
      const sess = pool.find((sp) => sp.month === month);
      if (sess) {
        isDateInPeriod = (dk: string) => isDateInSession(dk, sess);
      }
    }
    const payroll = computeTeacherMonthPayroll({
      teacher,
      filteredStudents: payrollFilteredStudents,
      allStudents: students,
      rawMonthPayments: monthPayments,
      monthPayments,
      teacherShares,
      salaryConfig: effectiveConfig,
      studentDataMap: teacherDataMap,
      tierOverrides: teacherTierOverrides,
      settlement,
      adminSalary,
      blogPenalty,
      year,
      month,
      isDateInPeriod,
      salaryType,
      commissionDays,
      subject: teacherSubjectHint,
      isEnglishTeacher,
    });

    return {
      teacher,
      studentCount: payroll.studentCount,
      totalAttendance: payroll.totalAttendance,
      countableAttendance: payroll.countableAttendance,
      baseSalary: payroll.totalSalary,
      finalSalary: payroll.finalSalary,
      settlement,
      salaryType,
      commissionDays,
      blogRequired,
      blogPenalty,
      subjects,
    };
  });
}
