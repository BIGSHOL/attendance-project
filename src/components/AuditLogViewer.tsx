"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Pagination from "./Pagination";
import { useLocalStorage } from "@/hooks/useLocalStorage";

interface AuditLog {
  id: string;
  table_name: string;
  record_id: string;
  action: "insert" | "update" | "delete" | "bulk";
  changes: Record<string, unknown>;
  edited_by: string;
  edited_by_name: string | null;
  edited_at: string;
  context: Record<string, unknown> | null;
}

const TABLE_LABELS: Record<string, string> = {
  payments: "수납",
  session_periods: "세션 기간",
  student_tier_overrides: "학생 단가 오버라이드",
  teacher_settings: "선생님 설정",
  salary_configs: "급여 설정",
  attendance: "출석",
};

const ACTION_LABELS: Record<string, string> = {
  insert: "추가",
  update: "수정",
  delete: "삭제",
  bulk: "일괄",
};

const ACTION_COLORS: Record<string, string> = {
  insert: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  update: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  delete: "bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300",
  bulk: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
};

const PAGE_SIZE = 50;

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function ChangesCell({ changes, action }: { changes: Record<string, unknown>; action: string }) {
  const [expanded, setExpanded] = useState(false);

  if (action === "bulk") {
    return (
      <div className="text-xs text-zinc-700 dark:text-zinc-300">
        {Object.entries(changes).map(([k, v]) => (
          <div key={k}>
            <span className="font-semibold">{k}:</span> {formatValue(v)}
          </div>
        ))}
      </div>
    );
  }

  if (action === "insert" || action === "delete") {
    const snapshot = (changes.after || changes.before || {}) as Record<string, unknown>;
    const entries = Object.entries(snapshot).slice(0, expanded ? undefined : 4);
    return (
      <div className="text-xs">
        {entries.map(([k, v]) => (
          <div key={k} className="text-zinc-700 dark:text-zinc-300">
            <span className="font-semibold">{k}:</span> {formatValue(v)}
          </div>
        ))}
        {Object.keys(snapshot).length > 4 && (
          <button
            onClick={() => setExpanded((x) => !x)}
            className="text-blue-600 hover:underline dark:text-blue-400"
          >
            {expanded ? "접기" : `+${Object.keys(snapshot).length - 4}개 더`}
          </button>
        )}
      </div>
    );
  }

  // update: { field: { from, to } }
  const fields = Object.entries(changes) as [string, { from: unknown; to: unknown }][];
  return (
    <div className="space-y-0.5 text-xs">
      {fields.map(([field, diff]) => (
        <div key={field} className="flex flex-wrap items-baseline gap-1">
          <span className="font-semibold text-zinc-800 dark:text-zinc-200">{field}:</span>
          <span className="text-rose-600 line-through dark:text-rose-400">
            {formatValue(diff?.from)}
          </span>
          <span className="text-zinc-400">→</span>
          <span className="text-emerald-700 dark:text-emerald-400">
            {formatValue(diff?.to)}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function AuditLogViewer() {
  const [tableFilter, setTableFilter] = useLocalStorage<string>("audit.table", "");
  const [userFilter, setUserFilter] = useLocalStorage<string>("audit.user", "");
  const [fromDate, setFromDate] = useLocalStorage<string>("audit.from", "");
  const [toDate, setToDate] = useLocalStorage<string>("audit.to", "");
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (tableFilter) params.set("table", tableFilter);
      if (userFilter) params.set("user", userFilter);
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);

      const res = await fetch(`/api/admin/audit-logs?${params}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setRows(data.rows);
        setTotal(data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [tableFilter, userFilter, fromDate, toDate, page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 필터 변경 시 1페이지로
  useEffect(() => {
    setPage(1);
  }, [tableFilter, userFilter, fromDate, toDate]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const tableOptions = useMemo(() => Object.keys(TABLE_LABELS), []);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">변경 이력</h1>
        <span className="text-xs text-zinc-500">총 {total.toLocaleString()}건</span>
      </div>

      <div className="flex flex-wrap items-end gap-2 border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div>
          <label className="block text-xs text-zinc-500">테이블</label>
          <select
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
            className="rounded-sm border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          >
            <option value="">전체</option>
            {tableOptions.map((t) => (
              <option key={t} value={t}>
                {TABLE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-zinc-500">사용자(이메일)</label>
          <input
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            placeholder="email 일부"
            className="rounded-sm border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-500">시작일</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="rounded-sm border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-500">종료일</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="rounded-sm border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </div>
        <button
          onClick={() => {
            setTableFilter("");
            setUserFilter("");
            setFromDate("");
            setToDate("");
          }}
          className="rounded-sm border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          초기화
        </button>
        <button
          onClick={fetchData}
          className="rounded-sm bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
        >
          새로고침
        </button>
      </div>

      <div className="overflow-x-auto border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2 text-left whitespace-nowrap">시각</th>
              <th className="px-3 py-2 text-left whitespace-nowrap">사용자</th>
              <th className="px-3 py-2 text-left whitespace-nowrap">테이블</th>
              <th className="px-3 py-2 text-left whitespace-nowrap">동작</th>
              <th className="px-3 py-2 text-left whitespace-nowrap">대상 ID</th>
              <th className="px-3 py-2 text-left">변경 내용</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {loading && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-zinc-500">
                  로드 중...
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-zinc-500">
                  기록이 없습니다
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-400">
                    {new Date(r.edited_at).toLocaleString("ko-KR", {
                      year: "2-digit",
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">
                    <div className="font-medium text-zinc-800 dark:text-zinc-200">
                      {r.edited_by_name || r.edited_by.split("@")[0]}
                    </div>
                    <div className="text-zinc-500">{r.edited_by}</div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-zinc-700 dark:text-zinc-300">
                    {TABLE_LABELS[r.table_name] || r.table_name}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span
                      className={`rounded-sm px-2 py-0.5 text-xs font-bold ${ACTION_COLORS[r.action] || ""}`}
                    >
                      {ACTION_LABELS[r.action] || r.action}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-xs text-zinc-500">
                    {r.record_id.length > 12 ? `…${r.record_id.slice(-12)}` : r.record_id}
                  </td>
                  <td className="px-3 py-2">
                    <ChangesCell changes={r.changes} action={r.action} />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
