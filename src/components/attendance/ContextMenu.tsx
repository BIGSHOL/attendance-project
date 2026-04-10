"use client";

import { useEffect, useRef, useState } from "react";
import { CELL_COLORS } from "@/types";

type Mode = "menu" | "memo" | "color" | "custom";

interface Props {
  x: number;
  y: number;
  currentValue?: number | null;
  currentMemo?: string;
  currentColor?: string;
  canCustomValue?: boolean; // 관리자 이상만 커스텀 숫자 입력 가능
  onSelectValue: (value: number | null) => void;
  onSaveMemo: (memo: string) => void;
  onSelectColor: (color: string | null) => void;
  onClose: () => void;
}

const ATTENDANCE_VALUES = [
  { label: "1", value: 1 },
  { label: "0.5", value: 0.5 },
  { label: "1.5", value: 1.5 },
  { label: "2", value: 2 },
  { label: "2.5", value: 2.5 },
  { label: "3", value: 3 },
  { label: "결석", value: 0 },
  { label: "초기화", value: null },
];

export default function ContextMenu({
  x,
  y,
  currentValue,
  currentMemo,
  currentColor,
  canCustomValue,
  onSelectValue,
  onSaveMemo,
  onSelectColor,
  onClose,
}: Props) {
  const [mode, setMode] = useState<Mode>("menu");
  const [memo, setMemo] = useState(currentMemo || "");
  const [customInput, setCustomInput] = useState(
    currentValue !== null && currentValue !== undefined ? String(currentValue) : ""
  );
  const menuRef = useRef<HTMLDivElement>(null);
  const memoRef = useRef<HTMLTextAreaElement>(null);
  const customRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === "memo") memoRef.current?.focus();
    if (mode === "custom") customRef.current?.focus();
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
          <div className="grid grid-cols-4 gap-1 p-1">
            {ATTENDANCE_VALUES.map((item) => (
              <button
                key={String(item.value)}
                onClick={() => { onSelectValue(item.value); onClose(); }}
                className={`rounded px-1.5 py-1 text-xs font-medium transition-colors ${
                  item.value === 0
                    ? "bg-red-100 text-red-700 hover:bg-red-200"
                    : item.value === null
                    ? "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
                    : "bg-zinc-50 text-zinc-700 hover:bg-zinc-100"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="border-t border-zinc-100 mt-1 pt-1 space-y-0.5">
            {canCustomValue && (
              <button
                onClick={() => setMode("custom")}
                className="w-full rounded px-2 py-1.5 text-left text-xs text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-700"
              >
                커스텀 값 입력
                <span className="ml-1 text-[10px] text-zinc-400">(관리자)</span>
              </button>
            )}
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
                  className="ml-1 inline-block w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: currentColor }}
                />
              )}
            </button>
          </div>
        </div>
      )}

      {mode === "custom" && (
        <div className="p-2">
          <p className="text-xs font-medium text-zinc-500 mb-1">커스텀 숫자 값</p>
          <input
            ref={customRef}
            type="number"
            step="0.1"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const n = Number(customInput);
                if (!isNaN(n) && customInput.trim() !== "") {
                  onSelectValue(n);
                  onClose();
                }
              }
            }}
            className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-200"
            placeholder="예: 4, 0.25, 1.75 (Enter로 저장)"
          />
          <p className="mt-1 text-[10px] text-zinc-400">
            기본 버튼에 없는 값도 입력 가능합니다
          </p>
          <div className="flex gap-1 mt-2">
            <button
              onClick={() => setMode("menu")}
              className="flex-1 rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-200"
            >
              뒤로
            </button>
            <button
              onClick={() => {
                const n = Number(customInput);
                if (!isNaN(n) && customInput.trim() !== "") {
                  onSelectValue(n);
                  onClose();
                }
              }}
              className="flex-1 rounded bg-blue-500 px-2 py-1 text-xs text-white hover:bg-blue-600"
            >
              저장
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
