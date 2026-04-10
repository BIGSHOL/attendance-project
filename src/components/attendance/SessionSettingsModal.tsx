"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { SessionPeriod, DateRange } from "@/types";
import { useSessionPeriods } from "@/hooks/useSessionPeriods";
import { formatDateKey, getDaysInMonth } from "@/lib/date";
import { mergeOverlappingRanges, parseDateKey } from "@/lib/sessionUtils";
import { toSubjectLabel } from "@/lib/labelMap";
import { useLocalStorage } from "@/hooks/useLocalStorage";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  year: number;
  subjects: string[];
  initialSubject: string;
}

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

// 월별 세션 색상 (1~12월)
const MONTH_COLORS: Record<number, { bg: string; text: string }> = {
  1: { bg: "bg-rose-500", text: "text-white" },
  2: { bg: "bg-orange-500", text: "text-white" },
  3: { bg: "bg-amber-500", text: "text-white" },
  4: { bg: "bg-lime-500", text: "text-white" },
  5: { bg: "bg-emerald-500", text: "text-white" },
  6: { bg: "bg-teal-500", text: "text-white" },
  7: { bg: "bg-cyan-500", text: "text-white" },
  8: { bg: "bg-sky-500", text: "text-white" },
  9: { bg: "bg-blue-500", text: "text-white" },
  10: { bg: "bg-indigo-500", text: "text-white" },
  11: { bg: "bg-violet-500", text: "text-white" },
  12: { bg: "bg-fuchsia-500", text: "text-white" },
};

function MiniCalendar({
  year,
  month,
  rangesByMonth,
  dragRange,
  dragStartMonth,
  onMouseDown,
  onMouseEnter,
}: {
  year: number;
  month: number;
  rangesByMonth: Record<number, DateRange[]>;
  dragRange: { start: string; end: string } | null;
  dragStartMonth: number | null;
  onMouseDown: (dateKey: string, sourceMonth: number) => void;
  onMouseEnter: (dateKey: string) => void;
}) {
  // 항상 6주(42칸) 고정 그리드 — 전월/차월 날짜 포함
  const days = useMemo(() => {
    const firstOfMonth = new Date(year, month - 1, 1);
    const startDow = firstOfMonth.getDay(); // 0(일)~6(토)
    const gridStart = new Date(year, month - 1, 1 - startDow);
    const result: { date: Date; inMonth: boolean }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      result.push({ date: d, inMonth: d.getMonth() === month - 1 });
    }
    return result;
  }, [year, month]);

  // 날짜가 어느 월의 세션에 속하는지 찾기 (이 mini calendar의 month에 속하는 세션만)
  const getMatchingMonth = useCallback(
    (key: string): number | null => {
      const ownRanges = rangesByMonth[month] || [];
      if (ownRanges.some((r) => key >= r.startDate && key <= r.endDate)) {
        return month;
      }
      return null;
    },
    [rangesByMonth, month]
  );

  const isInDrag = useCallback(
    (key: string) => {
      if (!dragRange) return false;
      const lo = dragRange.start < dragRange.end ? dragRange.start : dragRange.end;
      const hi = dragRange.start < dragRange.end ? dragRange.end : dragRange.start;
      return key >= lo && key <= hi;
    },
    [dragRange]
  );

  const monthColor = MONTH_COLORS[month];

  return (
    <div className="border border-zinc-200 dark:border-zinc-700 rounded-sm p-2 bg-white dark:bg-zinc-800">
      <div className={`text-center text-xs font-bold mb-1 ${monthColor.text === "text-white" ? "text-zinc-700 dark:text-zinc-300" : ""}`}>
        <span className={`inline-block px-1.5 py-0.5 rounded-sm ${monthColor.bg} ${monthColor.text}`}>
          {month}월
        </span>
      </div>
      <div className="grid grid-cols-7 gap-px mb-0.5">
        {DAY_NAMES.map((day, i) => (
          <div
            key={day}
            className={`text-center text-[10px] font-medium ${
              i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-zinc-400"
            }`}
          >
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px">
        {days.map(({ date, inMonth }) => {
          const key = formatDateKey(date);
          const matchingMonth = getMatchingMonth(key);
          // 드래그 중인 셀은 시작 월의 색으로 미리보기
          const inDrag = isInDrag(key) && dragStartMonth === month;
          const color = matchingMonth !== null ? MONTH_COLORS[matchingMonth] : null;
          return (
            <button
              key={`${month}-${key}`}
              onMouseDown={(e) => {
                e.preventDefault();
                onMouseDown(key, month);
              }}
              onMouseEnter={() => onMouseEnter(key)}
              className={`h-5 text-[10px] font-medium rounded-sm transition-colors ${
                color
                  ? `${color.bg} ${color.text}`
                  : inDrag
                  ? "bg-blue-200 text-blue-800"
                  : inMonth
                  ? "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-700"
                  : "text-zinc-300 hover:bg-zinc-50 dark:text-zinc-600 dark:hover:bg-zinc-800/50"
              }`}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function SessionSettingsModal({
  isOpen,
  onClose,
  year: initialYear,
  subjects,
  initialSubject,
}: Props) {
  const [year, setYear] = useState(initialYear);
  const [category, setCategory] = useState(initialSubject);
  const { sessions, saveSession, deleteSession, refetch } =
    useSessionPeriods(year, category);

  // Firestore에서 일회성 마이그레이션 (서버 API 호출)
  const [migrating, setMigrating] = useState(false);
  const handleMigrateFromFirestore = async () => {
    if (!confirm("Firestore의 session_periods 전체를 Supabase로 복사합니다. eie는 english로 합쳐집니다. 계속?")) return;
    setMigrating(true);
    try {
      const res = await fetch("/api/admin/session-periods/migrate", {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      if (body.count === 0) {
        alert(body.message || "Firestore에 session_periods 데이터가 없습니다.");
        return;
      }
      const mergedCount = body.mergedCount || 0;
      alert(
        `${body.count}건 복사 완료` +
          (mergedCount > 0 ? ` (eie→english 병합으로 ${mergedCount}건 통합됨)` : "")
      );
      await refetch();
    } catch (e) {
      alert(`마이그레이션 실패: ${(e as Error).message}`);
    } finally {
      setMigrating(false);
    }
  };

  // 월별 편집 상태 — 연도/과목 조합별로 localStorage에 영속화
  const [editingStore, setEditingStore] = useLocalStorage<
    Record<string, Record<number, DateRange[]>>
  >("sessionSettings.editing", {});
  const storeKey = `${year}.${category}`;
  const editingRanges = useMemo<Record<number, DateRange[]>>(
    () => editingStore[storeKey] || {},
    [editingStore, storeKey]
  );
  const setEditingRanges = useCallback(
    (
      updater:
        | Record<number, DateRange[]>
        | ((prev: Record<number, DateRange[]>) => Record<number, DateRange[]>)
    ) => {
      setEditingStore((prev) => {
        const curr = prev[storeKey] || {};
        const next = typeof updater === "function" ? updater(curr) : updater;
        return { ...prev, [storeKey]: next };
      });
    },
    [setEditingStore, storeKey]
  );
  const prevKeyRef = useRef("");

  // 세션 데이터 → 편집 상태로 동기화 (localStorage가 비어있을 때만)
  useEffect(() => {
    const key = `${storeKey}::${JSON.stringify(
      sessions.map((s) => ({ m: s.month, r: s.ranges }))
    )}`;
    if (key === prevKeyRef.current) return;
    prevKeyRef.current = key;

    // 해당 year/category 의 localStorage 값이 이미 있으면 덮어쓰지 않음
    if (Object.keys(editingStore[storeKey] || {}).length > 0) return;

    const map: Record<number, DateRange[]> = {};
    sessions.forEach((s) => {
      map[s.month] = s.ranges || [];
    });
    setEditingRanges(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, storeKey]);

  // 드래그
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState<string | null>(null);
  const [dragEnd, setDragEnd] = useState<string | null>(null);
  // 드래그가 시작된 월 — 전체 범위가 이 월의 세션으로 저장됨
  const [dragStartMonth, setDragStartMonth] = useState<number | null>(null);

  const dragRange = useMemo(() => {
    if (!dragging || !dragStart || !dragEnd) return null;
    return { start: dragStart, end: dragEnd };
  }, [dragging, dragStart, dragEnd]);

  const handleMouseDown = (key: string, sourceMonth: number) => {
    setDragging(true);
    setDragStart(key);
    setDragEnd(key);
    setDragStartMonth(sourceMonth);
  };
  const handleMouseEnter = (key: string) => {
    if (dragging) setDragEnd(key);
  };
  const handleMouseUp = () => {
    if (dragging && dragStart && dragEnd && dragStartMonth !== null) {
      const lo = dragStart < dragEnd ? dragStart : dragEnd;
      const hi = dragStart < dragEnd ? dragEnd : dragStart;

      // 드래그 시작 월에 전체 범위를 통째로 저장 (쪼개지 않음)
      setEditingRanges((prev) => {
        const next = { ...prev };
        const existing = next[dragStartMonth] || [];
        next[dragStartMonth] = mergeOverlappingRanges([
          ...existing,
          { startDate: lo, endDate: hi },
        ]);
        return next;
      });
    }
    setDragging(false);
    setDragStart(null);
    setDragEnd(null);
    setDragStartMonth(null);
  };

  const handleClearMonth = (month: number) => {
    setEditingRanges((prev) => {
      const next = { ...prev };
      delete next[month];
      return next;
    });
  };

  const handleClearAll = () => {
    if (confirm("모든 세션 범위를 삭제하시겠습니까?")) {
      setEditingRanges({});
    }
  };

  const [saving, setSaving] = useState(false);
  const handleSave = async () => {
    setSaving(true);
    try {
      const touchedIds = new Set<string>();
      for (const m of MONTHS) {
        const ranges = editingRanges[m];
        if (ranges && ranges.length > 0) {
          const id = `${year}-${category}-${m}`;
          touchedIds.add(id);
          await saveSession({
            id,
            year,
            category,
            month: m,
            ranges,
            sessions: 12,
          } as SessionPeriod);
        }
      }
      // 기존에 있었지만 이제 비어있는 월은 삭제
      for (const existing of sessions) {
        if (!touchedIds.has(existing.id)) {
          const ranges = editingRanges[existing.month];
          if (!ranges || ranges.length === 0) {
            await deleteSession(existing.id);
          }
        }
      }
      alert("저장되었습니다.");
    } catch (e) {
      alert(`저장 실패: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const configuredMonths = useMemo(
    () => MONTHS.filter((m) => (editingRanges[m] || []).length > 0),
    [editingRanges]
  );


  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div
        className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900">
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
            세션 설정
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleMigrateFromFirestore}
              disabled={migrating}
              className="rounded-sm border border-emerald-400 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:bg-zinc-100 disabled:text-zinc-400"
              title="ijw-calander Firestore의 세션을 Supabase로 일괄 복사"
            >
              {migrating ? "복사 중..." : "Firestore에서 가져오기"}
            </button>
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-zinc-600 text-xl leading-none"
            >
              ×
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4 select-none">
          {/* 연도/과목 선택 */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">연도</span>
              <button
                onClick={() => setYear((y) => y - 1)}
                className="rounded-sm border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700"
              >
                ◀
              </button>
              <span className="w-16 text-center text-sm font-bold">{year}년</span>
              <button
                onClick={() => setYear((y) => y + 1)}
                className="rounded-sm border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700"
              >
                ▶
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">과목</span>
              <div className="flex gap-1 flex-wrap">
                {subjects.map((s) => (
                  <button
                    key={s}
                    onClick={() => setCategory(s)}
                    className={`rounded-sm px-2.5 py-1 text-xs font-medium ${
                      category === s
                        ? "bg-blue-600 text-white"
                        : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400"
                    }`}
                  >
                    {toSubjectLabel(s)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 12개월 달력 */}
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            달력에서 드래그하여 세션 기간을 지정하세요 (여러 범위 가능)
          </div>
          <div className="grid grid-cols-4 gap-2">
            {MONTHS.map((m) => (
              <MiniCalendar
                key={m}
                year={year}
                month={m}
                rangesByMonth={editingRanges}
                dragRange={dragRange}
                dragStartMonth={dragStartMonth}
                onMouseDown={handleMouseDown}
                onMouseEnter={handleMouseEnter}
              />
            ))}
          </div>

          {/* 설정 요약 */}
          <div className="border border-zinc-200 dark:border-zinc-700 p-3 rounded-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-zinc-600 dark:text-zinc-300">
                설정된 세션 ({configuredMonths.length}개월)
              </span>
              {configuredMonths.length > 0 && (
                <button
                  onClick={handleClearAll}
                  className="text-xs text-red-500 hover:text-red-600"
                >
                  전체 삭제
                </button>
              )}
            </div>
            {configuredMonths.length === 0 ? (
              <div className="text-xs text-zinc-400">설정된 세션이 없습니다.</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {configuredMonths.map((m) => {
                  const ranges = editingRanges[m] || [];
                  const rangeStr = ranges
                    .map((r) => {
                      const s = parseDateKey(r.startDate);
                      const e = parseDateKey(r.endDate);
                      return `${s.getDate()}~${e.getDate()}`;
                    })
                    .join(", ");
                  return (
                    <div
                      key={m}
                      className="inline-flex items-center gap-1 rounded px-2 py-1 bg-blue-100 border border-blue-200 text-xs text-blue-700 dark:bg-blue-950 dark:border-blue-800 dark:text-blue-300"
                    >
                      <span className="font-bold">{m}월</span>
                      <span>({rangeStr})</span>
                      <button
                        onClick={() => handleClearMonth(m)}
                        className="text-blue-400 hover:text-red-500 ml-1"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 저장 */}
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="rounded-sm border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"
            >
              닫기
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-sm bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-zinc-300"
            >
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
