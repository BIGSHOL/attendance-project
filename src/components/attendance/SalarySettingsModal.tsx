"use client";

import { useState, useEffect } from "react";
import type { SalaryConfig, SalarySettingItem, SalaryType } from "@/types";
import { calculateClassRate, getBadgeStyle } from "@/lib/salary";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  config: SalaryConfig;
  onSave: (config: SalaryConfig) => void;
  readOnly?: boolean;
}

export default function SalarySettingsModal({ isOpen, onClose, config, onSave, readOnly = false }: Props) {
  const [local, setLocal] = useState<SalaryConfig>(config);

  useEffect(() => {
    setLocal(config);
  }, [config]);

  if (!isOpen) return null;

  const updateItem = (idx: number, partial: Partial<SalarySettingItem>) => {
    const items = [...local.items];
    items[idx] = { ...items[idx], ...partial };
    setLocal({ ...local, items });
  };

  const addItem = () => {
    const newItem: SalarySettingItem = {
      id: `custom-${Date.now()}`,
      name: "새 과정",
      color: "#6B7280",
      type: "percentage",
      fixedRate: 0,
      baseTuition: 100000,
      ratio: 45,
      unitPrice: 100000,
    };
    setLocal({ ...local, items: [...local.items, newItem] });
  };

  const removeItem = (idx: number) => {
    if (!confirm(`"${local.items[idx].name}" 과정을 삭제하시겠습니까?`)) return;
    setLocal({ ...local, items: local.items.filter((_, i) => i !== idx) });
  };

  const handleSave = () => {
    onSave(local);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg max-h-[80vh] overflow-y-auto rounded border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        {/* 헤더 */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white px-5 py-4 dark:border-zinc-700 dark:bg-zinc-900">
          <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
            급여 설정
          </h2>
          <button onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600">
            ✕
          </button>
        </div>

        <div className="space-y-5 px-5 py-4">
          {/* 수수료율 */}
          <div>
            <label className="text-xs font-semibold text-zinc-500">카드/행정 수수료 (%)</label>
            <input
              type="number"
              value={local.academyFee}
              onChange={(e) => setLocal({ ...local, academyFee: Number(e.target.value) })}
              step="0.1"
              disabled={readOnly}
              className="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm disabled:bg-zinc-100 disabled:text-zinc-500 disabled:cursor-not-allowed dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
            />
          </div>

          {/* 과정별 설정 */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-zinc-500">
                과정별 정산 설정
                {readOnly && <span className="ml-2 text-[10px] text-zinc-400">(읽기 전용)</span>}
              </h3>
              {!readOnly && (
                <button
                  onClick={addItem}
                  className="rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-200"
                >
                  + 추가
                </button>
              )}
            </div>

            {local.items.map((item, idx) => (
              <div key={item.id} className="rounded-sm border border-zinc-200 p-3 dark:border-zinc-700">
                <div className="flex items-center gap-2 mb-2">
                  <input
                    type="color"
                    value={item.color}
                    onChange={(e) => updateItem(idx, { color: e.target.value })}
                    disabled={readOnly}
                    className="w-6 h-6 rounded cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <input
                    type="text"
                    value={item.name}
                    onChange={(e) => updateItem(idx, { name: e.target.value })}
                    disabled={readOnly}
                    className="flex-1 rounded border border-zinc-300 px-2 py-1 text-sm font-medium disabled:bg-zinc-100 disabled:text-zinc-500 disabled:cursor-not-allowed dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
                  />
                  {!readOnly && (
                    <button
                      onClick={() => removeItem(idx)}
                      className="rounded p-1 text-xs text-red-400 hover:bg-red-50 hover:text-red-600"
                    >
                      삭제
                    </button>
                  )}
                </div>

                {/* 유형 선택 */}
                <div className="flex gap-2 mb-2">
                  <button
                    onClick={() => !readOnly && updateItem(idx, { type: "fixed" as SalaryType })}
                    disabled={readOnly}
                    className={`flex-1 rounded px-2 py-1.5 text-xs font-medium disabled:opacity-60 disabled:cursor-not-allowed ${
                      item.type === "fixed"
                        ? "bg-zinc-800 text-white"
                        : "bg-zinc-100 text-zinc-500"
                    }`}
                  >
                    고정급
                  </button>
                  <button
                    onClick={() => !readOnly && updateItem(idx, { type: "percentage" as SalaryType })}
                    disabled={readOnly}
                    className={`flex-1 rounded px-2 py-1.5 text-xs font-medium disabled:opacity-60 disabled:cursor-not-allowed ${
                      item.type === "percentage"
                        ? "bg-zinc-800 text-white"
                        : "bg-zinc-100 text-zinc-500"
                    }`}
                  >
                    비율제
                  </button>
                </div>

                {item.type === "fixed" ? (
                  <div className="space-y-1">
                    <label className="text-[10px] text-zinc-400">1회당 금액 (원)</label>
                    <input
                      type="number"
                      value={item.fixedRate}
                      onChange={(e) => updateItem(idx, { fixedRate: Number(e.target.value) })}
                      disabled={readOnly}
                      className="w-full rounded border border-zinc-300 px-2 py-1 text-sm disabled:bg-zinc-100 disabled:text-zinc-500 disabled:cursor-not-allowed dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-zinc-400">기본 수업료 (원)</label>
                      <input
                        type="number"
                        value={item.baseTuition}
                        onChange={(e) => updateItem(idx, { baseTuition: Number(e.target.value) })}
                        className="w-full rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-400">교사 비율 (%)</label>
                      <input
                        type="number"
                        value={item.ratio}
                        onChange={(e) => updateItem(idx, { ratio: Number(e.target.value) })}
                        className="w-full rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
                      />
                    </div>
                  </div>
                )}

                <div className="mt-1">
                  <label className="text-[10px] text-zinc-400">수업 단가 (원)</label>
                  <input
                    type="number"
                    value={item.unitPrice}
                    onChange={(e) => updateItem(idx, { unitPrice: Number(e.target.value) })}
                    disabled={readOnly}
                    className="w-full rounded border border-zinc-300 px-2 py-1 text-sm disabled:bg-zinc-100 disabled:text-zinc-500 disabled:cursor-not-allowed dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
                  />
                </div>

                {/* 계산 미리보기 */}
                <div className="mt-2 rounded bg-zinc-50 px-2 py-1 text-[10px] text-zinc-500 dark:bg-zinc-800">
                  1회 수업료 = <span className="font-bold text-zinc-700 dark:text-zinc-300">
                    {calculateClassRate(item, local.academyFee).toLocaleString()}원
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* 인센티브 설정 */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-zinc-500">인센티브 설정</h3>

            <div className="rounded-sm border border-zinc-200 p-3 dark:border-zinc-700">
              <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">블로그 포스팅</p>
              <div className="flex gap-2 mb-2">
                <button
                  onClick={() => !readOnly && setLocal({ ...local, incentives: { ...local.incentives, blogType: "fixed" } })}
                  disabled={readOnly}
                  className={`flex-1 rounded px-2 py-1 text-xs disabled:opacity-60 disabled:cursor-not-allowed ${
                    local.incentives.blogType === "fixed" ? "bg-zinc-800 text-white" : "bg-zinc-100 text-zinc-500"
                  }`}
                >
                  고정금
                </button>
                <button
                  onClick={() => !readOnly && setLocal({ ...local, incentives: { ...local.incentives, blogType: "percentage" } })}
                  disabled={readOnly}
                  className={`flex-1 rounded px-2 py-1 text-xs disabled:opacity-60 disabled:cursor-not-allowed ${
                    local.incentives.blogType === "percentage" ? "bg-zinc-800 text-white" : "bg-zinc-100 text-zinc-500"
                  }`}
                >
                  비율
                </button>
              </div>
              {local.incentives.blogType === "fixed" ? (
                <input
                  type="number"
                  value={local.incentives.blogAmount}
                  onChange={(e) => setLocal({ ...local, incentives: { ...local.incentives, blogAmount: Number(e.target.value) } })}
                  className="w-full rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
                  placeholder="금액 (원)"
                />
              ) : (
                <input
                  type="number"
                  value={local.incentives.blogRate}
                  onChange={(e) => setLocal({ ...local, incentives: { ...local.incentives, blogRate: Number(e.target.value) } })}
                  step="0.1"
                  className="w-full rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
                  placeholder="비율 (%)"
                />
              )}
            </div>

            <div className="rounded-sm border border-zinc-200 p-3 dark:border-zinc-700">
              <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">퇴원율 달성 수당</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-zinc-400">지급 금액 (원)</label>
                  <input
                    type="number"
                    value={local.incentives.retentionAmount}
                    onChange={(e) => setLocal({ ...local, incentives: { ...local.incentives, retentionAmount: Number(e.target.value) } })}
                    disabled={readOnly}
                    className="w-full rounded border border-zinc-300 px-2 py-1 text-sm disabled:bg-zinc-100 disabled:text-zinc-500 disabled:cursor-not-allowed dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-zinc-400">목표 퇴원율 (%)</label>
                  <input
                    type="number"
                    value={local.incentives.retentionTargetRate}
                    onChange={(e) => setLocal({ ...local, incentives: { ...local.incentives, retentionTargetRate: Number(e.target.value) } })}
                    step="0.1"
                    disabled={readOnly}
                    className="w-full rounded border border-zinc-300 px-2 py-1 text-sm disabled:bg-zinc-100 disabled:text-zinc-500 disabled:cursor-not-allowed dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 하단 */}
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-zinc-200 bg-white px-5 py-3 dark:border-zinc-700 dark:bg-zinc-900">
          <button onClick={onClose} className="rounded-sm border border-zinc-300 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50">
            {readOnly ? "닫기" : "취소"}
          </button>
          {!readOnly && (
            <button onClick={handleSave} className="rounded-sm bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700">
              저장
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
