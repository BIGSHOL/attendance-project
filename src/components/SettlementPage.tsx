"use client";

import { useState, useMemo } from "react";
import { useStaff } from "@/hooks/useStaff";
import { useStudents } from "@/hooks/useStudents";
import { useAllAttendance } from "@/hooks/useAllAttendance";
import { useMonthlySettlement } from "@/hooks/useMonthlySettlement";
import { useHiddenTeachers } from "@/hooks/useHiddenTeachers";
import { useAllUserRoles } from "@/hooks/useAllUserRoles";
import { useAllBlogPosts } from "@/hooks/useAllBlogPosts";
import { useSalaryConfig } from "@/hooks/useSalaryConfig";
import { useTeacherSettings } from "@/hooks/useTeacherSettings";
import type { Teacher } from "@/types";
import type { SalaryType } from "@/hooks/useUserRole";
import {
  calculateStudentSalary,
  matchSalarySetting,
  calculateFinalSalary,
  isAttendanceCountable,
} from "@/lib/salary";
import { toSubjectLabel } from "@/lib/labelMap";

export default function SettlementPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const { config: salaryConfig } = useSalaryConfig();

  const { teachers, loading: staffLoading } = useStaff();
  const { students, loading: studentsLoading } = useStudents();
  const { records: attendanceRecords, loading: attendanceLoading } = useAllAttendance(year, month);
  const { getByTeacher, loading: settlementLoading } = useMonthlySettlement(year, month);
  const { hiddenTeacherIds } = useHiddenTeachers();
  const { users: userRoles } = useAllUserRoles();
  const { hasPostForTeacher } = useAllBlogPosts(year, month);
  const { isBlogRequired } = useTeacherSettings();

  // 선생님 id → 급여 유형 매핑 (user_roles 기반)
  const teacherSalaryTypeMap = useMemo(() => {
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

  // 선생님 매칭 함수
  const isTeacherMatch = (
    enrollment: { staffId?: string; teacher?: string },
    teacher: Teacher
  ) => {
    const sid = enrollment.staffId || "";
    const tname = enrollment.teacher || "";
    return (
      sid === teacher.id ||
      sid === teacher.name ||
      sid === teacher.englishName ||
      tname === teacher.name ||
      tname === teacher.englishName
    );
  };

  // 표시할 선생님 (숨김 제외, 담당학생 0 제외, 과목 없음 제외)
  const visibleTeachers = useMemo(() => {
    return teachers.filter((t) => {
      if (!t.subjects || t.subjects.length === 0) return false;
      if (hiddenTeacherIds.has(t.id)) return false;
      const studentCount = students.filter((s) =>
        s.enrollments?.some((e) => isTeacherMatch(e, t))
      ).length;
      return studentCount > 0;
    });
  }, [teachers, students, hiddenTeacherIds]);

  // 선생님별 정산 계산
  const settlements = useMemo(() => {
    return visibleTeachers.map((teacher) => {
      const settlement = getByTeacher(teacher.id);
      const effectiveConfig = settlement.isFinalized && settlement.salaryConfig
        ? settlement.salaryConfig
        : salaryConfig;

      // 담당 학생 목록
      const teacherStudents = students.filter((s) =>
        s.enrollments?.some((e) => isTeacherMatch(e, teacher))
      );

      // 급여 유형 + 블로그 패널티
      const salaryTypeInfo = teacherSalaryTypeMap.get(teacher.id);
      const salaryType = salaryTypeInfo?.type || "commission";
      const commissionDays = salaryTypeInfo?.days || [];
      const blogRequired = isBlogRequired(teacher.id);
      // 블로그 의무인데 해당 월 작성 기록이 없으면 패널티 적용
      const blogPenalty = blogRequired && !hasPostForTeacher(teacher.id);

      // 해당 선생님의 출석 레코드를 유형에 따라 필터링 후 학생별 합계
      const studentUnitMap = new Map<string, number>();
      let totalAttendance = 0;
      let countableAttendance = 0;

      for (const r of attendanceRecords) {
        if (r.teacher_id !== teacher.id) continue;
        if (r.hours <= 0) continue;
        totalAttendance += r.hours;

        // 급여 유형에 따라 계산 대상 여부 판단
        if (isAttendanceCountable(r.date, salaryType, commissionDays)) {
          countableAttendance += r.hours;
          studentUnitMap.set(
            r.student_id,
            (studentUnitMap.get(r.student_id) || 0) + r.hours
          );
        }
      }

      // 기본 급여 계산 (대상 출석만 반영)
      let baseSalary = 0;
      for (const student of teacherStudents) {
        const classUnits = studentUnitMap.get(student.id) || 0;
        if (classUnits > 0) {
          const settingItem = matchSalarySetting(student, effectiveConfig);
          baseSalary += calculateStudentSalary(
            settingItem,
            effectiveConfig.academyFee,
            classUnits,
            null,
            blogPenalty
          );
        }
      }

      // 최종 급여
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
      };
    });
  }, [visibleTeachers, students, attendanceRecords, getByTeacher, salaryConfig, teacherSalaryTypeMap, hasPostForTeacher, isBlogRequired]);

  // 합계
  const totals = useMemo(() => {
    return settlements.reduce(
      (acc, s) => ({
        studentCount: acc.studentCount + s.studentCount,
        totalAttendance: acc.totalAttendance + s.totalAttendance,
        baseSalary: acc.baseSalary + s.baseSalary,
        finalSalary: acc.finalSalary + s.finalSalary,
      }),
      { studentCount: 0, totalAttendance: 0, baseSalary: 0, finalSalary: 0 }
    );
  }, [settlements]);

  const loading = staffLoading || studentsLoading || attendanceLoading || settlementLoading;

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
            ({settlements.length}명)
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

      {/* 전체 합계 카드 */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <StatCard label="선생님" value={`${settlements.length}명`} />
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
            {settlements.map((s, idx) => {
              const incentiveTotal = s.finalSalary - s.baseSalary;
              return (
                <tr
                  key={s.teacher.id}
                  className="border-b border-zinc-300 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/30"
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
              );
            })}

            {/* 합계 행 */}
            {settlements.length > 0 && (
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

        {settlements.length === 0 && (
          <div className="flex items-center justify-center h-32 text-zinc-400 text-sm">
            표시할 정산 데이터가 없습니다.
          </div>
        )}
      </div>
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
