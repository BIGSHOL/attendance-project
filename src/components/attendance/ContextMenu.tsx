"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CELL_COLORS } from "@/types";

type Mode = "menu" | "memo" | "color";

interface Props {
  x: number;
  y: number;
  currentMemo?: string;
  currentColor?: string;
  onSaveMemo: (memo: string) => void;
  onSelectColor: (color: string | null) => void;
  onClose: () => void;
  /**
   * 자주 쓰이는 메모 (빈도 desc) — 자동완성 추천용 (audit J).
   *   현재 입력 substring 으로 필터, 매칭되는 것 우선.
   */
  memoSuggestions?: string[];
}

export default function ContextMenu({
  x,
  y,
  currentMemo,
  currentColor,
  onSaveMemo,
  onSelectColor,
  onClose,
  memoSuggestions,
}: Props) {
  const [mode, setMode] = useState<Mode>("menu");
  const [memo, setMemo] = useState(currentMemo || "");
  const menuRef = useRef<HTMLDivElement>(null);
  const memoRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (mode === "memo") memoRef.current?.focus();
  }, [mode]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  // 화면 밖으로 나가지 않도록 위치 조정
  const style: React.CSSProperties = {
    position: "fixed",
    left: Math.min(x, window.innerWidth - 200),
    top: Math.min(y, window.innerHeight - 300),
    zIndex: 50,
  };

  return (
    <div ref={menuRef} style={style} className="w-48 rounded-sm border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
      {mode === "menu" && (
        <div className="p-1">
          <div className="px-2 py-1 text-[10px] text-zinc-400 border-b border-zinc-100">
            숫자 값은 셀 클릭 후 키보드(0~9·소수점)로 입력
          </div>
          <div className="space-y-0.5 mt-1">
            <button
              onClick={() => setMode("memo")}
              className="w-full rounded px-2 py-1.5 text-left text-xs text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              메모/사유
              {currentMemo && <span className="ml-1 text-amber-500">●</span>}
            </button>
            <button
              onClick={() => setMode("color")}
              className="w-full rounded px-2 py-1.5 text-left text-xs text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              색상
              {currentColor && (
                <span
                  className="ml-1 inline-block w-2.5 h-2.5 rounded-sm"
                  style={{ backgroundColor: currentColor }}
                />
              )}
            </button>
          </div>
        </div>
      )}

      {mode === "memo" && (
        <div className="p-2">
          <p className="text-xs font-medium text-zinc-500 mb-1">메모/사유</p>
          <textarea
            ref={memoRef}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSaveMemo(memo);
                onClose();
              }
            }}
            className="w-full rounded border border-zinc-300 p-1.5 text-xs resize-none h-16 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-200"
            placeholder="사유를 입력하세요 (Enter로 저장)"
          />
          {/* 자동완성 추천 (audit J) — 입력 substring 매칭 또는 빈 입력 시 빈도순 top */}
          <MemoSuggestions
            input={memo}
            suggestions={memoSuggestions || []}
            onPick={(s) => {
              setMemo(s);
              memoRef.current?.focus();
            }}
          />
          <div className="flex gap-1 mt-1">
            <button
              onClick={() => setMode("menu")}
              className="flex-1 rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-200"
            >
              뒤로
            </button>
            <button
              onClick={() => { onSaveMemo(memo); onClose(); }}
              className="flex-1 rounded bg-blue-500 px-2 py-1 text-xs text-white hover:bg-blue-600"
            >
              저장
            </button>
          </div>
        </div>
      )}

      {mode === "color" && (
        <div className="p-2">
          <p className="text-xs font-medium text-zinc-500 mb-1">셀 색상</p>
          <div className="grid grid-cols-5 gap-1">
            {CELL_COLORS.map((c) => (
              <button
                key={c.key}
                onClick={() => { onSelectColor(c.hex); onClose(); }}
                title={c.label}
                className={`w-7 h-7 rounded border-2 transition-transform hover:scale-110 ${
                  currentColor === c.hex ? "border-zinc-800 dark:border-white" : "border-transparent"
                }`}
                style={{ backgroundColor: c.hex }}
              />
            ))}
          </div>
          <button
            onClick={() => { onSelectColor(null); onClose(); }}
            className="w-full mt-1 rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-200"
          >
            초기화
          </button>
          <button
            onClick={() => setMode("menu")}
            className="w-full mt-1 rounded bg-zinc-50 px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100"
          >
            뒤로
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * 메모 자동완성 chip 리스트 (audit J).
 *   input 비어 있으면 빈도 top 5, 입력 있으면 substring 매칭 top 5.
 *   현재 입력값과 동일한 추천은 숨김 (자기 자신 제외).
 */
function MemoSuggestions({
  input,
  suggestions,
  onPick,
}: {
  input: string;
  suggestions: string[];
  onPick: (s: string) => void;
}) {
  const filtered = useMemo(() => {
    const q = input.trim().toLowerCase();
    let pool = suggestions;
    if (q) {
      pool = suggestions.filter(
        (s) => s.toLowerCase().includes(q) && s !== input
      );
    }
    return pool.slice(0, 5);
  }, [input, suggestions]);

  if (filtered.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {filtered.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onPick(s)}
          title={s}
          className="max-w-full truncate rounded-sm border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
        >
          {s.length > 16 ? s.slice(0, 16) + "…" : s}
        </button>
      ))}
    </div>
  );
}
