"use client";

import { useEffect, useRef, useState } from "react";
import type { CellSize } from "@/lib/cellSize";
import { CELL_SIZE_OPTIONS } from "@/lib/cellSize";

interface Props {
  /** 열 표시 토글 */
  showExpectedBilling: boolean;
  setShowExpectedBilling: (v: boolean) => void;
  showPaidAmount: boolean;
  setShowPaidAmount: (v: boolean) => void;
  showActualSalary: boolean;
  setShowActualSalary: (v: boolean) => void;
  /** 실급여 토글 비활성 — 급여제(fixed) 선생님일 때 사용 */
  actualSalaryDisabled?: boolean;
  actualSalaryDisabledReason?: string;

  /** 화면 옵션 */
  highlightWeekends: boolean;
  setHighlightWeekends: (v: boolean) => void;
  hideZeroAttendance: boolean;
  setHideZeroAttendance: (v: boolean) => void;

  /** 셀 크기 */
  cellWidth: CellSize;
  setCellWidth: (v: CellSize) => void;
  cellHeight: CellSize;
  setCellHeight: (v: CellSize) => void;
}

/**
 * 출석부 화면의 "보기" 옵션 팝오버 메뉴.
 * 열 표시(예정액/정산액/수납액) · 화면 옵션(주말/0출석) · 셀 크기(가로/세로) 를 한 버튼에 통합.
 */
export default function ViewOptionsMenu({
  showExpectedBilling,
  setShowExpectedBilling,
  showPaidAmount,
  setShowPaidAmount,
  showActualSalary,
  setShowActualSalary,
  actualSalaryDisabled = false,
  actualSalaryDisabledReason,
  highlightWeekends,
  setHighlightWeekends,
  hideZeroAttendance,
  setHideZeroAttendance,
  cellWidth,
  setCellWidth,
  cellHeight,
  setCellHeight,
}: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // 팝오버가 열릴 때 버튼 위치를 기준으로 좌표 계산 (overflow 부모 clip 회피용 fixed positioning)
  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const update = () => {
      const rect = btnRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPos({ top: rect.bottom + 4, left: rect.left });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  // 바깥 클릭 또는 ESC 로 닫기
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // 켜진 옵션 수 (뱃지 표시용) — 실급여가 비활성 상태면 카운트에서 제외
  const activeCount =
    Number(showExpectedBilling) +
    Number(showPaidAmount) +
    Number(showActualSalary && !actualSalaryDisabled) +
    Number(highlightWeekends) +
    Number(hideZeroAttendance);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-sm font-medium ${
          open
            ? "border-zinc-400 bg-zinc-100 text-zinc-900 dark:border-zinc-500 dark:bg-zinc-700 dark:text-zinc-100"
            : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-750"
        }`}
      >
        <span>보기</span>
        {activeCount > 0 && (
          <span className="rounded-sm bg-blue-500 px-1.5 text-[11px] font-bold text-white">
            {activeCount}
          </span>
        )}
        <span className="text-xs">{open ? "▴" : "▾"}</span>
      </button>

      {open && pos && (
        <div
          ref={popoverRef}
          style={{ position: "fixed", top: pos.top, left: pos.left }}
          className="z-[100] w-64 rounded-sm border border-zinc-300 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {/* 열 표시 */}
          <div className="mb-3">
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              열 표시
            </div>
            <div className="flex flex-col gap-1.5">
              <Toggle
                label="예정액"
                desc="수업 요일 × 단가"
                checked={showExpectedBilling}
                onChange={setShowExpectedBilling}
              />
              <Toggle
                label="수납액"
                desc="이번 달 실질 납부 합계"
                checked={showPaidAmount}
                onChange={setShowPaidAmount}
              />
              <Toggle
                label="실급여"
                desc={
                  actualSalaryDisabled
                    ? actualSalaryDisabledReason || "급여제 선생님은 실급여 계산 비활성"
                    : "실제 지급 예상 (수납/비율/패널티 반영)"
                }
                checked={showActualSalary && !actualSalaryDisabled}
                onChange={setShowActualSalary}
                disabled={actualSalaryDisabled}
              />
            </div>
          </div>

          {/* 화면 옵션 */}
          <div className="mb-3 border-t border-zinc-200 pt-3 dark:border-zinc-700">
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              화면
            </div>
            <div className="flex flex-col gap-1.5">
              <Toggle
                label="주말 회색"
                desc="주말 열 배경 회색"
                checked={highlightWeekends}
                onChange={setHighlightWeekends}
              />
              <Toggle
                label="0출석 숨김"
                desc="이번 달 출석 없는 학생 숨김"
                checked={hideZeroAttendance}
                onChange={setHideZeroAttendance}
              />
            </div>
          </div>

          {/* 셀 크기 */}
          <div className="border-t border-zinc-200 pt-3 dark:border-zinc-700">
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              셀 크기
            </div>
            <div className="flex flex-col gap-1.5">
              <SizeRow label="가로" value={cellWidth} onChange={setCellWidth} />
              <SizeRow label="세로" value={cellHeight} onChange={setCellHeight} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Toggle({
  label,
  desc,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-2 rounded-sm px-1 py-0.5 ${
        disabled
          ? "cursor-not-allowed opacity-50"
          : "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800"
      }`}
      title={disabled ? desc : undefined}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="mt-0.5 h-4 w-4 rounded border-zinc-300 disabled:cursor-not-allowed"
      />
      <div className="flex-1">
        <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
          {label}
        </div>
        {desc && (
          <div className="text-[11px] text-zinc-500 dark:text-zinc-500">{desc}</div>
        )}
      </div>
    </label>
  );
}

function SizeRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: CellSize;
  onChange: (v: CellSize) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 text-sm text-zinc-700 dark:text-zinc-300">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as CellSize)}
        className="flex-1 rounded-sm border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
      >
        {CELL_SIZE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
