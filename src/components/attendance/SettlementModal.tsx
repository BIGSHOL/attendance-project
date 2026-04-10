"use client";

import { useState, useEffect } from "react";
import type { MonthlySettlement, IncentiveConfig, SalaryConfig } from "@/types";
import { calculateBlogBonus, calculateRetentionBonus } from "@/lib/salary";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  monthStr: string; // "2026년 4월"
  baseSalary: number;
  droppedStudentRate: number;
  incentiveConfig: IncentiveConfig;
  salaryConfig: SalaryConfig;
  data: MonthlySettlement;
  onUpdate: (data: MonthlySettlement) => void;
}

export default function SettlementModal({
  isOpen,
  onClose,
  monthStr,
  baseSalary,
  droppedStudentRate,
  incentiveConfig,
  salaryConfig,
  data,
  onUpdate,
}: Props) {
  const [localData, setLocalData] = useState<MonthlySettlement>(data);

  useEffect(() => {
    setLocalData(data);
  }, [data]);

  if (!isOpen) return null;

  const blogBonus = calculateBlogBonus(incentiveConfig, localData.hasBlog, baseSalary);
  const retentionBonus = calculateRetentionBonus(incentiveConfig, localData.hasRetention);
  const finalTotal = baseSalary + blogBonus + retentionBonus + (localData.otherAmount || 0);

  const handleChange = (partial: Partial<MonthlySettlement>) => {
    const updated = { ...localData, ...partial };
    setLocalData(updated);
    onUpdate(updated);
  };

  const handleFinalize = () => {
    if (!confirm("정산을 확정하시겠습니까?\n확정 후에는 급여 설정이 변경되어도 이 달의 계산에 영향을 주지 않습니다.")) return;
    handleChange({
      isFinalized: true,
      finalizedAt: new Date().toISOString(),
      salaryConfig: { ...salaryConfig },
    });
  };

  const handleUnfinalize = () => {
    if (!confirm("정산 확정을 해제하시겠습니까?\n급여 설정 변경 시 이 달의 계산도 변경됩니다.")) return;
    handleChange({
      isFinalized: false,
      finalizedAt: undefined,
      salaryConfig: undefined,
    });
  };

  const retentionMet = droppedStudentRate <= incentiveConfig.retentionTargetRate;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-700">
          <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
            정산 — {monthStr}
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {/* 정산 정보 */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500">기본 수업료</span>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {baseSalary.toLocaleString()}원
              </span>
            </div>
            <div className="flex justify-between text-sm font-bold">
              <span className="text-blue-600">총 지급액</span>
              <span className="text-blue-600">{finalTotal.toLocaleString()}원</span>
            </div>
          </div>

          <hr className="border-zinc-100 dark:border-zinc-800" />

          {/* 지급 내역 */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-zinc-500">지급 내역</h3>

            {/* 블로그 인센티브 */}
            <label className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={localData.hasBlog}
                  onChange={(e) => handleChange({ hasBlog: e.target.checked })}
                  className="rounded border-zinc-300"
                />
                <span className="text-sm text-zinc-700 dark:text-zinc-300">블로그 포스팅</span>
              </div>
              <span className="text-sm text-zinc-500">
                {incentiveConfig.blogType === "percentage"
                  ? `+${incentiveConfig.blogRate}%`
                  : `+${incentiveConfig.blogAmount.toLocaleString()}원`}
              </span>
            </label>

            {/* 퇴원율 달성 수당 */}
            <label className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={localData.hasRetention}
                  onChange={(e) => handleChange({ hasRetention: e.target.checked })}
                  className="rounded border-zinc-300"
                />
                <span className="text-sm text-zinc-700 dark:text-zinc-300">퇴원율 달성</span>
                <span className={`text-[10px] rounded px-1 py-0.5 ${
                  retentionMet
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-red-100 text-red-700"
                }`}>
                  {droppedStudentRate.toFixed(1)}% / 목표 {incentiveConfig.retentionTargetRate}%
                </span>
              </div>
              <span className="text-sm text-zinc-500">
                +{incentiveConfig.retentionAmount.toLocaleString()}원
              </span>
            </label>

            {/* 기타 인센티브 */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-700 dark:text-zinc-300">기타 인센티브</span>
                <input
                  type="number"
                  value={localData.otherAmount || ""}
                  onChange={(e) => handleChange({ otherAmount: Number(e.target.value) || 0 })}
                  placeholder="0"
                  className="w-28 rounded border border-zinc-300 px-2 py-1 text-right text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
                />
              </div>
              <input
                type="text"
                value={localData.note || ""}
                onChange={(e) => handleChange({ note: e.target.value })}
                placeholder="사유 입력"
                className="w-full rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
              />
            </div>
          </div>

          <hr className="border-zinc-100 dark:border-zinc-800" />

          {/* 이력 */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-zinc-500">이력</h3>
            {localData.isFinalized ? (
              <div className="rounded-sm bg-emerald-50 p-3 dark:bg-emerald-950">
                <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
                  <span>🔒</span> 정산 확정됨
                </div>
                {localData.finalizedAt && (
                  <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                    {new Date(localData.finalizedAt).toLocaleString("ko-KR")}
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-sm bg-amber-50 p-3 dark:bg-amber-950">
                <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300">
                  <span>⚠️</span> 미확정
                </div>
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                  급여 설정 변경 시 이 달의 계산도 변경됩니다.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* 하단 액션 */}
        <div className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-700">
          {localData.isFinalized ? (
            <button
              onClick={handleUnfinalize}
              className="rounded-sm border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100"
            >
              확정 해제
            </button>
          ) : (
            <button
              onClick={handleFinalize}
              className="rounded-sm bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              정산 확정하기
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded-sm border border-zinc-300 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
