"use client";

import { useState, useMemo, useCallback, Fragment } from "react";
import { useStaff } from "@/hooks/useStaff";
import { useStudents } from "@/hooks/useStudents";
import { useAllAttendance } from "@/hooks/useAllAttendance";
import { useMonthlySettlement } from "@/hooks/useMonthlySettlement";
import { useHiddenTeachers } from "@/hooks/useHiddenTeachers";
import { useAllUserRoles } from "@/hooks/useAllUserRoles";
import { useAllBlogPosts } from "@/hooks/useAllBlogPosts";
import { useSalaryConfig } from "@/hooks/useSalaryConfig";
import { useTeacherSettings } from "@/hooks/useTeacherSettings";
import { usePaymentsForMonth } from "@/hooks/usePaymentsForMonth";
import { useLocalStorage, useLocalStorageSet } from "@/hooks/useLocalStorage";
import { useAllTierOverrides } from "@/hooks/useAllTierOverrides";
import { useSessionPeriods } from "@/hooks/useSessionPeriods";
import { findStudentPayments } from "@/lib/studentPaymentMatcher";
import type { Teacher, Student } from "@/types";
import type { SalaryType } from "@/hooks/useUserRole";
import {
  calculateStudentSalary,
  matchSalarySetting,
  calculateFinalSalary,
  isAttendanceCountable,
  subjectToSalarySubject,
} from "@/lib/salary";
import { toSubjectLabel } from "@/lib/labelMap";

export default function SettlementPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [tab, setTab] = useLocalStorage<"settlement" | "hours">("settlement.tab", "settlement");
  const [hoursSubjectFilter, setHoursSubjectFilter] = useLocalStorage<string[]>("settlement.hoursSubjects", []);
  const [hoursSearch, setHoursSearch] = useLocalStorage<string>("settlement.hoursSearch", "");
  const [hoursOnlyDiff, setHoursOnlyDiff] = useLocalStorage<boolean>("settlement.hoursOnlyDiff", false);
  const { config: salaryConfig } = useSalaryConfig();

  const { teachers, loading: staffLoading } = useStaff();
  const { students, loading: studentsLoading } = useStudents();

  // 세션 기반 급여: 이 월에 매핑된 모든 과목 세션의 합집합 날짜 범위로 출석을 로드.
  // (예: 수학 3월 세션 = 3/6~4/2, 영어 3월 세션 = ... → union)
  const { sessions: mathSessions } = useSessionPeriods(year, "math");
  const { sessions: englishSessions } = useSessionPeriods(year, "english");
  const sessionRange = useMemo(() => {
    const all = [...mathSessions, ...englishSessions].filter((s) => s.month === month);
    const ranges = all.flatMap((s) => s.ranges || []);
    if (ranges.length === 0) return null;
    const sorted = [...ranges].sort((a, b) => a.startDate.localeCompare(b.startDate));
    return {
      startDate: sorted[0].startDate,
      endDate: [...ranges].sort((a, b) => b.endDate.localeCompare(a.endDate))[0].endDate,
    };
  }, [mathSessions, englishSessions, month]);

  const { records: attendanceRecords, loading: attendanceLoading } = useAllAttendance(
    year,
    month,
    sessionRange
  );
  const { getByTeacher, loading: settlementLoading } = useMonthlySettlement(year, month);
  const { hiddenTeacherIds } = useHiddenTeachers();
  const { users: userRoles } = useAllUserRoles();
  const { hasPostForTeacher } = useAllBlogPosts(year, month);
  const { isBlogRequired, getSalary } = useTeacherSettings();
  const { payments: monthPayments, loading: paymentsLoading } = usePaymentsForMonth(year, month);
  const { overrides: tierOverrides } = useAllTierOverrides();

  // 선생님 id → 급여 유형 매핑
  // 우선순위: teacher_settings(staff_id) → user_roles fallback → 기본 commission
  const userRoleSalaryMap = useMemo(() => {
    const map = new Map<string, { type: SalaryType; days: string[] }>();
    userRoles.forEach((u) => {
      if ((u.role === "teacher" || u.role === "admin") && u.staff_id) {
        map.set(u.staff_id, {
          type: u.salary_type || "commission",
          days: u.commission_days || [],
        });
      }
    });
    return map;
  }, [userRoles]);

  const resolveSalary = useCallback(
    (teacherId: string): { type: SalaryType; days: string[] } =>
      getSalary(teacherId) ||
      userRoleSalaryMap.get(teacherId) || {
        type: "commission" as SalaryType,
        days: [],
      },
    [getSalary, userRoleSalaryMap]
  );

  // 선생님 매칭 함수
  const isTeacherMatch = (
    enrollment: { staffId?: string; teacher?: string },
    teacher: Teacher
  ) => {
    const sid = enrollment.staffId || "";
    const tname = enrollment.teacher || "";
    // enrollment 식별자가 하나도 없으면 매칭 불가 (빈 문자열끼리 매칭되는 버그 방지)
    if (!sid && !tname) return false;
    return (
      (!!sid && (sid === teacher.id || sid === teacher.name || (!!teacher.englishName && sid === teacher.englishName))) ||
      (!!tname && (tname === teacher.name || (!!teacher.englishName && tname === teacher.englishName)))
    );
  };

  // 선택된 월에 enrollment 가 활성(재원)인지 판정
  // startDate <= 월 마지막날 && (endDate 없음 || endDate >= 월 첫날)
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEnd = `${year}-${String(month).padStart(2, "0")}-${new Date(year, month, 0).getDate()}`;
  const isActiveInMonth = (e: { startDate?: string; endDate?: string }) => {
    if (e.startDate && e.startDate > monthEnd) return false;
    if (e.endDate && e.endDate < monthStart) return false;
    return true;
  };

  // 과목 필터 (TeacherList 스타일) — 빈 Set 은 전체 선택으로 간주
  const [checkedSubjects, setCheckedSubjects] = useLocalStorageSet("settlement.subjects");

  // 표시할 선생님 (숨김 제외, 담당학생 0 제외, 과목 없음 제외)
  // 과목 필터는 여기선 적용 안함 (allSubjects 집계에 영향 주지 않도록).
  // 실제 표시 목록은 아래 settlements 에서 과목 필터 적용.
  const visibleTeachers = useMemo(() => {
    return teachers.filter((t) => {
      if (!t.subjects || t.subjects.length === 0) return false;
      if (hiddenTeacherIds.has(t.id)) return false;
      const studentCount = students.filter((s) =>
        s.enrollments?.some((e) => isTeacherMatch(e, t) && isActiveInMonth(e))
      ).length;
      return studentCount > 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teachers, students, hiddenTeacherIds, year, month]);

  // visibleTeachers 에서 나타나는 모든 과목 집합
  const allSubjects = useMemo(() => {
    const set = new Set<string>();
    visibleTeachers.forEach((t) => t.subjects?.forEach((s) => set.add(s)));
    return Array.from(set).sort();
  }, [visibleTeachers]);

  // 빈 Set → 전체 선택. 사용자가 하나라도 체크/해제하면 그 상태로 유지.
  const effectiveCheckedSubjects = useMemo(
    () => (checkedSubjects.size === 0 ? new Set(allSubjects) : checkedSubjects),
    [checkedSubjects, allSubjects]
  );

  const toggleSubject = (subject: string) => {
    const next = new Set(effectiveCheckedSubjects);
    if (next.has(subject)) next.delete(subject);
    else next.add(subject);
    setCheckedSubjects(next);
  };
  const toggleAllSubjects = () => {
    if (effectiveCheckedSubjects.size === allSubjects.length) {
      setCheckedSubjects(new Set()); // 빈 → 전체
    } else {
      setCheckedSubjects(new Set(allSubjects));
    }
  };

  // 선생님별 정산 계산 (+ 과목별 breakdown)
  const settlements = useMemo(() => {
    return visibleTeachers.map((teacher) => {
      const settlement = getByTeacher(teacher.id);
      const effectiveConfig = settlement.isFinalized && settlement.salaryConfig
        ? settlement.salaryConfig
        : salaryConfig;

      // 담당 학생 목록 (해당 월 기준 재원 중인 학생만) + 해당 학생의 과목 집합
      const teacherStudents = students.filter((s) =>
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

      // 학생별 시수 (전체/countable)
      const studentUnitMap = new Map<string, number>();
      const studentTotalMap = new Map<string, number>();
      let totalAttendance = 0;
      let countableAttendance = 0;

      for (const r of attendanceRecords) {
        if (r.teacher_id !== teacher.id) continue;
        if (r.hours <= 0) continue;
        totalAttendance += r.hours;
        studentTotalMap.set(r.student_id, (studentTotalMap.get(r.student_id) || 0) + r.hours);
        if (isAttendanceCountable(r.date, salaryType, commissionDays)) {
          countableAttendance += r.hours;
          studentUnitMap.set(r.student_id, (studentUnitMap.get(r.student_id) || 0) + r.hours);
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
      for (const student of teacherStudents) {
        const subs = Array.from(studentSubjects.get(student.id) || []);
        if (subs.length === 0) continue;
        const classUnits = studentUnitMap.get(student.id) || 0;
        const totalUnits = studentTotalMap.get(student.id) || 0;

        // 여러 과목이면 시수/급여를 균등 분배
        const share = 1 / subs.length;
        const studentPayments = findStudentPayments(student, monthPayments);

        let studentBase = 0;
        if (classUnits > 0) {
          const settingItem = matchSalarySetting(student, effectiveConfig, undefined, tierOverrides[`${teacher.id}|${student.id}`]);
          const paidAmount =
            studentPayments.length > 0
              ? studentPayments.reduce((a, p) => a + (p.charge_amount || 0), 0)
              : null;
          studentBase = calculateStudentSalary(
            settingItem,
            effectiveConfig.academyFee,
            classUnits,
            paidAmount,
            blogPenalty
          );
        }
        baseSalary += studentBase;

        for (const sub of subs) {
          const row = ensureSub(sub);
          row.studentCount += share;
          row.totalAttendance += totalUnits * share;
          row.countableAttendance += classUnits * share;
          row.baseSalary += studentBase * share;
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

      const finalSalary = calculateFinalSalary(
        baseSalary,
        effectiveConfig.incentives,
        settlement
      );

      return {
        teacher,
        studentCount: teacherStudents.length,
        totalAttendance,
        countableAttendance,
        baseSalary,
        finalSalary,
        settlement,
        salaryType,
        commissionDays,
        blogRequired,
        blogPenalty,
        subjects,
      };
    });
  }, [visibleTeachers, students, attendanceRecords, getByTeacher, salaryConfig, resolveSalary, hasPostForTeacher, isBlogRequired, monthPayments, tierOverrides, year, month]);

  // 과목 필터 적용된 정산 목록 — UI 표시 · 합계 집계에 사용
  const filteredSettlements = useMemo(() => {
    if (effectiveCheckedSubjects.size === allSubjects.length) return settlements;
    return settlements.filter((s) =>
      (s.teacher.subjects || []).some((sub) => effectiveCheckedSubjects.has(sub))
    );
  }, [settlements, effectiveCheckedSubjects, allSubjects]);

  // 합계 (필터 반영)
  const totals = useMemo(() => {
    return filteredSettlements.reduce(
      (acc, s) => ({
        studentCount: acc.studentCount + s.studentCount,
        totalAttendance: acc.totalAttendance + s.totalAttendance,
        baseSalary: acc.baseSalary + s.baseSalary,
        finalSalary: acc.finalSalary + s.finalSalary,
      }),
      { studentCount: 0, totalAttendance: 0, baseSalary: 0, finalSalary: 0 }
    );
  }, [filteredSettlements]);

  // 학생별 시수 검증: 과목별로 납부액 vs 실제 수강 시수 × 기준단가
  const studentChecks = useMemo(() => {
    const monthStr = `${year}-${String(month).padStart(2, "0")}`;

    // 선생님 id → teacher 객체 (staff_id/이름 매칭용)
    const teacherById = new Map<string, Teacher>();
    for (const t of teachers) teacherById.set(t.id, t);

    // (studentId, teacherId) → hours
    const hoursByStudentTeacher = new Map<string, number>();
    for (const r of attendanceRecords) {
      if (r.hours <= 0) continue;
      if (!r.date.startsWith(monthStr)) continue;
      const key = `${r.student_id}|${r.teacher_id}`;
      hoursByStudentTeacher.set(key, (hoursByStudentTeacher.get(key) || 0) + r.hours);
    }

    const rows: Array<{
      student: Student;
      subject: string;
      teacherNames: string;
      units: number;
      paid: number;
      unitPrice: number;
      expectedSessions: number;
      diffSessions: number;
      diffAmount: number;
      hasPayment: boolean;
      teacherBreakdown: Array<{
        teacherName: string;
        units: number;
        paid: number;
      }>;
    }> = [];

    for (const s of students) {
      const activeEnrollments = (s.enrollments || []).filter(isActiveInMonth);
      if (activeEnrollments.length === 0) {
        // 출석도 없고 enrollment도 없으면 skip. 단, 수납만 있는 경우는 "기타"로 한 번 표시
        const payList = findStudentPayments(s, monthPayments);
        if (payList.length === 0) continue;
        const paid = payList.reduce((a, p) => a + (p.charge_amount || 0), 0);
        rows.push({
          student: s,
          subject: "미등록",
          teacherNames: "-",
          units: 0,
          paid,
          unitPrice: 0,
          expectedSessions: 0,
          diffSessions: 0,
          diffAmount: paid,
          hasPayment: true,
          teacherBreakdown: [],
        });
        continue;
      }

      // 과목별로 enrollment 묶기
      const bySubject = new Map<string, typeof activeEnrollments>();
      for (const e of activeEnrollments) {
        const sub = e.subject || "기타";
        if (!bySubject.has(sub)) bySubject.set(sub, []);
        bySubject.get(sub)!.push(e);
      }

      const allPayments = findStudentPayments(s, monthPayments);

      for (const [subject, enrolls] of bySubject) {
        // 해당 과목의 선생님들
        const teacherIds = new Set<string>();
        const teacherNames = new Set<string>();
        for (const e of enrolls) {
          let tid: string | undefined;
          if (e.staffId && teacherById.has(e.staffId)) {
            tid = e.staffId;
          } else {
            // 이름으로 매칭
            const found = teachers.find(
              (t) =>
                t.name === e.teacher ||
                t.englishName === e.teacher ||
                t.name === e.staffId ||
                t.englishName === e.staffId
            );
            if (found) tid = found.id;
          }
          if (tid) {
            teacherIds.add(tid);
            const t = teacherById.get(tid);
            if (t) teacherNames.add(t.name);
          } else if (e.teacher) {
            teacherNames.add(e.teacher);
          }
        }

        // 선생님별 시수/수납 breakdown
        const teacherBreakdown: Array<{ teacherName: string; units: number; paid: number }> = [];
        let units = 0;
        for (const tid of teacherIds) {
          const tUnits = hoursByStudentTeacher.get(`${s.id}|${tid}`) || 0;
          const tPaid = allPayments
            .filter((p) => p.teacher_staff_id === tid)
            .reduce((a, p) => a + (p.charge_amount || 0), 0);
          units += tUnits;
          teacherBreakdown.push({
            teacherName: teacherById.get(tid)?.name || tid,
            units: tUnits,
            paid: tPaid,
          });
        }

        // 해당 과목 선생님의 수납만 합산 (teacher_staff_id 기준)
        const subjectPayments = allPayments.filter(
          (p) => p.teacher_staff_id && teacherIds.has(p.teacher_staff_id)
        );
        // teacher_staff_id 가 없으면 (레거시) 과목 분리 불가 → 폴백으로 모든 수납을 첫 과목에만 반영
        const paid = subjectPayments.reduce((a, p) => a + (p.charge_amount || 0), 0);

        // 과목의 선생님 중 첫 번째로 발견되는 tier 오버라이드 사용
        let tierOverrideId: string | undefined;
        for (const tid of teacherIds) {
          const ov = tierOverrides[`${tid}|${s.id}`];
          if (ov) { tierOverrideId = ov; break; }
        }
        const setting = matchSalarySetting(s, salaryConfig, subjectToSalarySubject(subject), tierOverrideId);
        const unitPrice = setting?.baseTuition || 0;
        const expectedSessions = unitPrice > 0 ? paid / unitPrice : 0;
        const diffSessions = expectedSessions - units;
        const diffAmount = paid - units * unitPrice;

        // 시수도 0이고 수납도 0이면 skip
        if (units === 0 && subjectPayments.length === 0) continue;

        rows.push({
          student: s,
          subject,
          teacherNames: Array.from(teacherNames).join(", ") || "-",
          units,
          paid,
          unitPrice,
          expectedSessions,
          diffSessions,
          diffAmount,
          hasPayment: subjectPayments.length > 0,
          teacherBreakdown,
        });
      }
    }

    // 차이가 있는 항목 우선 정렬 (절대값 큰 순)
    rows.sort((a, b) => Math.abs(b.diffSessions) - Math.abs(a.diffSessions));
    return rows;
  }, [students, teachers, attendanceRecords, monthPayments, salaryConfig, tierOverrides, year, month]);

  const loading = staffLoading || studentsLoading || attendanceLoading || settlementLoading || paymentsLoading;

  const prevMonth = () => {
    if (month === 1) { setYear(year - 1); setMonth(12); }
    else setMonth(month - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setYear(year + 1); setMonth(1); }
    else setMonth(month + 1);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-zinc-400 text-sm">불러오는 중...</div>;
  }

  return (
    <div className="mx-auto max-w-6xl">
      {/* 헤더 + 월 페이지네이션 */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
          월별 정산
          <span className="ml-2 text-sm font-normal text-zinc-500">
            ({filteredSettlements.length}명)
          </span>
        </h2>

        <div className="flex items-center gap-1">
          <button
            onClick={prevMonth}
            className="rounded-sm border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            ◀ 이전 달
          </button>
          <span className="px-4 py-1.5 text-sm font-bold text-zinc-900 dark:text-zinc-100 min-w-[120px] text-center">
            {year}년 {month}월
          </span>
          <button
            onClick={nextMonth}
            className="rounded-sm border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            다음 달 ▶
          </button>
        </div>
      </div>

      {/* 내부 탭 */}
      <div className="mb-3 flex items-center gap-1 border-b border-zinc-200 dark:border-zinc-800">
        <button
          onClick={() => setTab("settlement")}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
            tab === "settlement"
              ? "border-blue-500 text-blue-600 dark:text-blue-400"
              : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          }`}
        >
          월별 정산
        </button>
        <button
          onClick={() => setTab("hours")}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
            tab === "hours"
              ? "border-blue-500 text-blue-600 dark:text-blue-400"
              : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          }`}
        >
          시수 검증
          <span className="ml-1 text-xs text-zinc-400">({studentChecks.length})</span>
        </button>
      </div>

      {tab === "settlement" && (
      <>
      {/* 과목 필터 (체크박스 토글) — TeacherList 동일 스타일 */}
      <div className="flex items-center gap-2 mb-3 overflow-x-auto [&>*]:flex-shrink-0">
        <button
          onClick={toggleAllSubjects}
          className="text-xs px-2 py-1 rounded-sm border border-zinc-300 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          {effectiveCheckedSubjects.size === allSubjects.length ? "전체 해제" : "전체 선택"}
        </button>
        {allSubjects.map((s) => {
          const checked = effectiveCheckedSubjects.has(s);
          return (
            <button
              key={s}
              onClick={() => toggleSubject(s)}
              className={`text-xs px-2.5 py-1 rounded-sm border transition-colors ${
                checked
                  ? "bg-blue-100 border-blue-400 text-blue-700 dark:bg-blue-900 dark:border-blue-600 dark:text-blue-300"
                  : "bg-white border-zinc-300 text-zinc-400 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-500"
              }`}
            >
              <span className="mr-1">{checked ? "☑" : "☐"}</span>
              {toSubjectLabel(s)}
            </button>
          );
        })}
      </div>

      {/* 전체 합계 카드 */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <StatCard label="선생님" value={`${filteredSettlements.length}명`} />
        <StatCard label="총 담당학생" value={`${totals.studentCount}명`} />
        <StatCard label="총 출석" value={`${totals.totalAttendance}회`} />
        <StatCard label="총 지급액" value={`${totals.finalSalary.toLocaleString()}원`} highlight />
      </div>

      {/* 선생님별 정산 표 */}
      <div className="overflow-x-auto border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="min-w-full text-sm [&_td]:border-r [&_td]:border-zinc-200 [&_th]:border-r [&_th]:border-zinc-300 [&_th]:whitespace-nowrap">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/50">
              <th className="px-3 py-3 text-left font-medium text-zinc-500">#</th>
              <th className="px-3 py-3 text-left font-medium text-zinc-500">선생님</th>
              <th className="px-3 py-3 text-left font-medium text-zinc-500">과목</th>
              <th className="px-3 py-3 text-left font-medium text-zinc-500">급여유형</th>
              <th className="px-3 py-3 text-right font-medium text-zinc-500">담당학생</th>
              <th className="px-3 py-3 text-right font-medium text-zinc-500">출석</th>
              <th className="px-3 py-3 text-right font-medium text-zinc-500">기본급여</th>
              <th className="px-3 py-3 text-right font-medium text-zinc-500">인센티브</th>
              <th className="px-3 py-3 text-right font-medium text-zinc-500">최종 지급액</th>
              <th className="px-3 py-3 text-center font-medium text-zinc-500">확정</th>
            </tr>
          </thead>
          <tbody>
            {filteredSettlements.map((s, idx) => {
              const incentiveTotal = s.finalSalary - s.baseSalary;
              return (
                <Fragment key={s.teacher.id}>
                <tr
                  className="border-b border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/30"
                >
                  <td className="px-3 py-3 text-zinc-400">{idx + 1}</td>
                  <td className="px-3 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                    {s.teacher.name}
                    {s.teacher.englishName && (
                      <span className="ml-1 text-xs text-zinc-400">({s.teacher.englishName})</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-zinc-500 text-xs">
                    {s.teacher.subjects?.map(toSubjectLabel).join(", ") || "-"}
                  </td>
                  <td className="px-3 py-3 text-xs">
                    <span className={`inline-flex rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${
                      s.salaryType === "commission"
                        ? "bg-blue-50 text-blue-700"
                        : s.salaryType === "fixed"
                        ? "bg-zinc-100 text-zinc-500"
                        : "bg-purple-50 text-purple-700"
                    }`}>
                      {s.salaryType === "commission" ? "비율제" : s.salaryType === "fixed" ? "급여제" : "혼합"}
                    </span>
                    {s.salaryType === "mixed" && s.commissionDays.length > 0 && (
                      <div className="mt-0.5 text-[9px] text-zinc-400">
                        {s.commissionDays.join(",")}
                      </div>
                    )}
                    {s.blogPenalty && (
                      <div className="mt-0.5 inline-flex rounded-sm bg-red-100 px-1 py-0 text-[9px] font-bold text-red-700 dark:bg-red-900 dark:text-red-300">
                        블로그 -2%
                      </div>
                    )}
                    {s.blogRequired && !s.blogPenalty && (
                      <div className="mt-0.5 inline-flex rounded-sm bg-emerald-100 px-1 py-0 text-[9px] font-bold text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
                        블로그 ✓
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right text-zinc-600 dark:text-zinc-400">
                    {s.studentCount}명
                  </td>
                  <td className="px-3 py-3 text-right text-zinc-600 dark:text-zinc-400">
                    {s.salaryType === "mixed" ? (
                      <>
                        <span className="font-bold">{s.countableAttendance}</span>
                        <span className="text-[10px] text-zinc-400"> / {s.totalAttendance}</span>
                      </>
                    ) : (
                      s.totalAttendance
                    )}
                  </td>
                  <td className="px-3 py-3 text-right text-zinc-700 dark:text-zinc-300">
                    {s.baseSalary.toLocaleString()}원
                  </td>
                  <td className="px-3 py-3 text-right text-zinc-600 dark:text-zinc-400">
                    {incentiveTotal > 0 ? `+${incentiveTotal.toLocaleString()}원` : "-"}
                  </td>
                  <td className="px-3 py-3 text-right font-bold text-blue-600 dark:text-blue-400">
                    {s.finalSalary.toLocaleString()}원
                  </td>
                  <td className="px-3 py-3 text-center">
                    {s.settlement.isFinalized ? (
                      <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
                        🔒 확정
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                        미확정
                      </span>
                    )}
                  </td>
                </tr>
                {s.subjects.length > 1 && s.subjects.map((sub) => (
                  <tr
                    key={sub.subject}
                    className="border-b border-zinc-100 bg-zinc-50/40 text-xs text-zinc-500 dark:border-zinc-900 dark:bg-zinc-900/40"
                  >
                    <td className="px-3 py-1" />
                    <td className="px-3 py-1 pl-6 text-zinc-500">└ 과목별</td>
                    <td className="px-3 py-1">{toSubjectLabel(sub.subject)}</td>
                    <td className="px-3 py-1" />
                    <td className="px-3 py-1 text-right">{sub.studentCount}명</td>
                    <td className="px-3 py-1 text-right">
                      {s.salaryType === "mixed"
                        ? `${sub.countableAttendance} / ${sub.totalAttendance}`
                        : sub.totalAttendance}
                    </td>
                    <td className="px-3 py-1 text-right">{sub.baseSalary.toLocaleString()}원</td>
                    <td className="px-3 py-1" />
                    <td className="px-3 py-1" />
                    <td className="px-3 py-1" />
                  </tr>
                ))}
                <tr className="h-0"><td colSpan={10} className="border-b border-zinc-300 dark:border-zinc-700 p-0" /></tr>
                </Fragment>
              );
            })}

            {/* 합계 행 */}
            {filteredSettlements.length > 0 && (
              <tr className="border-t-2 border-zinc-300 bg-zinc-50 font-bold dark:border-zinc-600 dark:bg-zinc-800/50">
                <td colSpan={4} className="px-3 py-3 text-right text-zinc-700 dark:text-zinc-300">
                  합계
                </td>
                <td className="px-3 py-3 text-right text-zinc-700 dark:text-zinc-300">
                  {totals.studentCount}명
                </td>
                <td className="px-3 py-3 text-right text-zinc-700 dark:text-zinc-300">
                  {totals.totalAttendance}
                </td>
                <td className="px-3 py-3 text-right text-zinc-700 dark:text-zinc-300">
                  {totals.baseSalary.toLocaleString()}원
                </td>
                <td className="px-3 py-3 text-right text-zinc-700 dark:text-zinc-300">
                  {(totals.finalSalary - totals.baseSalary).toLocaleString()}원
                </td>
                <td className="px-3 py-3 text-right text-blue-600 dark:text-blue-400 text-base">
                  {totals.finalSalary.toLocaleString()}원
                </td>
                <td />
              </tr>
            )}
          </tbody>
        </table>

        {filteredSettlements.length === 0 && (
          <div className="flex items-center justify-center h-32 text-zinc-400 text-sm">
            표시할 정산 데이터가 없습니다.
          </div>
        )}
      </div>
      </>
      )}

      {tab === "hours" && (
      <div>
        <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-1">
          학생별 시수 검증
          <span className="ml-2 text-sm font-normal text-zinc-500">
            청구액 ÷ 기준단가 vs 실제 출석시수
          </span>
        </h3>
        <p className="text-xs text-zinc-500 mb-2">
          + 는 청구 대비 수업이 남은 상태, − 는 청구 대비 수업을 더 들은 상태입니다.
        </p>
        {(() => {
          const allSubjects = Array.from(new Set(studentChecks.map((r) => r.subject)));
          return (
            <div className="flex flex-wrap items-center gap-1 mb-2">
              <input
                type="text"
                placeholder="학생 이름 검색"
                value={hoursSearch}
                onChange={(e) => setHoursSearch(e.target.value)}
                className="rounded-sm border border-zinc-300 px-2 py-1 text-xs mr-2 w-40 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              />
              <span className="text-xs text-zinc-500 mr-1">과목:</span>
              <button
                onClick={() => setHoursSubjectFilter([])}
                className={`px-2 py-1 text-xs rounded-sm border ${
                  hoursSubjectFilter.length === 0
                    ? "bg-blue-500 text-white border-blue-500"
                    : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }`}
              >
                전체
              </button>
              {allSubjects.map((sub) => {
                const active = hoursSubjectFilter.includes(sub);
                return (
                  <button
                    key={sub}
                    onClick={() =>
                      setHoursSubjectFilter(
                        active ? hoursSubjectFilter.filter((x) => x !== sub) : [...hoursSubjectFilter, sub]
                      )
                    }
                    className={`px-2 py-1 text-xs rounded-sm border ${
                      active
                        ? "bg-blue-500 text-white border-blue-500"
                        : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    }`}
                  >
                    {toSubjectLabel(sub)}
                  </button>
                );
              })}

              <div className="mx-1 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />

              <button
                onClick={() => setHoursOnlyDiff(!hoursOnlyDiff)}
                className={`px-2 py-1 text-xs rounded-sm border transition-colors ${
                  hoursOnlyDiff
                    ? "bg-amber-100 border-amber-400 text-amber-700 dark:bg-amber-900 dark:border-amber-600 dark:text-amber-300"
                    : "bg-white border-zinc-300 text-zinc-500 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-400"
                }`}
                title="청구 대비 실제 출석 차이가 있는 건만 표시"
              >
                <span className="mr-1">{hoursOnlyDiff ? "☑" : "☐"}</span>
                차이 있는 건만
              </button>
            </div>
          );
        })()}
        <div className="overflow-x-auto border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <table className="min-w-full text-sm [&_td]:border-r [&_td]:border-zinc-200 [&_th]:border-r [&_th]:border-zinc-300 [&_th]:whitespace-nowrap">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/50">
                <th className="px-3 py-3 text-left font-medium text-zinc-500">#</th>
                <th className="px-3 py-3 text-left font-medium text-zinc-500">학생</th>
                <th className="px-3 py-3 text-left font-medium text-zinc-500">과목</th>
                <th className="px-3 py-3 text-left font-medium text-zinc-500">선생님</th>
                <th className="px-3 py-3 text-right font-medium text-zinc-500">기준단가</th>
                <th className="px-3 py-3 text-right font-medium text-zinc-500">청구액</th>
                <th className="px-3 py-3 text-right font-medium text-zinc-500">예상시수</th>
                <th className="px-3 py-3 text-right font-medium text-zinc-500">실제시수</th>
                <th className="px-3 py-3 text-right font-medium text-zinc-500">차이 (회)</th>
                <th className="px-3 py-3 text-right font-medium text-zinc-500">차이 (원)</th>
              </tr>
            </thead>
            <tbody>
              {studentChecks
                .filter((r) => hoursSubjectFilter.length === 0 || hoursSubjectFilter.includes(r.subject))
                .filter((r) => !hoursSearch.trim() || r.student.name.toLowerCase().includes(hoursSearch.trim().toLowerCase()))
                .filter((r) => !hoursOnlyDiff || Math.abs(r.diffSessions) > 0.001)
                .map((r, idx) => {
                const noPrice = r.unitPrice <= 0;
                const noPay = !r.hasPayment;
                const diffAbs = Math.abs(r.diffSessions);
                const isWarn = !noPrice && !noPay && diffAbs >= 1;
                const isOk = !noPrice && !noPay && diffAbs < 0.5;
                const sessionColor = noPrice || noPay
                  ? "text-zinc-400"
                  : r.diffSessions > 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : r.diffSessions < 0
                  ? "text-red-600 dark:text-red-400"
                  : "text-zinc-500";
                return (
                  <Fragment key={`${r.student.id}|${r.subject}`}>
                  <tr
                    className={`border-b border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/30 ${
                      isWarn ? "bg-amber-50/40 dark:bg-amber-950/10" : ""
                    }`}
                  >
                    <td className="px-3 py-2 text-zinc-400">{idx + 1}</td>
                    <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">
                      {r.student.name}
                      {r.student.school && (
                        <span className="ml-1 text-xs text-zinc-400">({r.student.school})</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-500">{toSubjectLabel(r.subject)}</td>
                    <td className="px-3 py-2 text-xs text-zinc-500">{r.teacherNames || "-"}</td>
                    <td className="px-3 py-2 text-right text-zinc-600 dark:text-zinc-400">
                      {r.unitPrice > 0 ? `${r.unitPrice.toLocaleString()}원` : "-"}
                    </td>
                    <td className="px-3 py-2 text-right text-zinc-700 dark:text-zinc-300">
                      {r.hasPayment ? `${r.paid.toLocaleString()}원` : <span className="text-zinc-400">청구 없음</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-zinc-600 dark:text-zinc-400">
                      {noPrice || noPay ? "-" : r.expectedSessions.toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-right text-zinc-600 dark:text-zinc-400">
                      {r.units}
                    </td>
                    <td className={`px-3 py-2 text-right font-bold ${sessionColor}`}>
                      {noPrice || noPay
                        ? "-"
                        : r.diffSessions > 0
                        ? `+${r.diffSessions.toFixed(1)}`
                        : r.diffSessions.toFixed(1)}
                      {isOk && <span className="ml-1 text-[10px] font-normal text-emerald-500">✓</span>}
                    </td>
                    <td className={`px-3 py-2 text-right text-xs ${sessionColor}`}>
                      {noPrice || noPay
                        ? "-"
                        : r.diffAmount > 0
                        ? `+${r.diffAmount.toLocaleString()}원`
                        : `${r.diffAmount.toLocaleString()}원`}
                    </td>
                  </tr>
                  {r.teacherBreakdown.length > 1 &&
                    r.teacherBreakdown.map((tb, tIdx) => (
                      <tr
                        key={tIdx}
                        className="border-b border-zinc-100 bg-zinc-50/40 text-[11px] text-zinc-500 dark:border-zinc-900 dark:bg-zinc-900/40"
                      >
                        <td className="px-3 py-1" />
                        <td className="px-3 py-1" />
                        <td className="px-3 py-1" />
                        <td className="px-3 py-1 pl-5 text-zinc-500">└ {tb.teacherName}</td>
                        <td className="px-3 py-1" />
                        <td className="px-3 py-1 text-right">
                          {tb.paid > 0 ? `${tb.paid.toLocaleString()}원` : "-"}
                        </td>
                        <td className="px-3 py-1 text-right">
                          {r.unitPrice > 0 && tb.paid > 0 ? (tb.paid / r.unitPrice).toFixed(1) : "-"}
                        </td>
                        <td className="px-3 py-1 text-right">{tb.units}</td>
                        <td className="px-3 py-1" />
                        <td className="px-3 py-1" />
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {studentChecks.length === 0 && (
            <div className="flex items-center justify-center h-24 text-zinc-400 text-sm">
              검증할 학생 데이터가 없습니다.
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`border border-zinc-200 px-4 py-3 dark:border-zinc-800 ${highlight ? "bg-blue-50 dark:bg-blue-950" : "bg-white dark:bg-zinc-900"}`}>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className={`mt-1 text-lg font-bold ${highlight ? "text-blue-600 dark:text-blue-400" : "text-zinc-900 dark:text-zinc-100"}`}>
        {value}
      </p>
    </div>
  );
}
