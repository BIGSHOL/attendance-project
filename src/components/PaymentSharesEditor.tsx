"use client";

import { useEffect, useMemo, useState } from "react";
import { useStudents } from "@/hooks/useStudents";
import { useStaff } from "@/hooks/useStaff";
import { useLocalStorage } from "@/hooks/useLocalStorage";

interface PaymentShare {
  id: string;
  student_id: string;
  month: string;
  teacher_staff_id: string;
  class_name: string;
  allocated_charge: number;
  allocated_paid: number;
  allocated_units: number | null;
  unit_price: number | null;
  source: string | null;
  debug_note: string | null;
  is_manual: boolean;
  updated_at: string;
}

/**
 * payment_shares 수동 보정 (audit #8).
 *
 * 영어 강사 시트 동기화 시 자동 분배되는 share row 를 운영자가 검토·수정.
 * `is_manual: true` 저장 시 다음 동기화에서 보존됨 (PUT 의 replaceScope 가
 * is_manual=false 만 삭제).
 */
export default function PaymentSharesEditor() {
  const now = new Date();
  const [year, setYear] = useLocalStorage<number>(
    "paymentShares.year",
    now.getFullYear()
  );
  const [month, setMonth] = useLocalStorage<number>(
    "paymentShares.month",
    now.getMonth() + 1
  );
  const [search, setSearch] = useLocalStorage<string>(
    "paymentShares.search",
    ""
  );
  const [showOnlyManual, setShowOnlyManual] = useLocalStorage<boolean>(
    "paymentShares.onlyManual",
    false
  );

  const monthStr = `${year}-${String(month).padStart(2, "0")}`;

  const { students } = useStudents();
  const { teachers } = useStaff();

  const [shares, setShares] = useState<PaymentShare[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Partial<PaymentShare>>({});

  // 데이터 로드
  const fetchShares = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/payment-shares?month=${monthStr}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setShares(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "로딩 실패");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchShares();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthStr]);

  // lookup
  const studentById = useMemo(
    () => new Map(students.map((s) => [s.id, s])),
    [students]
  );
  const teacherById = useMemo(
    () => new Map(teachers.map((t) => [t.id, t])),
    [teachers]
  );

  // 표시 행
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return shares
      .filter((sh) => {
        if (showOnlyManual && !sh.is_manual) return false;
        if (!q) return true;
        const stu = studentById.get(sh.student_id);
        const tea = teacherById.get(sh.teacher_staff_id);
        const haystack = [
          stu?.name || "",
          stu?.school || "",
          stu?.grade || "",
          tea?.name || "",
          sh.class_name || "",
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) => {
        const an = studentById.get(a.student_id)?.name || "";
        const bn = studentById.get(b.student_id)?.name || "";
        return an.localeCompare(bn, "ko");
      });
  }, [shares, search, showOnlyManual, studentById, teacherById]);

  const summary = useMemo(() => {
    const manualN = shares.filter((s) => s.is_manual).length;
    const totalCharge = shares.reduce((a, s) => a + (s.allocated_charge || 0), 0);
    const totalPaid = shares.reduce((a, s) => a + (s.allocated_paid || 0), 0);
    return {
      total: shares.length,
      manualN,
      totalCharge,
      totalPaid,
    };
  }, [shares]);

  const startEdit = (sh: PaymentShare) => {
    setEditingId(sh.id);
    setEditValues({
      allocated_charge: sh.allocated_charge,
      allocated_paid: sh.allocated_paid,
      allocated_units: sh.allocated_units,
      unit_price: sh.unit_price,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValues({});
  };

  const saveEdit = async (sh: PaymentShare) => {
    setSavingId(sh.id);
    try {
      const res = await fetch("/api/payment-shares", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shares: [
            {
              student_id: sh.student_id,
              month: sh.month,
              teacher_staff_id: sh.teacher_staff_id,
              class_name: sh.class_name,
              allocated_charge:
                editValues.allocated_charge ?? sh.allocated_charge,
              allocated_paid: editValues.allocated_paid ?? sh.allocated_paid,
              allocated_units:
                editValues.allocated_units !== undefined
                  ? editValues.allocated_units
                  : sh.allocated_units,
              unit_price:
                editValues.unit_price !== undefined
                  ? editValues.unit_price
                  : sh.unit_price,
              is_manual: true, // 수동 편집 → 다음 동기화에서 보존
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      cancelEdit();
      await fetchShares();
    } catch (e) {
      alert("저장 실패: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSavingId(null);
    }
  };

  const deleteShare = async (sh: PaymentShare) => {
    if (
      !confirm(
        `${studentById.get(sh.student_id)?.name || sh.student_id} · ${
          teacherById.get(sh.teacher_staff_id)?.name || ""
        } · ${sh.class_name} share 를 삭제하시겠습니까?\n다음 동기화에서 자동 재생성될 수 있음.`
      )
    )
      return;
    try {
      const res = await fetch(
        `/api/payment-shares?id=${encodeURIComponent(sh.id)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchShares();
    } catch (e) {
      alert("삭제 실패: " + (e instanceof Error ? e.message : String(e)));
    }
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

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
          🔧 영어 강사 수납 분배 (payment_shares)
          <span className="ml-2 text-sm font-normal text-zinc-500">
            ({rows.length}/{shares.length}건)
          </span>
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchShares}
            className="rounded-sm border border-zinc-300 bg-white px-2.5 py-1.5 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          >
            🔄
          </button>
          <button
            onClick={prevMonth}
            className="rounded-sm border border-zinc-300 px-2.5 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            ◀
          </button>
          <input
            type="month"
            value={monthStr}
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

      {/* 요약 */}
      <div className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="총 share" value={`${summary.total}건`} />
        <Stat
          label="수동 보정 (보존)"
          value={`${summary.manualN}건`}
          highlight={summary.manualN > 0}
        />
        <Stat
          label="배정 청구액"
          value={`${summary.totalCharge.toLocaleString()}원`}
        />
        <Stat
          label="배정 납부액"
          value={`${summary.totalPaid.toLocaleString()}원`}
        />
      </div>

      {/* 필터 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔎 학생/선생님/분반"
          className="rounded-sm border border-zinc-300 bg-white px-2.5 py-1.5 text-sm w-64 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <label className="flex items-center gap-1.5 rounded-sm border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={showOnlyManual}
            onChange={(e) => setShowOnlyManual(e.target.checked)}
          />
          수동 보정만
        </label>
      </div>

      {error && (
        <div className="mb-3 rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* 표 */}
      <div className="overflow-x-auto border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/50">
              <th className="px-3 py-2 text-left">학생</th>
              <th className="px-3 py-2 text-left">선생님</th>
              <th className="px-3 py-2 text-left">분반</th>
              <th className="px-3 py-2 text-right">단가</th>
              <th className="px-3 py-2 text-right">시수</th>
              <th className="px-3 py-2 text-right">청구액</th>
              <th className="px-3 py-2 text-right">납부액</th>
              <th className="px-3 py-2 text-center">상태</th>
              <th className="px-3 py-2 text-center w-32">작업</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-zinc-400">
                  로딩 중...
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-zinc-400">
                  표시할 share 가 없습니다.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((sh) => {
                const stu = studentById.get(sh.student_id);
                const tea = teacherById.get(sh.teacher_staff_id);
                const isEdit = editingId === sh.id;
                const isSaving = savingId === sh.id;
                return (
                  <tr
                    key={sh.id}
                    className={`border-b border-zinc-200 dark:border-zinc-800 ${
                      sh.is_manual
                        ? "bg-blue-50/50 dark:bg-blue-950/30"
                        : "hover:bg-zinc-50 dark:hover:bg-zinc-800/30"
                    }`}
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">
                        {stu?.name || (
                          <span className="text-zinc-400">
                            ({sh.student_id.slice(0, 8)}…)
                          </span>
                        )}
                      </div>
                      {stu && (
                        <div className="text-[10px] text-zinc-500">
                          {stu.school} {stu.grade}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300">
                      {tea?.name || (
                        <span className="text-zinc-400">
                          {sh.teacher_staff_id.slice(0, 8)}…
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300">
                      {sh.class_name}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {isEdit ? (
                        <input
                          type="number"
                          value={editValues.unit_price ?? ""}
                          onChange={(e) =>
                            setEditValues({
                              ...editValues,
                              unit_price: e.target.value
                                ? Number(e.target.value)
                                : null,
                            })
                          }
                          className="w-20 rounded border border-zinc-300 px-2 py-1 text-xs text-right dark:border-zinc-600 dark:bg-zinc-800"
                        />
                      ) : (
                        <span className="text-xs text-zinc-600">
                          {sh.unit_price?.toLocaleString() || "-"}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {isEdit ? (
                        <input
                          type="number"
                          step="0.5"
                          value={editValues.allocated_units ?? ""}
                          onChange={(e) =>
                            setEditValues({
                              ...editValues,
                              allocated_units: e.target.value
                                ? Number(e.target.value)
                                : null,
                            })
                          }
                          className="w-16 rounded border border-zinc-300 px-2 py-1 text-xs text-right dark:border-zinc-600 dark:bg-zinc-800"
                        />
                      ) : (
                        <span className="text-xs text-zinc-600">
                          {sh.allocated_units != null
                            ? sh.allocated_units.toFixed(1)
                            : "-"}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {isEdit ? (
                        <input
                          type="number"
                          value={editValues.allocated_charge ?? 0}
                          onChange={(e) =>
                            setEditValues({
                              ...editValues,
                              allocated_charge: Number(e.target.value),
                            })
                          }
                          className="w-24 rounded border border-zinc-300 px-2 py-1 text-xs text-right dark:border-zinc-600 dark:bg-zinc-800"
                        />
                      ) : (
                        <span className="text-zinc-700 dark:text-zinc-300">
                          {sh.allocated_charge.toLocaleString()}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {isEdit ? (
                        <input
                          type="number"
                          value={editValues.allocated_paid ?? 0}
                          onChange={(e) =>
                            setEditValues({
                              ...editValues,
                              allocated_paid: Number(e.target.value),
                            })
                          }
                          className="w-24 rounded border border-zinc-300 px-2 py-1 text-xs text-right dark:border-zinc-600 dark:bg-zinc-800"
                        />
                      ) : (
                        <span className="text-emerald-600 dark:text-emerald-400">
                          {sh.allocated_paid.toLocaleString()}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center text-xs">
                      {sh.is_manual ? (
                        <span
                          className="inline-flex rounded-sm bg-blue-100 px-1.5 py-0.5 font-bold text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                          title="수동 편집됨 — 다음 동기화에서 보존"
                        >
                          🔒 수동
                        </span>
                      ) : (
                        <span
                          className="text-zinc-400"
                          title="자동 분배됨 — 다음 동기화에서 재생성"
                        >
                          🔄 자동
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center text-xs">
                      {isEdit ? (
                        <>
                          <button
                            onClick={() => saveEdit(sh)}
                            disabled={isSaving}
                            className="mr-1 text-blue-600 hover:text-blue-800"
                          >
                            {isSaving ? "저장 중..." : "저장"}
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="text-zinc-400 hover:text-zinc-600"
                          >
                            취소
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startEdit(sh)}
                            className="mr-1 text-blue-600 hover:text-blue-800"
                          >
                            수정
                          </button>
                          <button
                            onClick={() => deleteShare(sh)}
                            className="text-red-500 hover:text-red-700"
                          >
                            삭제
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 rounded-sm border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        ⚠️ 수정 시 <code className="font-mono">is_manual: true</code> 자동 설정 →
        다음 시트 동기화에서 덮어써지지 않음. 잘못 수정하면 정산에 직접 영향.
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  const cls = highlight
    ? "border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950"
    : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900";
  return (
    <div className={`border px-3 py-2 ${cls}`}>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-0.5 text-base font-bold text-zinc-900 dark:text-zinc-100">
        {value}
      </p>
    </div>
  );
}
