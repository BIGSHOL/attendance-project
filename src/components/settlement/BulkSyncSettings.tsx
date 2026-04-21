"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toSubjectLabel } from "@/lib/labelMap";
import type { Teacher } from "@/types";

interface Props {
  teachers: Teacher[];
  excludedIds: Set<string>;
  onToggle: (teacherId: string) => void;
  onBulkToggle?: (teacherIds: string[], shouldExclude: boolean) => void;
}

// 과목별 뱃지 색상 — HomeroomPicker 와 동일 팔레트
const SUBJECT_COLOR: Record<string, { bg: string; text: string }> = {
  수학: { bg: "bg-blue-100 dark:bg-blue-950/60", text: "text-blue-700 dark:text-blue-300" },
  영어: { bg: "bg-emerald-100 dark:bg-emerald-950/60", text: "text-emerald-700 dark:text-emerald-300" },
  국어: { bg: "bg-rose-100 dark:bg-rose-950/60", text: "text-rose-700 dark:text-rose-300" },
  과학: { bg: "bg-purple-100 dark:bg-purple-950/60", text: "text-purple-700 dark:text-purple-300" },
  고등수학: { bg: "bg-indigo-100 dark:bg-indigo-950/60", text: "text-indigo-700 dark:text-indigo-300" },
  사회: { bg: "bg-orange-100 dark:bg-orange-950/60", text: "text-orange-700 dark:text-orange-300" },
};
const MULTI_COLOR = { bg: "bg-amber-100 dark:bg-amber-950/60", text: "text-amber-700 dark:text-amber-300" };
const NONE_COLOR = { bg: "bg-zinc-100 dark:bg-zinc-800", text: "text-zinc-600 dark:text-zinc-400" };
const SUBJECT_ORDER = ["수학", "영어", "국어", "과학", "고등수학", "사회"];

function getSubjectColor(label: string) {
  return SUBJECT_COLOR[label] ?? NONE_COLOR;
}

/** 선생님들을 과목별 섹션으로 그룹핑 */
function groupBySubject(teachers: Teacher[]) {
  const map = new Map<string, Teacher[]>();
  for (const t of teachers) {
    const labels = (t.subjects || []).map(toSubjectLabel).filter(Boolean);
    let key: string;
    if (labels.length === 0) key = "__none__";
    else if (labels.length > 1) key = "__multi__";
    else key = labels[0];
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(t);
  }
  const keys = Array.from(map.keys());
  keys.sort((a, b) => {
    if (a === "__none__") return 1;
    if (b === "__none__") return -1;
    if (a === "__multi__") return 1;
    if (b === "__multi__") return -1;
    const ai = SUBJECT_ORDER.indexOf(a);
    const bi = SUBJECT_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  return keys.map((key) => ({
    key,
    label: key === "__none__" ? "미지정" : key === "__multi__" ? "복수 과목" : key,
    teachers: map.get(key)!.sort((a, b) => a.name.localeCompare(b.name, "ko")),
  }));
}

/**
 * 정산 탭 "전체 동기화" 버튼 오른쪽 설정 팝오버
 *   - 시트 URL 등록된 선생님 중 동기화에서 제외할 사람을 체크박스로 관리
 *   - 과목별 섹션 그룹핑 (상담 탭의 HomeroomPicker 와 동일 디자인)
 *   - 섹션 헤더의 "전체 선택/해제" 로 과목 단위 일괄 토글
 */
export default function BulkSyncSettings({
  teachers,
  excludedIds,
  onToggle,
  onBulkToggle,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  const updatePosition = () => {
    const btn = buttonRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    setPos({
      top: r.bottom + 4,
      right: Math.max(8, window.innerWidth - r.right),
    });
  };

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    updatePosition();
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onScroll = () => updatePosition();
    document.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  const sections = useMemo(() => groupBySubject(teachers), [teachers]);
  const includedCount = teachers.length - excludedIds.size;

  // 섹션 단위 토글 — 섹션 내 모두 포함 상태면 전부 제외로, 아니면 전부 포함으로
  const toggleSection = (teacherIds: string[]) => {
    const allIncluded = teacherIds.every((id) => !excludedIds.has(id));
    if (onBulkToggle) {
      onBulkToggle(teacherIds, allIncluded);
      return;
    }
    // fallback — 개별 toggle 순차 호출
    for (const id of teacherIds) {
      const currentlyExcluded = excludedIds.has(id);
      if (allIncluded && !currentlyExcluded) onToggle(id);
      else if (!allIncluded && currentlyExcluded) onToggle(id);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-sm border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
        aria-label="동기화 설정"
        title="동기화 포함/제외 선생님 설정"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && pos && (
        <div
          ref={popoverRef}
          style={{ top: pos.top, right: pos.right }}
          className="fixed z-[100] flex max-h-[min(560px,calc(100vh-120px))] w-[300px] flex-col border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        >
          <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
            <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
              동기화 대상 선생님
            </span>
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
              {includedCount} / {teachers.length}명
            </span>
          </div>
          <div className="border-b border-zinc-100 bg-amber-50 px-3 py-1.5 text-[10px] text-amber-800 dark:border-zinc-800 dark:bg-amber-950/30 dark:text-amber-300">
            체크 해제한 선생님은 전체 동기화 시 제외됩니다
            <br />
            (시트 URL 등록된 선생님만 표시)
          </div>

          <div className="flex-1 overflow-y-auto">
            {sections.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-zinc-500">
                시트 URL 등록된 선생님이 없습니다
              </div>
            )}
            {sections.map((section) => {
              const color =
                section.key === "__multi__"
                  ? MULTI_COLOR
                  : section.key === "__none__"
                    ? NONE_COLOR
                    : getSubjectColor(section.label);
              const teacherIds = section.teachers.map((t) => t.id);
              const allIncluded = teacherIds.every((id) => !excludedIds.has(id));
              const sectionIncluded = teacherIds.filter((id) => !excludedIds.has(id)).length;
              return (
                <div key={section.key}>
                  {/* 섹션 헤더 — 과목 뱃지 + 일괄 토글 */}
                  <button
                    type="button"
                    onClick={() => toggleSection(teacherIds)}
                    className="sticky top-0 z-10 flex w-full cursor-pointer items-center gap-2 border-b border-zinc-200 bg-zinc-100/95 px-3 py-1.5 text-left backdrop-blur-sm hover:bg-zinc-200/80 dark:border-zinc-800 dark:bg-zinc-950/95 dark:hover:bg-zinc-800/80"
                    title={allIncluded ? `${section.label} 전체 제외` : `${section.label} 전체 포함`}
                  >
                    <span
                      className={`inline-block rounded-sm px-1.5 py-0.5 text-[10px] font-bold leading-none ${color.bg} ${color.text}`}
                    >
                      {section.label}
                    </span>
                    <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
                      {sectionIncluded} / {section.teachers.length}명
                    </span>
                    <span className="ml-auto text-[10px] font-medium text-blue-600 dark:text-blue-400">
                      {allIncluded ? "전체 해제" : "전체 선택"}
                    </span>
                  </button>
                  {/* 개별 체크박스 */}
                  {section.teachers.map((t) => {
                    const excluded = excludedIds.has(t.id);
                    return (
                      <label
                        key={t.id}
                        className="flex cursor-pointer items-center gap-2 border-b border-zinc-100 px-3 py-1.5 text-xs hover:bg-zinc-50 last:border-b-0 dark:border-zinc-800 dark:hover:bg-zinc-800"
                      >
                        <input
                          type="checkbox"
                          checked={!excluded}
                          onChange={() => onToggle(t.id)}
                          className="h-3.5 w-3.5 rounded-sm border-zinc-300 text-blue-600 focus:ring-0 dark:border-zinc-600"
                        />
                        <span
                          className={`flex-1 ${
                            excluded
                              ? "text-zinc-400 line-through dark:text-zinc-500"
                              : "text-zinc-900 dark:text-zinc-100"
                          }`}
                        >
                          {t.name}
                        </span>
                        {section.key === "__multi__" && t.subjects && (
                          <span className="text-[9px] text-zinc-400">
                            ({t.subjects.map(toSubjectLabel).join("/")})
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
