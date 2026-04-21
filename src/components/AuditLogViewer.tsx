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
  user_roles: "사용자 권한",
  teacher_sheets: "선생님 시트",
  payment_shares: "수납 분배",
  virtual_students: "가상 학생",
  monthly_settlements: "월별 정산",
  teacher_blog_posts: "블로그 기록",
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

// ─── 필드명 한글화 ────────────────────────────────────
const FIELD_LABELS: Record<string, string> = {
  // 공통 / 메타
  id: "식별자",
  created_at: "생성일시",
  updated_at: "수정일시",
  edited_at: "변경일시",
  // 사용자/선생님
  staff_id: "선생님",
  staff_name: "선생님명",
  user_id: "사용자",
  email: "이메일",
  role: "역할",
  approved_at: "승인일시",
  approved_by: "승인자",
  salary_type: "급여 유형",
  blog_required: "블로그 의무",
  commission_days: "비율제 요일",
  admin_allowance: "행정수당",
  ratios: "과목별 비율",
  base_amount: "기본 금액",
  base_salary: "기본급",
  final_salary: "최종 지급액",
  // 학생
  student_id: "학생",
  student_name: "학생명",
  student_code: "학생 번호",
  grade: "학년",
  school: "학교",
  status: "상태",
  start_date: "시작일",
  end_date: "종료일",
  // 수업/등급
  class_id: "수업ID",
  class_name: "수업명",
  tier_id: "등급ID",
  tier_name: "등급",
  unit_price: "단가",
  subject: "과목",
  category: "분류",
  // 수납
  billing_month: "청구 월",
  payment_name: "납부 항목",
  payment_date: "납부일",
  payment_method: "납부 방법",
  charge_amount: "청구액",
  paid_amount: "납부액",
  unpaid_amount: "미납액",
  discount_amount: "할인액",
  memo: "메모",
  teacher_staff_id: "담당 선생님",
  teacher_name: "담당 선생님명",
  // 출석
  teacher_id: "선생님ID",
  date: "날짜",
  check_in: "입실",
  check_out: "퇴실",
  hours: "시수",
  is_makeup: "보강 여부",
  // 세션
  year: "연도",
  month: "월",
  ranges: "기간",
  sessions: "수업 회수",
  // 정산
  has_blog: "블로그 작성",
  has_retention: "퇴원율 달성",
  other_amount: "기타 금액",
  note: "비고",
  is_finalized: "확정 여부",
  finalized_at: "확정일시",
  // 블로그
  dates: "게시일",
  // 기타
  record_id: "대상",
  table_name: "테이블",
  changes: "변경 내용",
};

function toFieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

// ─── 값 번역기 (필드별) ────────────────────────────────
const VALUE_TRANSLATORS: Record<string, (v: unknown) => string> = {
  salary_type: (v) => {
    const m: Record<string, string> = { commission: "비율제", fixed: "급여제", mixed: "혼합" };
    return m[String(v)] ?? String(v);
  },
  role: (v) => {
    const m: Record<string, string> = {
      master: "마스터",
      admin: "관리자",
      teacher: "선생님",
      pending: "대기",
    };
    return m[String(v)] ?? String(v);
  },
  status: (v) => {
    const m: Record<string, string> = {
      active: "재원",
      inactive: "퇴원",
      withdrawn: "퇴원",
      on_hold: "휴원",
      hold: "휴원",
      pending: "대기",
      trial: "체험",
      prospect: "상담중",
      prospective: "상담중",
    };
    return m[String(v)] ?? String(v);
  },
  subject: (v) => {
    const m: Record<string, string> = {
      math: "수학",
      english: "영어",
      korean: "국어",
      science: "과학",
      social: "사회",
      highmath: "고등수학",
    };
    return m[String(v)] ?? String(v);
  },
  is_makeup: (v) => (v ? "보강" : "정규"),
  blog_required: (v) => (v ? "있음" : "없음"),
  has_blog: (v) => (v ? "작성" : "미작성"),
  has_retention: (v) => (v ? "달성" : "미달성"),
  is_finalized: (v) => (v ? "확정" : "미확정"),
};

// ISO 타임스탬프 감지 (YYYY-MM-DDTHH:MM:SS…)
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function formatDateKR(s: string): string {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString("ko-KR", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// virtual_{teacher}_{student}_{school}_{grade} 파싱
function parseVirtualStudent(id: string): string | null {
  if (!id.startsWith("virtual_")) return null;
  const parts = id.slice(8).split("_");
  if (parts.length < 2) return null;
  const [teacher, student, school, grade] = parts;
  const bits: string[] = [student];
  const meta: string[] = [];
  if (school) meta.push(school);
  if (grade) meta.push(grade);
  if (meta.length) bits.push(`(${meta.join(" ")})`);
  if (teacher) bits.push(`· 담임 ${teacher}`);
  return bits.join(" ");
}

// UUID 감지 (36자 + 하이픈)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatValue(v: unknown, field?: string): string {
  if (v === null || v === undefined || v === "") return "—";
  if (field && VALUE_TRANSLATORS[field]) return VALUE_TRANSLATORS[field](v);
  if (typeof v === "boolean") return v ? "예" : "아니오";
  if (typeof v === "number") return v.toLocaleString("ko-KR");
  if (typeof v === "string") {
    if (ISO_RE.test(v)) return formatDateKR(v);
    if (UUID_RE.test(v)) return `…${v.slice(-6)}`;
    const parsed = parseVirtualStudent(v);
    if (parsed) return parsed;
    return v;
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return "없음";
    return v.map((item) => formatValue(item)).join(", ");
  }
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) return "없음";
    // 작은 객체는 간단히 표시
    if (keys.length <= 3) {
      return keys
        .map((k) => `${toFieldLabel(k)} ${formatValue(obj[k], k)}`)
        .join(", ");
    }
    return `${keys.length}개 항목`;
  }
  return String(v);
}

// 내부용/덜 중요한 필드는 기본적으로 접어둠
const LOW_PRIORITY_FIELDS = new Set([
  "id",
  "created_at",
  "updated_at",
  "approved_at",
  "approved_by",
  "finalized_at",
  "edited_at",
]);

function FieldRow({
  field,
  value,
  muted,
}: {
  field: string;
  value: unknown;
  muted?: boolean;
}) {
  return (
    <div className={`text-zinc-700 dark:text-zinc-300 ${muted ? "opacity-60" : ""}`}>
      <span className="font-semibold text-zinc-800 dark:text-zinc-200">
        {toFieldLabel(field)}
      </span>
      <span className="text-zinc-400">: </span>
      <span>{formatValue(value, field)}</span>
    </div>
  );
}

function ChangesCell({ changes, action }: { changes: Record<string, unknown>; action: string }) {
  const [expanded, setExpanded] = useState(false);

  if (action === "bulk") {
    return (
      <div className="text-xs">
        {Object.entries(changes).map(([k, v]) => (
          <FieldRow key={k} field={k} value={v} />
        ))}
      </div>
    );
  }

  if (action === "insert" || action === "delete") {
    const snapshot = (changes.after || changes.before || {}) as Record<string, unknown>;
    // 중요 필드 우선, 저우선순위는 뒤로
    const allEntries = Object.entries(snapshot).sort(([a], [b]) => {
      const aLow = LOW_PRIORITY_FIELDS.has(a) ? 1 : 0;
      const bLow = LOW_PRIORITY_FIELDS.has(b) ? 1 : 0;
      return aLow - bLow;
    });
    const visibleCount = 4;
    const entries = expanded ? allEntries : allEntries.slice(0, visibleCount);
    const remaining = allEntries.length - visibleCount;
    return (
      <div className="text-xs">
        {entries.map(([k, v]) => (
          <FieldRow key={k} field={k} value={v} muted={LOW_PRIORITY_FIELDS.has(k)} />
        ))}
        {remaining > 0 && (
          <button
            onClick={() => setExpanded((x) => !x)}
            className="mt-0.5 text-blue-600 hover:underline dark:text-blue-400"
          >
            {expanded ? "접기" : `+${remaining}개 더 보기`}
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
          <span className="font-semibold text-zinc-800 dark:text-zinc-200">
            {toFieldLabel(field)}:
          </span>
          <span className="text-rose-600 line-through dark:text-rose-400">
            {formatValue(diff?.from, field)}
          </span>
          <span className="text-zinc-400">→</span>
          <span className="text-emerald-700 dark:text-emerald-400">
            {formatValue(diff?.to, field)}
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
