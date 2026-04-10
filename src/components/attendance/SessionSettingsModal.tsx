"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { SessionPeriod, DateRange } from "@/types";
import { useSessionPeriods } from "@/hooks/useSessionPeriods";
import { formatDateKey, getDaysInMonth } from "@/lib/date";
import { mergeOverlappingRanges, parseDateKey } from "@/lib/sessionUtils";
import { toSubjectLabel } from "@/lib/labelMap";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  year: number;
  subjects: string[];
  initialSubject: string;
}

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

function MiniCalendar({
  year,
  month,
  selectedRanges,
  dragRange,
  onMouseDown,
  onMouseEnter,
}: {
  year: number;
  month: number;
  selectedRanges: DateRange[];
  dragRange: { start: string; end: string } | null;
  onMouseDown: (dateKey: string) => void;
  onMouseEnter: (dateKey: string) => void;
}) {
  const days = useMemo(() => {
    const all = getDaysInMonth(year, month);
    const firstDay = new Date(year, month - 1, 1).getDay();
    const result: (Date | null)[] = [];
    for (let i = 0; i < firstDay; i++) result.push(null);
    all.forEach((d) => result.push(d));
    return result;
  }, [year, month]);

  const isSelected = useCallback(
    (key: string) => selectedRanges.some((r) => key >= r.startDate && key <= r.endDate),
    [selectedRanges]
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

  return (
    <div className="border border-zinc-200 dark:border-zinc-700 rounded-sm p-2 bg-white dark:bg-zinc-800">
      <div className="text-center text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1">
        {month}월
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
        {days.map((date, idx) => {
          if (!date) return <div key={`empty-${idx}`} className="h-5" />;
          const key = formatDateKey(date);
          const selected = isSelected(key);
          const inDrag = isInDrag(key);
          return (
            <button
              key={key}
              onMouseDown={(e) => {
                e.preventDefault();
                onMouseDown(key);
              }}
              onMouseEnter={() => onMouseEnter(key)}
              className={`h-5 text-[10px] font-medium rounded-sm transition-colors ${
                selected
                  ? "bg-blue-500 text-white"
                  : inDrag
                  ? "bg-blue-200 text-blue-800"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-700"
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

  // 월별 편집 상태
  const [editingRanges, setEditingRanges] = useState<Record<number, DateRange[]>>({});
  const prevKeyRef = useRef("");

  // 세션 데이터 → 편집 상태로 동기화
  useEffect(() => {
    const key = JSON.stringify(sessions.map((s) => ({ m: s.month, r: s.ranges })));
    if (key === prevKeyRef.current) return;
    prevKeyRef.current = key;

    const map: Record<number, DateRange[]> = {};
    sessions.forEach((s) => {
      map[s.month] = s.ranges || [];
    });
    setEditingRanges(map);
  }, [sessions]);

  // 드래그
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState<string | null>(null);
  const [dragEnd, setDragEnd] = useState<string | null>(null);

  const dragRange = useMemo(() => {
    if (!dragging || !dragStart || !dragEnd) return null;
    return { start: dragStart, end: dragEnd };
  }, [dragging, dragStart, dragEnd]);

  const handleMouseDown = (key: string) => {
    setDragging(true);
    setDragStart(key);
    setDragEnd(key);
  };
  const handleMouseEnter = (key: string) => {
    if (dragging) setDragEnd(key);
  };
  const handleMouseUp = () => {
    if (dragging && dragStart && dragEnd) {
      const lo = dragStart < dragEnd ? dragStart : dragEnd;
      const hi = dragStart < dragEnd ? dragEnd : dragStart;

      // 월별로 분리해서 추가
      const loMonth = parseInt(lo.slice(5, 7));
      const hiMonth = parseInt(hi.slice(5, 7));

      setEditingRanges((prev) => {
        const next = { ...prev };
        for (let m = loMonth; m <= hiMonth; m++) {
          const monthStart =
            m === loMonth ? lo : `${year}-${String(m).padStart(2, "0")}-01`;
          const lastDay = new Date(year, m, 0).getDate();
          const monthEnd =
            m === hiMonth ? hi : `${year}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
          const existing = next[m] || [];
          next[m] = mergeOverlappingRanges([
            ...existing,
            { startDate: monthStart, endDate: monthEnd },
          ]);
        }
        return next;
      });
    }
    setDragging(false);
    setDragStart(null);
    setDragEnd(null);
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
                selectedRanges={editingRanges[m] || []}
                dragRange={dragRange}
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
