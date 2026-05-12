"use client";

import { Fragment, useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import ColumnFilter from "./ColumnFilter";
import Pagination from "./Pagination";
import { useStudents } from "@/hooks/useStudents";
import { useStaff } from "@/hooks/useStaff";
import { useUserRole } from "@/hooks/useUserRole";
import { usePaymentSplits, buildSplitMap } from "@/hooks/usePaymentSplits";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { extractSubjectFromBillingName } from "@/lib/extractSubjectFromBillingName";
import { subjectToSalarySubject } from "@/lib/salary";
import PaymentSplitModal from "@/components/payments/PaymentSplitModal";
import type { Student } from "@/types";

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
  // Firebase billing.month 는 `YYYY-MM` 단일 포맷. 과거 Supabase 시절의 4종 포맷
  // 호환은 historical 데이터 표시용으로 유지.
  if (!m) return "";
  const digits = m.replace(/[^0-9]/g, "");
  if (digits.length < 6) return m;
  return `${digits.slice(0, 4)}년 ${parseInt(digits.slice(4, 6))}월`;
}

export default function PaymentsPage() {
  const { students } = useStudents();
  const { teachers: staff } = useStaff();
  const { isAdmin } = useUserRole();

  // student_code → Firebase student id 매핑 (학생 상세 페이지 링크용)
  const studentIdByCode = useMemo(() => {
    const map = new Map<string, string>();
    students.forEach((s) => {
      if (s.studentCode) map.set(s.studentCode, s.id);
    });
    return map;
  }, [students]);

  // 학생 lookup — billing 의 학교/담임강사 빈 칸 보강용.
  //   Firebase billing 은 MakeEdu 가 학생 학교를 채우지 않을 때가 있고,
  //   billingName 이 분반 코드만 들어가는 경우(MS2B, JJ2I 등) 강사 추출 실패.
  //   useStudents 가 이미 가져온 데이터에서 fallback.
  const studentLookup = useMemo(() => {
    const byCode = new Map<string, Student>();
    const byName = new Map<string, Student[]>();
    students.forEach((s) => {
      if (s.studentCode) byCode.set(s.studentCode, s);
      const list = byName.get(s.name) || [];
      list.push(s);
      byName.set(s.name, list);
    });
    return { byCode, byName };
  }, [students]);
  const [selectedMonth, setSelectedMonth] = useLocalStorage<string | null>(
    "payments.selectedMonth",
    null
  );
  const [monthSummaries, setMonthSummaries] = useState<MonthSummary[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(false);
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
  const [sortKey, setSortKey] = useLocalStorage<SortKey>("payments.sortKey", "student_name");
  const [sortDir, setSortDir] = useLocalStorage<SortDir>("payments.sortDir", "asc");

  // 수납 분리 데이터 — 선택된 월
  const { splits: paymentSplits, refetch: refetchSplits } = usePaymentSplits(selectedMonth);
  const splitMap = useMemo(() => buildSplitMap(paymentSplits), [paymentSplits]);

  // 분리 모달
  const [splitTarget, setSplitTarget] = useState<Payment | null>(null);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(1);
  };

  // 월별 요약 / 월별 row — 모두 Firebase billing (MakeEdu 매일 자동 동기화).
  //   출석부 프로그램이므로 수업료(수업/원복 카테고리) 만 표시. 교재/차량비는
  //   정산 대상 아님 — MakeEdu 의 별도 시스템에서 관리됨. /api/billing 기본값이
  //   수업+원복 이므로 추가 파라미터 불필요.
  const fetchMonthSummaries = useCallback(async () => {
    const res = await fetch("/api/billing?summary=true");
    const data = await res.json();
    if (Array.isArray(data)) setMonthSummaries(data);
  }, []);

  const fetchPayments = useCallback(async (month: string) => {
    setLoading(true);
    const res = await fetch(`/api/billing?month=${month}`);
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

  const openMonth = (month: string) => {
    setSelectedMonth(month);
    setPage(1);
  };

  const goBack = () => {
    setSelectedMonth(null);
    setPayments([]);
    fetchMonthSummaries();
  };

  // 학교/담임강사 보강.
  //   Firebase billing 원본은 school 이 항상 비어있고 담임강사 필드도 없음 — MakeEdu
  //   에서 분반 코드만 저장하기 때문. ijw-calander UI 도 사실은 students 컬렉션에서
  //   join 해서 표시하는 구조. 우리도 동일하게 학생 데이터로 보강한다.
  //
  //   우선순위:
  //   1) 원본 우선 — billing.school / billing.teacher_name (영어 강사 토큰 매칭된 경우)
  //   2) 학생 enrollment fallback —
  //      ① enrollment.className 이 billingName 의 prefix → 분반 코드 정확 매칭
  //         (예: className="중등M 초6 MS2B" ↔ billingName="중등M 초6 MS2B 월목")
  //      ② billingName 의 과목 추정 → 같은 과목 enrollment
  //      ③ 단일 enrollment → 그것
  //   3) 학교 — student.school (이미 normalizeSchool 적용된 단축형)
  const enrichedPayments = useMemo(() => {
    return payments.map((p) => {
      if (p.school && p.teacher_name) return p;
      let student: Student | undefined = p.student_code
        ? studentLookup.byCode.get(p.student_code)
        : undefined;
      if (!student) {
        const cands = studentLookup.byName.get(p.student_name) || [];
        if (cands.length === 1) {
          student = cands[0];
        } else if (cands.length > 1) {
          // 동명이인 — billing.school / grade 로 좁힘
          if (p.school) student = cands.find((c) => c.school === p.school);
          if (!student && p.grade) student = cands.find((c) => c.grade === p.grade);
          if (!student) student = cands[0];
        }
      }
      if (!student) return p;

      const school = p.school || student.school || "";
      let teacher_name = p.teacher_name;
      let teacher_staff_id = p.teacher_staff_id;

      if (!teacher_name && student.enrollments && student.enrollments.length > 0) {
        // ① enrollment.className 이 billingName 의 prefix — 분반 코드 정확 매칭
        let target = student.enrollments.find((e) => {
          const cn = (e.className || "").trim();
          return cn.length >= 4 && (p.payment_name || "").startsWith(cn);
        });

        // ② 과목 추정 매칭
        if (!target) {
          const guessed = extractSubjectFromBillingName(p.payment_name);
          if (guessed) {
            target = student.enrollments.find(
              (e) => subjectToSalarySubject(e.subject) === guessed
            );
          }
        }

        // ③ 단일 enrollment
        if (!target && student.enrollments.length === 1) target = student.enrollments[0];

        if (target) {
          teacher_name = target.teacher || target.staffId || "";
          teacher_staff_id = target.staffId || null;
        }
      }
      return { ...p, school, teacher_name, teacher_staff_id };
    });
  }, [payments, studentLookup]);

  // 열별 고유값 추출
  const columnValues = useMemo(() => {
    const cols: Record<string, string[]> = {};
    const keys: SortKey[] = ["student_name", "school", "grade", "payment_name", "teacher_name"];
    for (const key of keys) {
      const set = new Set<string>();
      enrichedPayments.forEach((p) => { const v = String(p[key] || ""); if (v) set.add(v); });
      cols[key] = Array.from(set);
    }
    return cols;
  }, [enrichedPayments]);

  const setColumnFilter = (key: string, selected: Set<string>) => {
    setColumnFiltersArr({ ...columnFiltersArr, [key]: Array.from(selected) });
    setPage(1);
  };

  const filtered = useMemo(() => {
    let list = enrichedPayments;
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
  }, [enrichedPayments, search, columnFilters, sortKey, sortDir]);

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

  // ─── 메인 화면: 월 목록 (Firebase billing) ───
  if (!selectedMonth) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
            수납 관리
          </h2>
        </div>

        <div className="rounded-sm border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950">
          <div className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
            🔄 MakeEdu 자동 동기화 — 수업료만 표시
          </div>
          <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
            매일 새벽 3시(KST) MakeEdu 외부 학원관리시스템에서 Firebase 의{" "}
            <code className="font-mono">billing</code> collection 으로 자동 업데이트됩니다.
            출석부 프로그램이므로 수업료(수업/원복) 만 가져옵니다 — 교재·차량비는 MakeEdu 별도 관리.
            정산·시수 검증도 같은 데이터를 공유합니다.
          </p>
        </div>

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

  // ─── 상세 화면: 해당 월 수납 테이블 (read-only) ───
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
          <span className="text-xs text-emerald-600 dark:text-emerald-400">
            MakeEdu 자동 동기화 — 수업료만, read-only
          </span>
        </div>
      </div>

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
      <div className="mt-4 flex flex-wrap gap-3">
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
                <th className="px-3 py-2 text-center font-medium text-zinc-500 w-[64px]">분리</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((p, idx) => {
                const splitKey = `${p.billing_month}|${p.student_name}|${p.school || ""}|${p.payment_name}`;
                const split = splitMap.get(splitKey);
                return (
                <Fragment key={p.id}>
                <tr
                  className={`border-b border-zinc-300 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/30 ${
                    split ? "bg-blue-50/30 dark:bg-blue-950/10" : ""
                  }`}
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
                  <td className="px-3 py-2 text-zinc-500 whitespace-nowrap">
                    {p.school || "-"}
                  </td>
                  <td className="px-3 py-2 text-zinc-500 whitespace-nowrap">
                    {p.grade}
                  </td>
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
                    {split ? (
                      <span className="text-xs text-blue-600 dark:text-blue-400">
                        분리됨 ({split.splits.length}명)
                      </span>
                    ) : p.teacher_staff_id ? (
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
                  <td className="px-3 py-2 text-center">
                    {isAdmin ? (
                      <button
                        type="button"
                        onClick={() => setSplitTarget(p)}
                        className={`rounded-sm border px-2 py-0.5 text-[11px] ${
                          split
                            ? "border-blue-400 text-blue-600 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400"
                            : "border-zinc-300 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                        }`}
                      >
                        {split ? "수정" : "분리"}
                      </button>
                    ) : (
                      <span className="text-[11px] text-zinc-400">-</span>
                    )}
                  </td>
                </tr>
                {split &&
                  split.splits.map((s, sIdx) => (
                    <tr
                      key={`${p.id}-split-${sIdx}`}
                      className="border-b border-zinc-100 bg-zinc-50/40 text-[11px] text-zinc-500 dark:border-zinc-900 dark:bg-zinc-900/40"
                    >
                      <td className="px-3 py-1" />
                      <td className="px-3 py-1" />
                      <td className="px-3 py-1" />
                      <td className="px-3 py-1" />
                      <td className="px-3 py-1 pl-5 text-zinc-500">
                        └ {s.teacher_name}
                        {s.role ? <span className="ml-1 text-zinc-400">({s.role})</span> : null}
                      </td>
                      <td className="px-3 py-1 text-right">{s.amount.toLocaleString()}</td>
                      <td className="px-3 py-1" />
                      <td className="px-3 py-1 text-right text-emerald-600/70">
                        {s.amount.toLocaleString()}
                      </td>
                      <td className="px-3 py-1 text-zinc-500">{s.teacher_name}</td>
                      <td className="px-3 py-1" />
                      <td className="px-3 py-1" />
                    </tr>
                  ))}
                </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />

      <PaymentSplitModal
        open={!!splitTarget}
        onClose={() => setSplitTarget(null)}
        billing={
          splitTarget
            ? {
                billing_month: splitTarget.billing_month,
                student_name: splitTarget.student_name,
                student_school: splitTarget.school || "",
                billing_name: splitTarget.payment_name,
                charge_amount: splitTarget.charge_amount,
              }
            : null
        }
        staff={staff}
        existing={
          splitTarget
            ? splitMap.get(
                `${splitTarget.billing_month}|${splitTarget.student_name}|${splitTarget.school || ""}|${splitTarget.payment_name}`
              ) || null
            : null
        }
        defaultTeacher={
          splitTarget && splitTarget.teacher_staff_id
            ? { id: splitTarget.teacher_staff_id, name: splitTarget.teacher_name }
            : null
        }
        onSaved={() => {
          refetchSplits();
        }}
      />
    </div>
  );
}
