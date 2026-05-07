"use client";

import { useEffect, useMemo, useState } from "react";
import { useStudents } from "@/hooks/useStudents";
import { useStaff } from "@/hooks/useStaff";
import { useSalaryConfig } from "@/hooks/useSalaryConfig";
import { useAllTierOverrides } from "@/hooks/useAllTierOverrides";
import { usePaymentsForMonth } from "@/hooks/usePaymentsForMonth";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import type { Student } from "@/types";
import { toSubjectLabel } from "@/lib/labelMap";

/**
 * virtual_students = 시트에만 있고 Firebase 에 없는 학생.
 * sync 후에도 정리 안 되면 여기 표시 — Firebase 에 진짜 학생 만들거나 삭제 필요.
 */
type VirtualStudent = {
  id: string;
  name: string;
  school?: string;
  grade?: string;
  teacher_staff_id: string;
  class_name?: string;
  subject?: string;
  created_at?: string;
};

/**
 * 시트 ↔ 앱 정합성 점검 페이지 (audit #11).
 *
 * 4개 점검 항목:
 *   1. virtual_students — 시트에만 있는 학생
 *   2. 고아 tier_overrides — salary_item_id 가 salaryConfig 에 없는 것
 *   3. 학생 있는데 이번 달 수납 0 — 결제 입력 누락 의심
 *   4. payment_name 미매칭 — 학생 enrollment 와 매칭 안 된 수납
 */
export default function MigrationCheckPage() {
  const now = new Date();
  const [year, setYear] = useLocalStorage<number>(
    "migrationCheck.year",
    now.getFullYear()
  );
  const [month, setMonth] = useLocalStorage<number>(
    "migrationCheck.month",
    now.getMonth() + 1
  );

  const { students, loading: studentsLoading } = useStudents();
  const { teachers, loading: staffLoading } = useStaff();
  const { config: salaryConfig } = useSalaryConfig();
  const { overrides: tierOverrides } = useAllTierOverrides();
  const { payments, loading: paymentsLoading } = usePaymentsForMonth(
    year,
    month
  );

  const [virtuals, setVirtuals] = useState<VirtualStudent[]>([]);
  const [virtualsLoading, setVirtualsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setVirtualsLoading(true);
    fetch("/api/virtual-students", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setVirtuals(Array.isArray(d) ? d : []);
      })
      .catch(() => {
        if (!cancelled) setVirtuals([]);
      })
      .finally(() => {
        if (!cancelled) setVirtualsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 점검 1 — virtual students
  const virtualRows = useMemo(() => {
    const teacherById = new Map(teachers.map((t) => [t.id, t.name]));
    return virtuals.map((v) => ({
      ...v,
      teacherName: teacherById.get(v.teacher_staff_id) || "(미연결)",
    }));
  }, [virtuals, teachers]);

  // 점검 2 — 고아 tier_overrides
  //   salary_item_id 가 salaryConfig.items 에 없는 것.
  const orphanTiers = useMemo(() => {
    const itemIds = new Set((salaryConfig.items || []).map((i) => i.id));
    const studentById = new Map<string, Student>();
    for (const s of students) studentById.set(s.id, s);
    const rows: Array<{
      studentId: string;
      studentName: string;
      tierOverrideId: string;
    }> = [];
    for (const [studentId, tierId] of Object.entries(tierOverrides)) {
      if (!tierId) continue;
      if (itemIds.has(tierId)) continue;
      rows.push({
        studentId,
        studentName: studentById.get(studentId)?.name || "(학생 없음)",
        tierOverrideId: tierId,
      });
    }
    return rows;
  }, [tierOverrides, salaryConfig.items, students]);

  // 점검 3 — 이번 달 수납 0 인 활성 학생
  const studentsWithoutPayment = useMemo(() => {
    if (paymentsLoading || studentsLoading) return [];
    const monthStr = `${year}${String(month).padStart(2, "0")}`;
    const paidByName = new Map<string, number>();
    for (const p of payments) {
      if (!p.billing_month || p.billing_month !== monthStr) continue;
      if (!p.student_name) continue;
      paidByName.set(
        p.student_name,
        (paidByName.get(p.student_name) || 0) + (p.charge_amount || 0)
      );
    }
    // 이번 달 재원 + 활성 enrollment 가 있는 학생 중 수납 0 인 것
    const ymStart = `${year}-${String(month).padStart(2, "0")}-01`;
    const ymEndDay = new Date(year, month, 0).getDate();
    const ymEnd = `${year}-${String(month).padStart(2, "0")}-${String(
      ymEndDay
    ).padStart(2, "0")}`;
    return students.filter((s) => {
      const active = (s.enrollments || []).some((e) => {
        const start = e.startDate || s.startDate || "";
        const end = e.endDate || s.endDate || "";
        if (start && start > ymEnd) return false;
        if (end && end < ymStart) return false;
        return true;
      });
      if (!active) return false;
      return (paidByName.get(s.name) || 0) === 0;
    });
  }, [students, payments, year, month, paymentsLoading, studentsLoading]);

  // 점검 4 — payments 에 student_name 매칭되는 학생이 없음
  const unmatchedPayments = useMemo(() => {
    const nameSet = new Set(students.map((s) => s.name));
    return payments.filter(
      (p) =>
        p.student_name &&
        !nameSet.has(p.student_name) &&
        !p.payment_name?.includes("(") // 수납 자체가 일반 메모일 수도
    );
  }, [students, payments]);

  const downloadCsv = (rows: string[][], filename: string) => {
    if (rows.length === 0) return;
    // BOM 추가 — 엑셀에서 한글 깨짐 방지
    const csv = "﻿" + rows.map((r) => r.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  };

  const prevMonth = () => {
    if (month === 1) {
      setYear(year - 1);
      setMonth(12);
    } else {
      setMonth(month - 1);
    }
  };
  const nextMonth = () => {
    if (month === 12) {
      setYear(year + 1);
      setMonth(1);
    } else {
      setMonth(month + 1);
    }
  };

  const loading =
    studentsLoading || staffLoading || virtualsLoading || paymentsLoading;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
          🔍 마이그레이션 점검
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={prevMonth}
            className="rounded-sm border border-zinc-300 px-2.5 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            ◀
          </button>
          <input
            type="month"
            value={`${year}-${String(month).padStart(2, "0")}`}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              const [y, m] = v.split("-").map(Number);
              setYear(y);
              setMonth(m);
            }}
            className="rounded-sm border border-zinc-300 bg-white px-2.5 py-1.5 text-sm font-bold text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <button
            onClick={nextMonth}
            className="rounded-sm border border-zinc-300 px-2.5 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            ▶
          </button>
        </div>
      </div>

      {loading && (
        <div className="mb-3 text-sm text-zinc-500">로딩 중...</div>
      )}

      <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
        시트와 앱 데이터 정합성을 점검합니다. 항목별 CSV 다운로드 후 수정 작업
        진행 가능.
      </p>

      <CheckSection
        title="시트에만 있는 학생 (virtual)"
        emoji="👥"
        count={virtualRows.length}
        description="동기화 후에도 Firebase 에 매칭되지 않은 학생. Firebase 에 진짜 학생으로 등록하거나, 정리 필요."
        empty="모든 학생이 Firebase 에 매칭됨 ✓"
        onDownload={() => {
          const rows: string[][] = [
            ["id", "이름", "학교", "학년", "선생님", "분반", "과목"],
            ...virtualRows.map((r) => [
              r.id,
              r.name,
              r.school || "",
              r.grade || "",
              r.teacherName,
              r.class_name || "",
              r.subject || "",
            ]),
          ];
          downloadCsv(rows, `virtual_students_${year}-${month}.csv`);
        }}
      >
        {virtualRows.slice(0, 10).map((r) => (
          <li key={r.id} className="text-xs text-zinc-600 dark:text-zinc-400">
            <b>{r.name}</b> ({r.school || "?"} {r.grade || "?"}) ·{" "}
            {r.teacherName}
            {r.class_name ? ` · ${r.class_name}` : ""}
          </li>
        ))}
        {virtualRows.length > 10 && (
          <li className="mt-1 text-[11px] italic text-zinc-400">
            ... 외 {virtualRows.length - 10}명. CSV 로 전체 다운로드.
          </li>
        )}
      </CheckSection>

      <CheckSection
        title="고아 tier 오버라이드"
        emoji="⚠️"
        count={orphanTiers.length}
        description="학생에게 저장된 salary_item_id 가 현재 salaryConfig 에 없는 것. tier 삭제·이름변경 후 동기화 누락 의심."
        empty="고아 오버라이드 없음 ✓"
        onDownload={() => {
          const rows: string[][] = [
            ["student_id", "이름", "tier_override_id"],
            ...orphanTiers.map((r) => [
              r.studentId,
              r.studentName,
              r.tierOverrideId,
            ]),
          ];
          downloadCsv(rows, `orphan_tiers_${year}-${month}.csv`);
        }}
      >
        {orphanTiers.slice(0, 10).map((r) => (
          <li key={r.studentId} className="text-xs text-zinc-600 dark:text-zinc-400">
            <b>{r.studentName}</b> → tier id <code className="font-mono text-amber-600">{r.tierOverrideId}</code>
          </li>
        ))}
        {orphanTiers.length > 10 && (
          <li className="mt-1 text-[11px] italic text-zinc-400">
            ... 외 {orphanTiers.length - 10}건.
          </li>
        )}
      </CheckSection>

      <CheckSection
        title={`이번 달 수납 0 — 활성 학생`}
        emoji="💸"
        count={studentsWithoutPayment.length}
        description={`${year}년 ${month}월에 활성 enrollment 가 있는데 수납이 0 원인 학생. 결제 입력 누락 의심.`}
        empty="모든 활성 학생 수납 입력됨 ✓"
        onDownload={() => {
          const rows: string[][] = [
            ["id", "이름", "학교", "학년", "분반"],
            ...studentsWithoutPayment.map((s) => [
              s.id,
              s.name,
              s.school || "",
              s.grade || "",
              (s.enrollments || []).map((e) => e.className).join(" / "),
            ]),
          ];
          downloadCsv(
            rows,
            `students_without_payment_${year}-${month}.csv`
          );
        }}
      >
        {studentsWithoutPayment.slice(0, 10).map((s) => (
          <li key={s.id} className="text-xs text-zinc-600 dark:text-zinc-400">
            <b>{s.name}</b> ({s.school || "?"} {s.grade || "?"})
            {s.enrollments?.[0]?.className
              ? ` · ${s.enrollments[0].className}`
              : ""}
          </li>
        ))}
        {studentsWithoutPayment.length > 10 && (
          <li className="mt-1 text-[11px] italic text-zinc-400">
            ... 외 {studentsWithoutPayment.length - 10}명.
          </li>
        )}
      </CheckSection>

      <CheckSection
        title="수납 미매칭 (학생 이름 못 찾음)"
        emoji="🔗"
        count={unmatchedPayments.length}
        description="Payments 의 student_name 이 학생 DB 에 없음. 이름 오타 또는 퇴원 후 정산 누락 의심."
        empty="모든 수납이 학생과 매칭됨 ✓"
        onDownload={() => {
          const rows: string[][] = [
            ["id", "student_name", "billing_month", "charge", "payment_name"],
            ...unmatchedPayments.map((p) => [
              String(p.id),
              p.student_name || "",
              p.billing_month || "",
              String(p.charge_amount || 0),
              p.payment_name || "",
            ]),
          ];
          downloadCsv(rows, `unmatched_payments_${year}-${month}.csv`);
        }}
      >
        {unmatchedPayments.slice(0, 10).map((p) => (
          <li key={p.id} className="text-xs text-zinc-600 dark:text-zinc-400">
            <b>{p.student_name}</b> · {p.billing_month} ·{" "}
            {(p.charge_amount || 0).toLocaleString()}원
            {p.payment_name ? ` · ${p.payment_name}` : ""}
          </li>
        ))}
        {unmatchedPayments.length > 10 && (
          <li className="mt-1 text-[11px] italic text-zinc-400">
            ... 외 {unmatchedPayments.length - 10}건.
          </li>
        )}
      </CheckSection>
    </div>
  );
}

function CheckSection({
  title,
  emoji,
  count,
  description,
  empty,
  onDownload,
  children,
}: {
  title: string;
  emoji: string;
  count: number;
  description: string;
  empty: string;
  onDownload?: () => void;
  children?: React.ReactNode;
}) {
  const isOk = count === 0;
  const headerCls = isOk
    ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-950 dark:border-emerald-900"
    : "bg-amber-50 border-amber-200 dark:bg-amber-950 dark:border-amber-900";
  const countCls = isOk
    ? "text-emerald-700 dark:text-emerald-300"
    : "text-amber-700 dark:text-amber-300";

  return (
    <section className="mb-3 border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div
        className={`flex items-center justify-between gap-2 border-b px-3 py-2 ${headerCls}`}
      >
        <div className="flex items-center gap-2">
          <span className="text-base">{emoji}</span>
          <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
            {title}
          </span>
          <span className={`text-base font-bold ${countCls}`}>{count}건</span>
        </div>
        {!isOk && onDownload && (
          <button
            type="button"
            onClick={onDownload}
            className="rounded-sm border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            📥 CSV
          </button>
        )}
      </div>
      <div className="px-3 py-2">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {description}
        </p>
        {isOk ? (
          <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
            {empty}
          </p>
        ) : (
          <ul className="mt-2 space-y-0.5">{children}</ul>
        )}
      </div>
    </section>
  );
}

function csvEscape(v: string): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
