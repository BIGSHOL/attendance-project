"use client";

import { useMemo, useState } from "react";
import { useStaff } from "@/hooks/useStaff";
import { useTeacherSettings } from "@/hooks/useTeacherSettings";
import { useAllBlogPosts } from "@/hooks/useAllBlogPosts";
import { useHiddenTeachers } from "@/hooks/useHiddenTeachers";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { toSubjectLabel } from "@/lib/labelMap";
import {
  formatBlogDate,
  formatBlogDateLabel,
  parseBlogDatesInput,
} from "@/lib/blogDate";

/**
 * 블로그 일괄 관리 페이지 (audit #14).
 *
 * 선생님 상세 페이지에 흩어져 있던 블로그 의무·작성 상태·패널티를
 * 한 화면으로 통합. 의무 토글을 즉시 반영해 정산 패널티 자동 갱신.
 */
export default function BlogManagementPage() {
  const now = new Date();
  const [year, setYear] = useLocalStorage<number>(
    "blogManagement.year",
    now.getFullYear()
  );
  const [month, setMonth] = useLocalStorage<number>(
    "blogManagement.month",
    now.getMonth() + 1
  );
  const [showOnlyRequired, setShowOnlyRequired] = useLocalStorage<boolean>(
    "blogManagement.showOnlyRequired",
    false
  );
  const [search, setSearch] = useLocalStorage<string>(
    "blogManagement.search",
    ""
  );

  const { teachers, loading: staffLoading } = useStaff();
  const { isBlogRequired, setBlogRequired } = useTeacherSettings();
  const { posts, loading: postsLoading, refetch, savePost } =
    useAllBlogPosts(year, month);
  const { hiddenTeacherIds } = useHiddenTeachers();

  // 표시 행 — 숨김 선생님 제외 + 검색 + (옵션) 의무자만
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return teachers
      .filter((t) => !hiddenTeacherIds.has(t.id))
      .filter((t) => {
        if (showOnlyRequired && !isBlogRequired(t.id)) return false;
        if (!q) return true;
        const haystack = (
          (t.name || "") +
          " " +
          (t.englishName || "") +
          " " +
          (t.subjects || []).join(" ")
        ).toLowerCase();
        return haystack.includes(q);
      })
      .map((t) => {
        const required = isBlogRequired(t.id);
        const post = posts.find((p) => p.teacher_id === t.id);
        const dates = post?.dates || [];
        const wrote = dates.length > 0;
        const penalty = required && !wrote;
        return {
          teacher: t,
          required,
          dates,
          wrote,
          penalty,
          note: post?.note || "",
        };
      })
      .sort((a, b) => {
        // 패널티 → 의무 미작성 → 의무 작성 → 미의무
        const score = (r: typeof a) =>
          r.penalty ? 0 : r.required && !r.wrote ? 1 : r.required ? 2 : 3;
        const d = score(a) - score(b);
        if (d !== 0) return d;
        return a.teacher.name.localeCompare(b.teacher.name, "ko");
      });
  }, [
    teachers,
    hiddenTeacherIds,
    search,
    showOnlyRequired,
    isBlogRequired,
    posts,
  ]);

  // 요약
  const summary = useMemo(() => {
    const requiredN = rows.filter((r) => r.required).length;
    const wroteN = rows.filter((r) => r.required && r.wrote).length;
    const penaltyN = rows.filter((r) => r.penalty).length;
    return { requiredN, wroteN, penaltyN, total: rows.length };
  }, [rows]);

  const [savingId, setSavingId] = useState<string | null>(null);

  // 작성 일자 인라인 편집 상태
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftDates, setDraftDates] = useState<string>("");
  const [savingDateId, setSavingDateId] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const startEdit = (teacherId: string, dates: string[]) => {
    setEditError(null);
    setEditingId(teacherId);
    setDraftDates(dates.map((d) => formatBlogDate(d, year, month)).join(", "));
  };
  const cancelEdit = () => {
    setEditingId(null);
    setDraftDates("");
    setEditError(null);
  };
  const handleSaveDates = async (teacherId: string, note: string) => {
    const dates = parseBlogDatesInput(draftDates, year, month);
    setSavingDateId(teacherId);
    setEditError(null);
    try {
      await savePost(teacherId, dates, note);
      setEditingId(null);
      setDraftDates("");
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "저장에 실패했습니다");
    } finally {
      setSavingDateId(null);
    }
  };

  const handleToggle = async (teacherId: string, next: boolean) => {
    setSavingId(teacherId);
    try {
      await setBlogRequired(teacherId, next);
      // posts 는 변하지 않음 (의무 여부만 토글) — 단순 lookup 갱신
    } finally {
      setSavingId(null);
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

  const loading = staffLoading || postsLoading;

  return (
    <div className="mx-auto max-w-5xl">
      {/* 헤더 */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
          📝 블로그 일괄 관리
          <span className="ml-2 text-sm font-normal text-zinc-500">
            ({summary.total}명)
          </span>
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={refetch}
            className="rounded-sm border border-zinc-300 bg-white px-2.5 py-1.5 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            title="블로그 작성 기록 새로 고침"
          >
            🔄 새로고침
          </button>
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

      {/* 요약 카드 */}
      <div className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="총 선생님" value={`${summary.total}명`} />
        <Stat label="블로그 의무" value={`${summary.requiredN}명`} />
        <Stat
          label="이번 달 작성"
          value={`${summary.wroteN}/${summary.requiredN}명`}
          good
        />
        <Stat
          label="패널티 적용"
          value={`${summary.penaltyN}명`}
          warn={summary.penaltyN > 0}
        />
      </div>

      {/* 필터 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔎 선생님 검색"
          className="rounded-sm border border-zinc-300 bg-white px-2.5 py-1.5 text-sm w-56 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <label className="flex items-center gap-1.5 rounded-sm border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={showOnlyRequired}
            onChange={(e) => setShowOnlyRequired(e.target.checked)}
          />
          의무자만
        </label>
      </div>

      {/* 표 */}
      <div className="overflow-x-auto border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/50">
              <th className="px-3 py-2 text-left font-medium">#</th>
              <th className="px-3 py-2 text-left font-medium">선생님</th>
              <th className="px-3 py-2 text-left font-medium">과목</th>
              <th className="px-3 py-2 text-center font-medium">의무</th>
              <th className="px-3 py-2 text-left font-medium">
                작성 일자{" "}
                <span className="font-normal text-zinc-400">
                  (클릭해서 수정)
                </span>
              </th>
              <th className="px-3 py-2 text-center font-medium">상태</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-400">
                  로딩 중...
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-400">
                  표시할 선생님이 없습니다.
                </td>
              </tr>
            )}
            {rows.map((r, idx) => {
              const rowBg = r.penalty
                ? "bg-red-50 hover:bg-red-100 dark:bg-red-950/30 dark:hover:bg-red-950/50"
                : "hover:bg-zinc-50 dark:hover:bg-zinc-800/30";
              return (
                <tr
                  key={r.teacher.id}
                  className={`border-b border-zinc-200 dark:border-zinc-800 ${rowBg}`}
                >
                  <td className="px-3 py-2 text-zinc-400">{idx + 1}</td>
                  <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">
                    {r.teacher.name}
                    {r.teacher.englishName && (
                      <span className="ml-1 text-xs text-zinc-400">
                        ({r.teacher.englishName})
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-500">
                    {(r.teacher.subjects || []).map(toSubjectLabel).join(", ") ||
                      "-"}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => handleToggle(r.teacher.id, !r.required)}
                      disabled={savingId === r.teacher.id}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        r.required
                          ? "bg-emerald-500"
                          : "bg-zinc-300 dark:bg-zinc-700"
                      } ${savingId === r.teacher.id ? "opacity-50" : ""}`}
                      title={r.required ? "의무 OFF" : "의무 ON"}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                          r.required ? "translate-x-5" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {editingId === r.teacher.id ? (
                      <div className="flex flex-wrap items-center gap-1">
                        <input
                          type="text"
                          autoFocus
                          value={draftDates}
                          onChange={(e) => setDraftDates(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleSaveDates(r.teacher.id, r.note);
                            } else if (e.key === "Escape") {
                              cancelEdit();
                            }
                          }}
                          disabled={savingDateId === r.teacher.id}
                          placeholder="예: 7, 14, 21"
                          title="작성한 일(日) 숫자를 쉼표로 구분. 지난달 글을 늦게 적었으면 5/3 또는 2026-05-03 형식."
                          className="w-32 rounded-sm border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 placeholder-zinc-400 focus:border-blue-500 focus:outline-none disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveDates(r.teacher.id, r.note)}
                          disabled={savingDateId === r.teacher.id}
                          className="rounded-sm bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {savingDateId === r.teacher.id ? "저장 중" : "저장"}
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={savingDateId === r.teacher.id}
                          className="rounded-sm border border-zinc-300 px-2 py-1 text-[11px] text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        >
                          취소
                        </button>
                        {editError && (
                          <span className="text-[10px] text-red-600 dark:text-red-400">
                            {editError}
                          </span>
                        )}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEdit(r.teacher.id, r.dates)}
                        title="클릭해서 작성 일자 수정"
                        className="group inline-flex items-center gap-1 rounded-sm px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        {r.dates.length > 0 ? (
                          <span className="text-zinc-600 dark:text-zinc-400">
                            {r.dates
                              .map((d) => formatBlogDateLabel(d, year, month))
                              .join(", ")}
                            <span className="ml-1 text-[10px] text-zinc-400">
                              ({r.dates.length}회)
                            </span>
                          </span>
                        ) : (
                          <span className="text-zinc-400">기록 없음</span>
                        )}
                        <span className="text-[10px] opacity-0 transition-opacity group-hover:opacity-70">
                          ✏️
                        </span>
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center text-xs">
                    {r.penalty ? (
                      <span className="inline-flex rounded-sm bg-red-100 px-2 py-0.5 font-bold text-red-700 dark:bg-red-900 dark:text-red-300">
                        🚨 패널티 −2%
                      </span>
                    ) : r.required && r.wrote ? (
                      <span className="inline-flex rounded-sm bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
                        ✓ 작성
                      </span>
                    ) : r.required ? (
                      <span className="inline-flex rounded-sm bg-amber-100 px-2 py-0.5 font-medium text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                        대기 중
                      </span>
                    ) : (
                      <span className="text-zinc-400">미의무</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  warn,
  good,
}: {
  label: string;
  value: string;
  warn?: boolean;
  good?: boolean;
}) {
  const cls = warn
    ? "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
    : good
      ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
      : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900";
  return (
    <div className={`border px-3 py-2 ${cls}`}>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-0.5 text-base font-bold">{value}</p>
    </div>
  );
}
