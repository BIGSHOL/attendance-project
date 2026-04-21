"use client";

import { useState, useRef, useEffect, useMemo } from "react";

interface Props {
  values: string[];
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
  sortKey: string | null;
  sortDir: "asc" | "desc";
  onSort: (dir: "asc" | "desc") => void;
  children: React.ReactNode;
  align?: "left" | "right";
}

export default function ColumnFilter({
  values,
  selected,
  onChange,
  sortKey,
  sortDir,
  onSort,
  children,
  align = "left",
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const uniqueValues = useMemo(() => {
    const sorted = [...values].sort((a, b) => a.localeCompare(b, "ko"));
    return sorted;
  }, [values]);

  const filteredValues = useMemo(() => {
    if (!search.trim()) return uniqueValues;
    const q = search.trim().toLowerCase();
    return uniqueValues.filter((v) => v.toLowerCase().includes(q));
  }, [uniqueValues, search]);

  const NONE_SENTINEL = "\0__NONE__\0";
  const isCleared = selected.size === 1 && selected.has(NONE_SENTINEL);
  const hasFilter = isCleared || (selected.size > 0 && selected.size < uniqueValues.length);

  const selectAll = () => onChange(new Set());
  const clearAll = () => onChange(new Set([NONE_SENTINEL]));

  const toggleValue = (v: string) => {
    const base = isCleared ? new Set<string>() : selected.size === 0 ? new Set(uniqueValues) : new Set(selected);
    if (base.has(v)) {
      base.delete(v);
      if (base.size === 0) {
        onChange(new Set([NONE_SENTINEL]));
        return;
      }
    } else {
      base.add(v);
      if (base.size === uniqueValues.length) {
        onChange(new Set());
        return;
      }
    }
    onChange(base);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1 px-3 py-2 font-medium select-none whitespace-nowrap hover:text-zinc-700 dark:hover:text-zinc-300 ${align === "right" ? "justify-end w-full" : ""} ${hasFilter ? "text-blue-600 dark:text-blue-400" : "text-zinc-500"}`}
      >
        {children}
        <span className="text-[10px] ml-0.5">{sortKey !== null ? (sortDir === "asc" ? "▲" : "▼") : "▼"}</span>
        {hasFilter && <span className="w-1.5 h-1.5 rounded-sm bg-blue-500 ml-0.5" />}
      </button>

      {open && (
        <div
          className={`absolute top-full mt-1 z-50 w-64 rounded-sm border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800 ${align === "right" ? "right-0" : "left-0"}`}
        >
          {/* 정렬 */}
          <div className="border-b border-zinc-300 dark:border-zinc-700 p-1">
            <button
              onClick={() => { onSort("asc"); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300"
            >
              정렬: 오름차순
            </button>
            <button
              onClick={() => { onSort("desc"); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300"
            >
              정렬: 내림차순
            </button>
          </div>

          {/* 값별 필터링 */}
          <div className="p-2">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs space-x-2">
                <button
                  onClick={selectAll}
                  className="text-blue-600 hover:text-blue-800 dark:text-blue-400"
                >
                  전체 선택
                </button>
                <span className="text-zinc-300 dark:text-zinc-600">·</span>
                <button
                  onClick={clearAll}
                  className="text-blue-600 hover:text-blue-800 dark:text-blue-400"
                >
                  선택 해제
                </button>
              </div>
              <span className="text-xs text-zinc-400">
                {isCleared ? 0 : hasFilter ? selected.size : uniqueValues.length}개 표시 중
              </span>
            </div>
            <input
              type="text"
              placeholder="검색"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded border border-zinc-300 px-2 py-1 text-sm mb-2 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100"
            />
            <div className="max-h-48 overflow-y-auto space-y-0.5">
              {filteredValues.map((v) => {
                const checked = selected.size === 0 || selected.has(v);
                return (
                  <label
                    key={v}
                    className="flex items-center gap-2 px-1 py-1 rounded text-sm hover:bg-zinc-50 dark:hover:bg-zinc-700 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleValue(v)}
                      className="rounded border-zinc-300"
                    />
                    <span className="text-zinc-700 dark:text-zinc-300 truncate">
                      {v || "(공백)"}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* 하단 */}
          <div className="border-t border-zinc-100 dark:border-zinc-700 p-2 flex justify-end gap-2">
            <button
              onClick={() => { onChange(new Set()); setOpen(false); }}
              className="px-3 py-1 text-sm text-zinc-500 hover:text-zinc-700 rounded"
            >
              초기화
            </button>
            <button
              onClick={() => { setOpen(false); setSearch(""); }}
              className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              확인
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
