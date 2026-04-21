"use client";

import { useEffect, useRef, useState } from "react";

export interface HomeroomOption {
  name: string;
  subject: string;       // "수학" | "영어" | "수학/영어" (복수) | "" (미지정)
  studentCount: number;
}

interface Props {
  homerooms: HomeroomOption[];
  selected: string;      // ALL_VALUE 또는 담임명
  onChange: (v: string) => void;
  allValue?: string;     // 전체 담임 식별 문자열 (기본: "__all__")
  allLabel?: string;     // "전체 담임" / "전체 선생님" 등 (기본: "전체 담임")
  showAll?: boolean;     // 전체 옵션 노출 여부 (기본: true)
  placeholder?: string;  // 선택 없을 때 트리거 텍스트 (기본: "선택 안 됨")
}

// 단일 과목 뱃지 색상
const SUBJECT_COLOR: Record<string, { bg: string; text: string }> = {
  수학: {
    bg: "bg-blue-100 dark:bg-blue-950/60",
    text: "text-blue-700 dark:text-blue-300",
  },
  영어: {
    bg: "bg-emerald-100 dark:bg-emerald-950/60",
    text: "text-emerald-700 dark:text-emerald-300",
  },
  국어: {
    bg: "bg-rose-100 dark:bg-rose-950/60",
    text: "text-rose-700 dark:text-rose-300",
  },
  과학: {
    bg: "bg-purple-100 dark:bg-purple-950/60",
    text: "text-purple-700 dark:text-purple-300",
  },
  고등수학: {
    bg: "bg-indigo-100 dark:bg-indigo-950/60",
    text: "text-indigo-700 dark:text-indigo-300",
  },
  사회: {
    bg: "bg-orange-100 dark:bg-orange-950/60",
    text: "text-orange-700 dark:text-orange-300",
  },
};

const MULTI_COLOR = {
  bg: "bg-amber-100 dark:bg-amber-950/60",
  text: "text-amber-700 dark:text-amber-300",
};

const NONE_COLOR = {
  bg: "bg-zinc-100 dark:bg-zinc-800",
  text: "text-zinc-600 dark:text-zinc-400",
};

const SUBJECT_ORDER = ["수학", "영어", "국어", "과학", "고등수학", "사회"];

function getSubjectColor(label: string) {
  return SUBJECT_COLOR[label] ?? NONE_COLOR;
}

function groupBySubject(homerooms: HomeroomOption[]) {
  const map = new Map<string, HomeroomOption[]>();
  for (const h of homerooms) {
    let key: string;
    if (!h.subject) key = "__none__";
    else if (h.subject.includes("/")) key = "__multi__";
    else key = h.subject;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(h);
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
    teachers: map.get(key)!.sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

export default function HomeroomPicker({
  homerooms,
  selected,
  onChange,
  allValue = "__all__",
  allLabel = "전체 담임",
  showAll = true,
  placeholder = "선택 안 됨",
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  // fixed 팝오버 위치 (viewport 기준)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const isAll = selected === allValue;
  const sections = groupBySubject(homerooms);
  const totalStudents = homerooms.reduce((sum, h) => sum + h.studentCount, 0);
  const selectedHr = !isAll ? homerooms.find((h) => h.name === selected) : undefined;

  // 팝오버 위치 계산 (버튼 하단 오른쪽 정렬)
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

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      {/* 트리거 버튼 */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-w-[200px] items-center justify-between gap-2 rounded-sm border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-bold text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
      >
        <span className="flex items-center gap-1.5 truncate">
          {isAll && showAll ? (
            <>
              <span>{allLabel}</span>
              <span className="font-normal text-zinc-500 dark:text-zinc-400">
                · {homerooms.length}명
              </span>
            </>
          ) : selectedHr ? (
            <>
              <span>{selectedHr.name}</span>
              {selectedHr.subject && (
                <span
                  className={`inline-block rounded-sm px-1.5 py-0.5 text-[9px] font-bold leading-none ${getSubjectColor(selectedHr.subject).bg} ${getSubjectColor(selectedHr.subject).text}`}
                >
                  {selectedHr.subject}
                </span>
              )}
              <span className="font-normal text-zinc-500 dark:text-zinc-400">
                · {selectedHr.studentCount}명
              </span>
            </>
          ) : (
            <span className="text-zinc-400">{selected || placeholder}</span>
          )}
        </span>
        <svg
          className={`h-3 w-3 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.22 7.22a.75.75 0 011.06 0L10 10.94l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 8.28a.75.75 0 010-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {/* 팝오버 — viewport fixed. 부모의 overflow/stacking에 갇히지 않도록 */}
      {open && pos && (
        <div
          ref={popoverRef}
          style={{ top: pos.top, right: pos.right }}
          className="fixed z-[100] flex max-h-[min(560px,calc(100vh-120px))] w-[320px] flex-col border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        >
          {/* 전체 담임 (옵션) */}
          {showAll && (
            <button
              type="button"
              onClick={() => pick(allValue)}
              className={`flex w-full flex-shrink-0 items-center justify-between border-b border-zinc-100 px-3 py-2 text-xs font-bold dark:border-zinc-800 ${
                isAll
                  ? "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
                  : "text-zinc-900 hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              <span className="flex items-center gap-1.5">
                {isAll && (
                  <CheckIcon className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                )}
                {allLabel}
              </span>
              <span className="font-normal text-zinc-500 dark:text-zinc-400">
                {homerooms.length}명 · 학생 {totalStudents}명
              </span>
            </button>
          )}

          {/* 과목별 섹션 */}
          <div className="flex-1 overflow-y-auto">
            {sections.map((section) => {
              const color =
                section.key === "__multi__"
                  ? MULTI_COLOR
                  : section.key === "__none__"
                    ? NONE_COLOR
                    : getSubjectColor(section.label);
              return (
                <div key={section.key}>
                  <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-zinc-200 bg-zinc-100/95 px-3 py-1.5 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/95">
                    <span
                      className={`inline-block rounded-sm px-1.5 py-0.5 text-[10px] font-bold leading-none ${color.bg} ${color.text}`}
                    >
                      {section.label}
                    </span>
                    <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
                      담임 {section.teachers.length}명
                    </span>
                  </div>
                  {section.teachers.map((t) => {
                    const isSelected = selected === t.name;
                    return (
                      <button
                        key={t.name}
                        type="button"
                        onClick={() => pick(t.name)}
                        className={`flex w-full items-center justify-between border-b border-zinc-100 px-3 py-1.5 text-xs transition-colors last:border-b-0 dark:border-zinc-800 ${
                          isSelected
                            ? "bg-blue-50 font-bold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
                            : "text-zinc-900 hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-800"
                        }`}
                      >
                        <span className="flex items-center gap-1.5">
                          {isSelected ? (
                            <CheckIcon className="h-3 w-3 flex-shrink-0 text-blue-600 dark:text-blue-400" />
                          ) : (
                            <span className="w-3" />
                          )}
                          <span>{t.name}</span>
                          {section.key === "__multi__" && (
                            <span className="text-[9px] text-zinc-400">({t.subject})</span>
                          )}
                        </span>
                        <span className="text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
                          {t.studentCount}명
                        </span>
                      </button>
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

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}
