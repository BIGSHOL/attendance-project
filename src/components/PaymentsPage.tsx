"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import ExcelUploader from "./ExcelUploader";
import ColumnFilter from "./ColumnFilter";
import Pagination from "./Pagination";
import { useStaff } from "@/hooks/useStaff";
import { useStudents } from "@/hooks/useStudents";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { type PaymentRow } from "@/lib/parsePaymentExcel";
import { SkeletonTable } from "@/components/ui/Skeleton";

interface Payment {
  id: string;
  student_code: string;
  student_name: string;
  grade: string;
  school: string;
  billing_month: string;
  payment_name: string;
  charge_amount: number;
  discount_amount: number;
  paid_amount: number;
  unpaid_amount: number;
  payment_method: string;
  payment_date: string;
  teacher_name: string;
  teacher_staff_id: string | null;
  memo: string;
}

interface MonthSummary {
  month: string;
  count: number;
  total_charge: number;
  total_paid: number;
}

type SortKey = "student_name" | "school" | "grade" | "payment_name" | "charge_amount" | "discount_amount" | "paid_amount" | "teacher_name";
type SortDir = "asc" | "desc";

const PAGE_SIZE = 30;

function formatMonth(m: string) {
  return `${m.slice(0, 4)}년 ${parseInt(m.slice(4))}월`;
}

export default function PaymentsPage() {
  const { staff } = useStaff();
  const { students } = useStudents();

  // student_code → Firebase student id 매핑
  const studentIdByCode = useMemo(() => {
    const map = new Map<string, string>();
    students.forEach((s) => {
      if (s.studentCode) map.set(s.studentCode, s.id);
    });
    return map;
  }, [students]);
  const [selectedMonth, setSelectedMonth] = useLocalStorage<string | null>(
    "payments.selectedMonth",
    null
  );
  const [monthSummaries, setMonthSummaries] = useState<MonthSummary[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingRows, setPendingRows] = useState<PaymentRow[] | null>(null);
  const [pendingMonth, setPendingMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [search, setSearch] = useLocalStorage<string>("payments.search", "");
  const [columnFiltersArr, setColumnFiltersArr] = useLocalStorage<Record<string, string[]>>(
    "payments.columnFilters",
    {}
  );
  const columnFilters = useMemo(() => {
    const result: Record<string, Set<string>> = {};
    for (const [k, v] of Object.entries(columnFiltersArr)) result[k] = new Set(v);
    return result;
  }, [columnFiltersArr]);
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Partial<Payment>>({});
  const [sortKey, setSortKey] = useLocalStorage<SortKey>("payments.sortKey", "student_name");
  const [sortDir, setSortDir] = useLocalStorage<SortDir>("payments.sortDir", "asc");

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(1);
  };

  const buildStaffMap = useCallback(() => {
    const map: Record<string, string> = {};
    for (const s of staff) {
      map[s.name] = s.id;
      const match = s.name.match(/^(.+?)\(/);
      if (match) map[match[1]] = s.id;
    }
    return map;
  }, [staff]);

  // 월별 요약 목록 가져오기
  const fetchMonthSummaries = useCallback(async () => {
    const res = await fetch("/api/payments/months?summary=true");
    const data = await res.json();
    if (Array.isArray(data)) setMonthSummaries(data);
  }, []);

  const fetchPayments = useCallback(async (month: string) => {
    setLoading(true);
    const res = await fetch(`/api/payments?month=${month}`);
    const data = await res.json();
    if (Array.isArray(data)) setPayments(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchMonthSummaries();
  }, [fetchMonthSummaries]);

  useEffect(() => {
    if (selectedMonth) {
      fetchPayments(selectedMonth);
    }
  }, [selectedMonth, fetchPayments]);

  const handleParsed = (rows: PaymentRow[]) => {
    if (rows.length === 0) return;
    // 엑셀의 청구월을 기본값으로 제안하되, 수동 변경 가능
    const suggested = rows[0].billing_month;
    if (suggested) setPendingMonth(suggested);
    setPendingRows(rows);
  };

  const handleConfirmUpload = async () => {
    if (!pendingRows) return;

    const existing = monthSummaries.find((s) => s.month === pendingMonth);
    if (existing) {
      const choice = confirm(
        `${formatMonth(pendingMonth)} 수납 데이터가 이미 ${existing.count}건 있습니다.\n\n[확인] 기존 데이터를 덮어쓰기\n[취소] 업로드 취소`
      );
      if (!choice) return;
    }

    // 모든 행의 billing_month를 선택한 월로 통일
    const rows = pendingRows.map((r) => ({ ...r, billing_month: pendingMonth }));

    setSaving(true);
    const staffMap = buildStaffMap();
    const res = await fetch("/api/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows, staffMap }),
    });
    const result = await res.json();
    setSaving(false);
    setPendingRows(null);

    if (res.ok) {
      await fetchMonthSummaries();
      setSelectedMonth(pendingMonth);
    } else {
      alert(result.error || "저장 실패");
    }
  };

  const cancelUpload = () => {
    setPendingRows(null);
  };

  const openMonth = (month: string) => {
    setSelectedMonth(month);
    setPage(1);
  };

  const goBack = () => {
    setSelectedMonth(null);
    setPayments([]);
    fetchMonthSummaries();
  };

  // 열별 고유값 추출
  const columnValues = useMemo(() => {
    const cols: Record<string, string[]> = {};
    const keys: SortKey[] = ["student_name", "school", "grade", "payment_name", "teacher_name"];
    for (const key of keys) {
      const set = new Set<string>();
      payments.forEach((p) => { const v = String(p[key] || ""); if (v) set.add(v); });
      cols[key] = Array.from(set);
    }
    return cols;
  }, [payments]);

  const setColumnFilter = (key: string, selected: Set<string>) => {
    setColumnFiltersArr({ ...columnFiltersArr, [key]: Array.from(selected) });
    setPage(1);
  };

  const filtered = useMemo(() => {
    let list = payments;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.student_name.toLowerCase().includes(q) ||
          p.payment_name.toLowerCase().includes(q)
      );
    }

    // 열별 체크박스 필터
    for (const [key, selected] of Object.entries(columnFilters)) {
      if (selected.size > 0) {
        list = list.filter((p) => selected.has(String(p[key as keyof Payment] || "")));
      }
    }

    const sorted = [...list].sort((a, b) => {
      const valA = a[sortKey];
      const valB = b[sortKey];
      let cmp = 0;
      if (typeof valA === "number" && typeof valB === "number") {
        cmp = valA - valB;
      } else {
        cmp = String(valA || "").localeCompare(String(valB || ""), "ko");
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return sorted;
  }, [payments, search, columnFilters, sortKey, sortDir]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  );

  const handleSearch = (v: string) => { setSearch(v); setPage(1); };

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, p) => ({
        charge: acc.charge + p.charge_amount,
        discount: acc.discount + p.discount_amount,
        paid: acc.paid + p.paid_amount,
      }),
      { charge: 0, discount: 0, paid: 0 }
    );
  }, [filtered]);

  const startEdit = (p: Payment) => {
    setEditingId(p.id);
    setEditValues({
      school: p.school,
      payment_name: p.payment_name,
      charge_amount: p.charge_amount,
      discount_amount: p.discount_amount,
      paid_amount: p.paid_amount,
      teacher_name: p.teacher_name,
      memo: p.memo,
    });
  };

  const saveEdit = async () => {
    if (!editingId || !selectedMonth) return;
    await fetch(`/api/payments/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editValues),
    });
    setEditingId(null);
    fetchPayments(selectedMonth);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValues({});
  };

  const deletePayment = async (id: string) => {
    if (!confirm("삭제하시겠습니까?")) return;
    await fetch(`/api/payments/${id}`, { method: "DELETE" });
    if (selectedMonth) fetchPayments(selectedMonth);
  };

  // ─── 메인 화면: 월 목록 + 업로더 ───
  if (!selectedMonth) {
    return (
      <div className="mx-auto max-w-4xl">
        <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-6">
          수납 관리
        </h2>

        <ExcelUploader onParsed={handleParsed} />

        {pendingRows && (
          <div className="mt-4 rounded-sm border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950">
            <div className="flex items-center gap-4 overflow-x-auto [&>*]:flex-shrink-0">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {pendingRows.length}건 파싱 완료 — 납부월 선택:
              </span>
              <input
                type="month"
                value={`${pendingMonth.slice(0, 4)}-${pendingMonth.slice(4)}`}
                onChange={(e) => {
                  const v = e.target.value.replace("-", "");
                  setPendingMonth(v);
                }}
                className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              />
              <button
                onClick={handleConfirmUpload}
                className="rounded-sm bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                저장
              </button>
              <button
                onClick={cancelUpload}
                className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              >
                취소
              </button>
            </div>
          </div>
        )}

        {saving && (
          <div className="mt-3 text-sm text-blue-600 dark:text-blue-400">저장 중...</div>
        )}

        {monthSummaries.length > 0 && (
          <div className="mt-8">
            <h3 className="text-sm font-medium text-zinc-500 mb-3">등록된 수납 내역</h3>
            <div className="grid grid-cols-3 gap-3">
              {monthSummaries.map((s) => (
                <button
                  key={s.month}
                  onClick={() => openMonth(s.month)}
                  className="text-left rounded-sm border border-zinc-200 bg-white p-4 hover:border-blue-400 hover:shadow-sm transition-all dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-blue-500"
                >
                  <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                    {formatMonth(s.month)}
                  </div>
                  <div className="mt-2 flex items-center gap-4 text-sm text-zinc-500">
                    <span>{s.count}건</span>
                    <span>납부 {s.total_paid.toLocaleString()}원</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── 상세 화면: 해당 월 수납 테이블 ───
  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={goBack}
            className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            ← 목록
          </button>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
            {formatMonth(selectedMonth)} 수납
          </h2>
        </div>
        <label className="cursor-pointer inline-flex items-center gap-1.5 rounded-sm border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700">
          <span>📂</span> 엑셀 재업로드
          <input
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const { parsePaymentExcel } = await import("@/lib/parsePaymentExcel");
              const buffer = await file.arrayBuffer();
              const rows = parsePaymentExcel(buffer);
              setPendingMonth(selectedMonth);
              setPendingRows(rows);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {pendingRows && (
        <div className="mb-4 rounded-sm border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950">
          <div className="flex items-center gap-4 overflow-x-auto [&>*]:flex-shrink-0">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {pendingRows.length}건 파싱 완료 — 납부월 선택:
            </span>
            <input
              type="month"
              value={`${pendingMonth.slice(0, 4)}-${pendingMonth.slice(4)}`}
              onChange={(e) => setPendingMonth(e.target.value.replace("-", ""))}
              className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            />
            <button
              onClick={handleConfirmUpload}
              className="rounded-sm bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              저장
            </button>
            <button
              onClick={cancelUpload}
              className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {saving && (
        <div className="mb-3 text-sm text-blue-600 dark:text-blue-400">저장 중...</div>
      )}

      {/* 요약 */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs text-zinc-500">총 청구액</div>
          <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
            {totals.charge.toLocaleString()}원
          </div>
        </div>
        <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs text-zinc-500">총 할인액</div>
          <div className="text-lg font-bold text-orange-600">
            {totals.discount.toLocaleString()}원
          </div>
        </div>
        <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs text-zinc-500">실 납부액</div>
          <div className="text-lg font-bold text-emerald-600">
            {totals.paid.toLocaleString()}원
          </div>
        </div>
      </div>

      {/* 검색 */}
      <div className="mt-4 flex gap-3 overflow-x-auto [&>*]:flex-shrink-0">
        <input
          type="text"
          placeholder="학생 / 수납명 검색"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="rounded-sm border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
        {Object.values(columnFilters).some((s) => s.size > 0) && (
          <button
            onClick={() => { setColumnFiltersArr({}); setPage(1); }}
            className="text-xs text-red-500 hover:text-red-700 self-center"
          >
            필터 초기화
          </button>
        )}
        <div className="ml-auto text-sm text-zinc-500 self-center">
          {filtered.length}건
        </div>
      </div>

      {/* 테이블 */}
      <div className="mt-3 overflow-x-auto rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        {loading ? (
          <SkeletonTable rows={10} cols={9} withHeader={false} className="border-0" />
        ) : (
          <table className="min-w-full text-sm [&_td]:border-r [&_td]:border-zinc-200 [&_th]:border-r [&_th]:border-zinc-300 [&_th]:whitespace-nowrap">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/50">
                <th className="px-3 py-2 text-left font-medium text-zinc-500">#</th>
                <th className="text-left">
                  <ColumnFilter
                    values={columnValues.student_name || []}
                    selected={columnFilters.student_name || new Set()}
                    onChange={(s) => setColumnFilter("student_name", s)}
                    sortKey={sortKey === "student_name" ? sortKey : null}
                    sortDir={sortDir}
                    onSort={(d) => { setSortKey("student_name"); setSortDir(d); setPage(1); }}
                  >이름</ColumnFilter>
                </th>
                <th className="text-left">
                  <ColumnFilter
                    values={columnValues.school || []}
                    selected={columnFilters.school || new Set()}
                    onChange={(s) => setColumnFilter("school", s)}
                    sortKey={sortKey === "school" ? sortKey : null}
                    sortDir={sortDir}
                    onSort={(d) => { setSortKey("school"); setSortDir(d); setPage(1); }}
                  >학교</ColumnFilter>
                </th>
                <th className="text-left">
                  <ColumnFilter
                    values={columnValues.grade || []}
                    selected={columnFilters.grade || new Set()}
                    onChange={(s) => setColumnFilter("grade", s)}
                    sortKey={sortKey === "grade" ? sortKey : null}
                    sortDir={sortDir}
                    onSort={(d) => { setSortKey("grade"); setSortDir(d); setPage(1); }}
                  >학년</ColumnFilter>
                </th>
                <th className="text-left">
                  <ColumnFilter
                    values={columnValues.payment_name || []}
                    selected={columnFilters.payment_name || new Set()}
                    onChange={(s) => setColumnFilter("payment_name", s)}
                    sortKey={sortKey === "payment_name" ? sortKey : null}
                    sortDir={sortDir}
                    onSort={(d) => { setSortKey("payment_name"); setSortDir(d); setPage(1); }}
                  >수납명</ColumnFilter>
                </th>
                <th className="text-right">
                  <ColumnFilter
                    values={[]}
                    selected={new Set()}
                    onChange={() => {}}
                    sortKey={sortKey === "charge_amount" ? sortKey : null}
                    sortDir={sortDir}
                    onSort={(d) => { setSortKey("charge_amount"); setSortDir(d); setPage(1); }}
                    align="right"
                  >청구액</ColumnFilter>
                </th>
                <th className="text-right">
                  <ColumnFilter
                    values={[]}
                    selected={new Set()}
                    onChange={() => {}}
                    sortKey={sortKey === "discount_amount" ? sortKey : null}
                    sortDir={sortDir}
                    onSort={(d) => { setSortKey("discount_amount"); setSortDir(d); setPage(1); }}
                    align="right"
                  >할인</ColumnFilter>
                </th>
                <th className="text-right">
                  <ColumnFilter
                    values={[]}
                    selected={new Set()}
                    onChange={() => {}}
                    sortKey={sortKey === "paid_amount" ? sortKey : null}
                    sortDir={sortDir}
                    onSort={(d) => { setSortKey("paid_amount"); setSortDir(d); setPage(1); }}
                    align="right"
                  >납부액</ColumnFilter>
                </th>
                <th className="text-left">
                  <ColumnFilter
                    values={columnValues.teacher_name || []}
                    selected={columnFilters.teacher_name || new Set()}
                    onChange={(s) => setColumnFilter("teacher_name", s)}
                    sortKey={sortKey === "teacher_name" ? sortKey : null}
                    sortDir={sortDir}
                    onSort={(d) => { setSortKey("teacher_name"); setSortDir(d); setPage(1); }}
                  >담임강사</ColumnFilter>
                </th>
                <th className="px-3 py-2 text-left font-medium text-zinc-500">메모</th>
                <th className="px-3 py-2 text-center font-medium text-zinc-500">편집</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((p, idx) => (
                <tr
                  key={p.id}
                  className="border-b border-zinc-300 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/30"
                >
                  <td className="px-3 py-2 text-zinc-400">
                    {(page - 1) * PAGE_SIZE + idx + 1}
                  </td>
                  <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                    {studentIdByCode.has(p.student_code) ? (
                      <Link
                        href={`/students/${studentIdByCode.get(p.student_code)}`}
                        className="hover:text-blue-600 hover:underline"
                      >
                        {p.student_name}
                      </Link>
                    ) : (
                      p.student_name
                    )}
                  </td>
                  {editingId === p.id ? (
                    <td className="px-3 py-2">
                      <input
                        value={editValues.school || ""}
                        onChange={(e) =>
                          setEditValues({ ...editValues, school: e.target.value })
                        }
                        className="w-full rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                      />
                    </td>
                  ) : (
                    <td className="px-3 py-2 text-zinc-500 whitespace-nowrap">
                      {p.school || "-"}
                    </td>
                  )}
                  <td className="px-3 py-2 text-zinc-500 whitespace-nowrap">
                    {p.grade}
                  </td>

                  {editingId === p.id ? (
                    <>
                      <td className="px-3 py-2">
                        <input
                          value={editValues.payment_name || ""}
                          onChange={(e) =>
                            setEditValues({ ...editValues, payment_name: e.target.value })
                          }
                          className="w-full rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          value={editValues.charge_amount ?? 0}
                          onChange={(e) =>
                            setEditValues({ ...editValues, charge_amount: Number(e.target.value) })
                          }
                          className="w-24 rounded border border-zinc-300 px-2 py-1 text-sm text-right dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          value={editValues.discount_amount ?? 0}
                          onChange={(e) =>
                            setEditValues({ ...editValues, discount_amount: Number(e.target.value) })
                          }
                          className="w-20 rounded border border-zinc-300 px-2 py-1 text-sm text-right dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          value={editValues.paid_amount ?? 0}
                          onChange={(e) =>
                            setEditValues({ ...editValues, paid_amount: Number(e.target.value) })
                          }
                          className="w-24 rounded border border-zinc-300 px-2 py-1 text-sm text-right dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={editValues.teacher_name || ""}
                          onChange={(e) =>
                            setEditValues({ ...editValues, teacher_name: e.target.value })
                          }
                          className="w-full rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={editValues.memo || ""}
                          onChange={(e) =>
                            setEditValues({ ...editValues, memo: e.target.value })
                          }
                          className="w-full rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </td>
                      <td className="px-3 py-2 text-center whitespace-nowrap">
                        <button
                          onClick={saveEdit}
                          className="text-xs text-blue-600 hover:text-blue-800 mr-2"
                        >
                          저장
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="text-xs text-zinc-400 hover:text-zinc-600"
                        >
                          취소
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300 max-w-[200px] truncate" title={p.payment_name}>
                        {p.payment_name}
                      </td>
                      <td className="px-3 py-2 text-right text-zinc-700 dark:text-zinc-300 whitespace-nowrap">
                        {p.charge_amount.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right text-orange-600 whitespace-nowrap">
                        {p.discount_amount > 0
                          ? `-${p.discount_amount.toLocaleString()}`
                          : "-"}
                      </td>
                      <td className="px-3 py-2 text-right text-emerald-600 whitespace-nowrap">
                        {p.paid_amount.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-zinc-500 whitespace-nowrap">
                        {p.teacher_staff_id ? (
                          <Link
                            href={`/teachers/${p.teacher_staff_id}`}
                            className="hover:text-blue-600 hover:underline"
                          >
                            {p.teacher_name || "-"}
                          </Link>
                        ) : (
                          p.teacher_name || "-"
                        )}
                      </td>
                      <td className="px-3 py-2 text-zinc-400 max-w-[120px] truncate" title={p.memo || ""}>
                        {p.memo || "-"}
                      </td>
                      <td className="px-3 py-2 text-center whitespace-nowrap">
                        <button
                          onClick={() => startEdit(p)}
                          className="text-xs text-blue-600 hover:text-blue-800 mr-2"
                        >
                          수정
                        </button>
                        <button
                          onClick={() => deletePayment(p.id)}
                          className="text-xs text-red-500 hover:text-red-700"
                        >
                          삭제
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
