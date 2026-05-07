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

  /**
   * 점검 5 — payments 의 charge_amount 를 tier 단가로 역산해
   *   결과가 정수(1~16회) 가 안 되는 케이스 추출. salaryConfig 의 단가가
   *   실제 시트와 다른 경우 (audit v4 #7) 발견 도구.
   *
   * 예) 박지율 중등특강 96,000원 청구.
   *   - DB tier 단가 12,000원 → 8회. 정수 매칭 OK 지만 실제는 4회.
   *   - 시트 단가 24,000원이 정답.
   *
   * 직접 mismatch 자동 발견은 어려우니 운영자가 비교할 수 있도록
   *   현재 salaryConfig 의 모든 tier 단가를 한 표로 보여줌 + 김민주 시트
   *   데이터 마스터의 알려진 단가 표와 수동 비교 가이드.
   */
  const tierPriceTable = useMemo(() => {
    const items = salaryConfig.items || [];
    return items
      .map((it) => ({
        id: it.id,
        name: it.name,
        subject: it.subject || "?",
        baseTuition: it.baseTuition || 0,
        unitPrice: it.unitPrice || it.baseTuition || 0,
        ratio: it.type === "percentage" ? it.ratio : null,
        type: it.type,
      }))
      .sort((a, b) => {
        const subjectOrder = ["math", "english", "other"];
        const sa = subjectOrder.indexOf(a.subject);
        const sb = subjectOrder.indexOf(b.subject);
        if (sa !== sb) return (sa < 0 ? 99 : sa) - (sb < 0 ? 99 : sb);
        return a.baseTuition - b.baseTuition;
      });
  }, [salaryConfig.items]);

  // 김민주 시트 데이터 마스터의 알려진 단가 (audit v4 에서 추출).
  //   이름 매칭으로 우리 단가와 비교.
  const KNOWN_SHEET_PRICES: Record<string, number> = {
    "초등 3T": 21250,
    "초등 2T": 22500,
    "중등 3T": 24000,
    "중등 2T": 25000,
    "고등 3T": 27250,
    "고등 2T": 29250,
    "수학I (대수)": 31250,
    "수학II (미적분I)": 31250,
    "미적분 (미적분II)": 31250,
    "확률과 통계": 31250,
    수능: 37500,
    "의치대 초등": 22500,
    "의치대 중등": 25000,
    "의치대 고등": 29167,
    킬러문제: 29250,
    절대등급: 32500,
    매쓰몽: 30000,
    초등특강: 21250,
    중등특강: 24000,
    "중등특강(2.5)": 25000,
    "중등특강(3.33)": 33333,
    고1특강: 27250,
    고2특강: 31250,
    중등함수특강: 30000,
    중등특강2: 36000,
  };

  // tier 단가 mismatch — 우리 DB 와 시트 데이터 마스터 비교.
  //   김민주 시트는 수학 단가표라, math subject 의 tier 만 비교 (english 와 이름 충돌 회피).
  const tierMismatches = useMemo(() => {
    const out: Array<{
      tierName: string;
      subject: string;
      app: number;
      sheet: number;
      diff: number;
    }> = [];
    for (const t of tierPriceTable) {
      if (t.subject !== "math") continue; // 영어 tier 는 다른 시트 기준
      const sheetPrice = KNOWN_SHEET_PRICES[t.name];
      if (sheetPrice === undefined) continue;
      if (sheetPrice !== t.baseTuition) {
        out.push({
          tierName: t.name,
          subject: t.subject,
          app: t.baseTuition,
          sheet: sheetPrice,
          diff: sheetPrice - t.baseTuition,
        });
      }
    }
    return out;
  }, [tierPriceTable]);

  // 시트엔 있는데 우리 salaryConfig 에 없는 tier (math 기준만)
  const missingTiers = useMemo(() => {
    const mathNames = new Set(
      tierPriceTable.filter((t) => t.subject === "math").map((t) => t.name)
    );
    return Object.entries(KNOWN_SHEET_PRICES)
      .filter(([name]) => !mathNames.has(name))
      .map(([name, price]) => ({ name, price }));
  }, [tierPriceTable]);

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

      {/* 점검 5 — tier 단가 mismatch (audit v4 #7) */}
      <CheckSection
        title="tier 단가 불일치 (시트 ↔ 앱)"
        emoji="💰"
        count={tierMismatches.length}
        description="앱의 salaryConfig 단가와 김민주 시트 데이터 마스터 단가가 다른 것. 정산 금액에 직접 영향 — /admin/salary-config 에서 수정 권장."
        empty="모든 tier 단가가 시트와 일치 ✓"
        onDownload={() => {
          const rows: string[][] = [
            ["tier_name", "앱 단가(원)", "시트 단가(원)", "차이(원)"],
            ...tierMismatches.map((m) => [
              m.tierName,
              String(m.app),
              String(m.sheet),
              String(m.diff),
            ]),
          ];
          downloadCsv(rows, `tier_price_mismatches.csv`);
        }}
      >
        {tierMismatches.map((m) => (
          <li
            key={m.tierName}
            className="text-xs text-zinc-700 dark:text-zinc-300"
          >
            <b className="text-amber-700 dark:text-amber-400">{m.tierName}</b>:
            앱{" "}
            <span className="line-through text-rose-600">
              {m.app.toLocaleString()}원
            </span>{" "}
            → 시트{" "}
            <span className="font-semibold text-emerald-600">
              {m.sheet.toLocaleString()}원
            </span>{" "}
            <span className="text-zinc-500">
              (차이 {m.diff > 0 ? "+" : ""}
              {m.diff.toLocaleString()}원)
            </span>
          </li>
        ))}
      </CheckSection>

      {/* 점검 6 — 시트엔 있는데 앱에 없는 tier (audit v4 #6) */}
      <CheckSection
        title="시트엔 있는데 앱에 없는 tier"
        emoji="🆕"
        count={missingTiers.length}
        description="김민주 시트 데이터 마스터에는 있지만 앱 salaryConfig 에 등록 안 된 tier. 학생 분반 매칭 실패 가능 — /admin/salary-config 에서 추가 권장."
        empty="모든 시트 tier 가 앱에 등록됨 ✓"
        onDownload={() => {
          const rows: string[][] = [
            ["tier_name", "권장 단가(원)"],
            ...missingTiers.map((m) => [m.name, String(m.price)]),
          ];
          downloadCsv(rows, `missing_tiers.csv`);
        }}
      >
        {missingTiers.map((m) => (
          <li key={m.name} className="text-xs text-zinc-600 dark:text-zinc-400">
            <b>{m.name}</b> — 권장 단가{" "}
            <span className="font-semibold text-blue-700 dark:text-blue-300">
              {m.price.toLocaleString()}원
            </span>
          </li>
        ))}
      </CheckSection>

      {/* 참고: 현재 등록된 tier 단가 표 */}
      <section className="mb-3 border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-800/50">
          <span className="text-sm font-bold text-zinc-700 dark:text-zinc-300">
            📊 현재 등록된 tier 단가 ({tierPriceTable.length}개)
          </span>
          <span className="text-[11px] text-zinc-500">
            정산 단가 참고용 — 수정은 /admin/salary-config
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-zinc-50 dark:bg-zinc-800/30">
              <tr>
                <th className="px-2 py-1 text-left font-medium text-zinc-500">
                  tier
                </th>
                <th className="px-2 py-1 text-left font-medium text-zinc-500">
                  과목
                </th>
                <th className="px-2 py-1 text-right font-medium text-zinc-500">
                  baseTuition
                </th>
                <th className="px-2 py-1 text-right font-medium text-zinc-500">
                  unitPrice
                </th>
                <th className="px-2 py-1 text-right font-medium text-zinc-500">
                  ratio
                </th>
              </tr>
            </thead>
            <tbody>
              {tierPriceTable.map((t) => {
                const sheetPrice = KNOWN_SHEET_PRICES[t.name];
                const mismatch =
                  sheetPrice !== undefined && sheetPrice !== t.baseTuition;
                return (
                  <tr
                    key={t.id}
                    className={`border-t border-zinc-100 dark:border-zinc-800 ${
                      mismatch ? "bg-amber-50 dark:bg-amber-950/30" : ""
                    }`}
                  >
                    <td className="px-2 py-1 font-medium text-zinc-700 dark:text-zinc-300">
                      {t.name}
                    </td>
                    <td className="px-2 py-1 text-zinc-500">{t.subject}</td>
                    <td className="px-2 py-1 text-right text-zinc-700 dark:text-zinc-300">
                      {t.baseTuition.toLocaleString()}
                      {mismatch && (
                        <span
                          className="ml-1 text-amber-600"
                          title={`시트 ${sheetPrice.toLocaleString()}원과 불일치`}
                        >
                          ⚠
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right text-zinc-600">
                      {t.unitPrice ? t.unitPrice.toLocaleString() : "-"}
                    </td>
                    <td className="px-2 py-1 text-right text-zinc-600">
                      {t.ratio !== null ? `${t.ratio}%` : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
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
