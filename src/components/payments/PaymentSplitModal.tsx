"use client";

import { useEffect, useState, useMemo } from "react";
import type { Teacher } from "@/types";
import type { PaymentSplit, PaymentSplitItem } from "@/hooks/usePaymentSplits";

interface BillingRow {
  billing_month: string;
  student_name: string;
  student_school: string;
  billing_name: string;
  charge_amount: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  billing: BillingRow | null;
  staff: Teacher[];
  existing: PaymentSplit | null; // 기존 분리 데이터 (수정 모드)
  defaultTeacher: { id: string; name: string } | null; // 추출된 담임강사 — 기본값
  onSaved: () => void;
}

interface Row {
  teacher_staff_id: string;
  teacher_name: string;
  amount: string; // 입력은 string 으로 (콤마 / 빈 값 허용)
  role: string;
}

/**
 * Firebase billing 한 청구를 강사별로 분배하는 모달.
 *   - 강사 자동완성 (active staff)
 *   - 분배 합계 = 원본 청구액 강제 (저장 직전 검증)
 *   - 기존 분리 데이터가 있으면 수정 모드 (해제 버튼 노출)
 */
export default function PaymentSplitModal({
  open,
  onClose,
  billing,
  staff,
  existing,
  defaultTeacher,
  onSaved,
}: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 모달 열릴 때 초기 행 채우기
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (existing) {
      setRows(
        existing.splits.map((s) => ({
          teacher_staff_id: s.teacher_staff_id,
          teacher_name: s.teacher_name,
          amount: String(s.amount),
          role: s.role || "",
        }))
      );
    } else if (billing) {
      // 기본: 담임강사 1명 + 빈 row 1개
      const initial: Row[] = [];
      if (defaultTeacher) {
        initial.push({
          teacher_staff_id: defaultTeacher.id,
          teacher_name: defaultTeacher.name,
          amount: String(billing.charge_amount),
          role: "담임",
        });
      } else {
        initial.push({ teacher_staff_id: "", teacher_name: "", amount: String(billing.charge_amount), role: "" });
      }
      initial.push({ teacher_staff_id: "", teacher_name: "", amount: "0", role: "" });
      setRows(initial);
    }
  }, [open, existing, billing, defaultTeacher]);

  // 입력값 합계
  const sum = useMemo(
    () => rows.reduce((a, r) => a + (Number(r.amount) || 0), 0),
    [rows]
  );
  const remaining = (billing?.charge_amount || 0) - sum;
  const matched = remaining === 0;

  // 활성 강사 옵션
  const staffOptions = useMemo(() => {
    return staff
      .filter((t) => t.status === "active")
      .map((t) => ({ id: t.id, name: t.name, englishName: t.englishName }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [staff]);

  function updateRow(idx: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((prev) => [
      ...prev,
      { teacher_staff_id: "", teacher_name: "", amount: "0", role: "" },
    ]);
  }
  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }
  function distributeRemaining(idx: number) {
    // 남은 금액을 idx 행에 더하기 (음수면 차감)
    const cur = Number(rows[idx]?.amount) || 0;
    updateRow(idx, { amount: String(cur + remaining) });
  }

  async function handleSave() {
    if (!billing) return;
    setError(null);

    // 검증
    const valid: PaymentSplitItem[] = [];
    for (const r of rows) {
      const amt = Number(r.amount) || 0;
      if (!r.teacher_staff_id || !r.teacher_name) {
        if (amt === 0) continue; // 빈 row 는 무시
        setError("모든 분배 행에 강사를 선택해야 합니다");
        return;
      }
      if (amt < 0) {
        setError("분배 금액은 0 이상이어야 합니다");
        return;
      }
      valid.push({
        teacher_staff_id: r.teacher_staff_id,
        teacher_name: r.teacher_name,
        amount: amt,
        role: r.role || undefined,
      });
    }
    if (valid.length === 0) {
      setError("최소 1개 강사에 분배가 필요합니다");
      return;
    }
    const validSum = valid.reduce((a, s) => a + s.amount, 0);
    if (validSum !== billing.charge_amount) {
      setError(
        `분배 합계(${validSum.toLocaleString()})가 원본 청구액(${billing.charge_amount.toLocaleString()})과 일치해야 합니다`
      );
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/payment-splits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          billing_month: billing.billing_month,
          student_name: billing.student_name,
          student_school: billing.student_school || "",
          billing_name: billing.billing_name,
          original_amount: billing.charge_amount,
          splits: valid,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "저장 실패");
        return;
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!billing || !existing) return;
    if (!confirm("분리를 해제하면 원본 청구로 복귀됩니다. 진행할까요?")) return;
    setSaving(true);
    try {
      const params = new URLSearchParams({
        billing_month: billing.billing_month,
        student_name: billing.student_name,
        student_school: billing.student_school || "",
        billing_name: billing.billing_name,
      });
      const res = await fetch(`/api/payment-splits?${params.toString()}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "삭제 실패");
        return;
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제 실패");
    } finally {
      setSaving(false);
    }
  }

  if (!open || !billing) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        {/* 헤더 */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
          <div>
            <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              수납 분리 — {billing.student_name}
              {billing.student_school && (
                <span className="ml-1 text-xs font-normal text-zinc-500">
                  ({billing.student_school})
                </span>
              )}
            </div>
            <div className="mt-0.5 text-xs text-zinc-500">
              {billing.billing_month} · {billing.billing_name}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-sm text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-3 grid grid-cols-3 gap-3">
            <div className="rounded-sm border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-800/50">
              <div className="text-xs text-zinc-500">원본 청구액</div>
              <div className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                {billing.charge_amount.toLocaleString()}원
              </div>
            </div>
            <div className="rounded-sm border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-800/50">
              <div className="text-xs text-zinc-500">분배 합계</div>
              <div className={`text-base font-bold ${matched ? "text-emerald-600" : "text-orange-600"}`}>
                {sum.toLocaleString()}원
              </div>
            </div>
            <div className="rounded-sm border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-800/50">
              <div className="text-xs text-zinc-500">남은 금액</div>
              <div className={`text-base font-bold ${matched ? "text-zinc-400" : "text-orange-600"}`}>
                {remaining.toLocaleString()}원
              </div>
            </div>
          </div>

          {/* 분배 row 들 */}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 text-xs dark:border-zinc-800 dark:bg-zinc-800/50">
                <th className="px-2 py-2 text-left font-medium text-zinc-500">담당 강사</th>
                <th className="px-2 py-2 text-left font-medium text-zinc-500 w-[80px]">역할</th>
                <th className="px-2 py-2 text-right font-medium text-zinc-500 w-[140px]">금액 (원)</th>
                <th className="px-2 py-2 w-[80px]" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr
                  key={idx}
                  className="border-b border-zinc-100 dark:border-zinc-800"
                >
                  <td className="px-2 py-2">
                    <select
                      value={row.teacher_staff_id}
                      onChange={(e) => {
                        const sel = staffOptions.find((s) => s.id === e.target.value);
                        updateRow(idx, {
                          teacher_staff_id: e.target.value,
                          teacher_name: sel?.name || "",
                        });
                      }}
                      className="w-full rounded-sm border border-zinc-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    >
                      <option value="">— 선택 —</option>
                      {staffOptions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}{s.englishName ? ` (${s.englishName})` : ""}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="text"
                      value={row.role}
                      onChange={(e) => updateRow(idx, { role: e.target.value })}
                      placeholder="담임/부담임"
                      className="w-full rounded-sm border border-zinc-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      value={row.amount}
                      onChange={(e) => updateRow(idx, { amount: e.target.value })}
                      min={0}
                      step={1000}
                      className="w-full rounded-sm border border-zinc-300 bg-white px-2 py-1 text-right text-sm focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => distributeRemaining(idx)}
                      disabled={matched || remaining === 0}
                      className="mr-1 rounded-sm border border-blue-300 px-1.5 py-0.5 text-[10px] text-blue-600 hover:bg-blue-50 disabled:opacity-30 dark:border-blue-700 dark:text-blue-400"
                      title="남은 금액을 이 행에 채움"
                    >
                      ←잔액
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      disabled={rows.length <= 1}
                      className="rounded-sm border border-red-300 px-1.5 py-0.5 text-[10px] text-red-500 hover:bg-red-50 disabled:opacity-30 dark:border-red-800 dark:text-red-400"
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button
            type="button"
            onClick={addRow}
            className="mt-2 rounded-sm border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            + 강사 추가
          </button>

          {error && (
            <div className="mt-3 rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div className="flex flex-shrink-0 items-center justify-between border-t border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
          <div>
            {existing && (
              <button
                type="button"
                onClick={handleRemove}
                disabled={saving}
                className="rounded-sm border border-red-300 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-400"
              >
                분리 해제
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-sm border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !matched}
              className="rounded-sm bg-blue-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
              title={!matched ? "분배 합계가 원본 청구액과 일치해야 합니다" : undefined}
            >
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
