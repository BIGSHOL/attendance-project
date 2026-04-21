"use client";

import { useEffect, useRef, useState } from "react";
import { toSubjectLabel } from "@/lib/labelMap";
import type { Teacher } from "@/types";

interface Props {
  teachers: Teacher[];
  hiddenTeacherIds: Set<string>;
  onToggle: (teacherId: string) => void;
  hideUnassigned: boolean;
  onToggleUnassigned: () => void;
}

/**
 * 상담 탭 우측 상단 설정 팝오버
 *   - 담임 목록에 표시할 선생님을 체크박스로 관리
 *   - 관리자 이상만 노출 (부모 컴포넌트에서 제어)
 *   - 숨김 상태는 useHiddenTeachers (localStorage) 와 공유
 */
export default function ConsultationSettings({
  teachers,
  hiddenTeacherIds,
  onToggle,
  hideUnassigned,
  onToggleUnassigned,
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

  // 이름 가나다 정렬
  const sorted = [...teachers].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const visibleCount = teachers.length - hiddenTeacherIds.size;

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-sm border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
        aria-label="설정"
        title="표시할 담임 설정 (관리자)"
      >
        <svg
          className="h-3.5 w-3.5"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
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
          className="fixed z-[100] flex max-h-[min(560px,calc(100vh-120px))] w-[280px] flex-col border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        >
          <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
            <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
              담임 목록 표시 설정
            </span>
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
              {visibleCount} / {teachers.length}명
            </span>
          </div>
          <div className="border-b border-zinc-100 bg-amber-50 px-3 py-1.5 text-[10px] text-amber-800 dark:border-zinc-800 dark:bg-amber-950/30 dark:text-amber-300">
            체크 해제한 선생님은 상담 탭에서 숨겨집니다
            <br />
            (출석부 숨김 설정과 공유)
          </div>

          {/* 전역 옵션 — 과목 미지정 섹션 숨김 */}
          <label className="flex cursor-pointer items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-medium dark:border-zinc-800 dark:bg-zinc-950">
            <input
              type="checkbox"
              checked={hideUnassigned}
              onChange={onToggleUnassigned}
              className="h-3.5 w-3.5 rounded-sm border-zinc-300 text-blue-600 focus:ring-0 dark:border-zinc-600"
            />
            <span className="flex-1 text-zinc-800 dark:text-zinc-200">
              과목 미지정 선생님 전부 숨김
            </span>
          </label>

          <div className="flex-1 overflow-y-auto">
            {sorted.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-zinc-500">
                선생님 목록이 비었습니다
              </div>
            )}
            {sorted.map((t) => {
              const hidden = hiddenTeacherIds.has(t.id);
              return (
                <label
                  key={t.id}
                  className="flex cursor-pointer items-center gap-2 border-b border-zinc-100 px-3 py-1.5 text-xs hover:bg-zinc-50 last:border-b-0 dark:border-zinc-800 dark:hover:bg-zinc-800"
                >
                  <input
                    type="checkbox"
                    checked={!hidden}
                    onChange={() => onToggle(t.id)}
                    className="h-3.5 w-3.5 rounded-sm border-zinc-300 text-blue-600 focus:ring-0 dark:border-zinc-600"
                  />
                  <span
                    className={`flex-1 ${
                      hidden
                        ? "text-zinc-400 line-through dark:text-zinc-500"
                        : "text-zinc-900 dark:text-zinc-100"
                    }`}
                  >
                    {t.name}
                  </span>
                  {t.subjects && t.subjects.length > 0 && (
                    <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
                      {t.subjects.map(toSubjectLabel).join("/")}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
