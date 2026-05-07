"use client";

import { useState } from "react";
import { useSalaryConfig } from "@/hooks/useSalaryConfig";
import SalarySettingsModal from "@/components/attendance/SalarySettingsModal";
import type { SalaryConfig } from "@/types";
import { calculateClassRate } from "@/lib/salary";

/**
 * 급여 설정 편집 페이지 (audit #7).
 *   tier 단가/비율, 학원 수수료, 인센티브 표시 + "편집" 버튼으로 모달 열기.
 *   모든 변경은 audit_logs 자동 기록.
 */
export default function SalaryConfigEditorPage() {
  const { config, save, loading, saving, error } = useSalaryConfig();
  const [editorOpen, setEditorOpen] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const handleSave = async (next: SalaryConfig) => {
    await save(next);
    setSavedAt(new Date());
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl">
        <div className="text-sm text-zinc-500">로딩 중...</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
          ⚙️ 급여 설정 편집
          <span className="ml-2 text-sm font-normal text-zinc-500">
            (마스터 전용)
          </span>
        </h2>
        <button
          type="button"
          onClick={() => setEditorOpen(true)}
          className="rounded-sm bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          ✏️ 편집
        </button>
      </div>

      {savedAt && (
        <div className="mb-3 rounded-sm border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          ✓ 저장 완료 — {savedAt.toLocaleTimeString("ko-KR")}. 변경 사항은 audit_logs 에 기록됨.
        </div>
      )}

      {error && (
        <div className="mb-3 rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          저장 실패: {error}
        </div>
      )}

      {/* 학원 수수료 + 인센티브 요약 */}
      <div className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard
          label="학원 수수료"
          value={`${config.academyFee}%`}
          hint="시트 N6 의 0.911 = 1 − 8.9%"
        />
        <SummaryCard
          label="블로그 인센티브"
          value={
            config.incentives?.blogType === "percentage"
              ? `${config.incentives.blogRate}% (비율)`
              : `${(config.incentives?.blogAmount || 0).toLocaleString()}원`
          }
        />
        <SummaryCard
          label="퇴원율 인센티브"
          value={`${(config.incentives?.retentionAmount || 0).toLocaleString()}원`}
          hint={`목표 ${config.incentives?.retentionTargetRate ?? 0}% 이하`}
        />
        <SummaryCard label="tier 수" value={`${(config.items || []).length}개`} />
      </div>

      {/* tier 표 */}
      <div className="mb-4 border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-bold text-zinc-700 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-300">
          📊 급여 항목 (tier)
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/30">
                <th className="px-3 py-2 text-left">이름</th>
                <th className="px-3 py-2 text-left">유형</th>
                <th className="px-3 py-2 text-right">기본 수업료</th>
                <th className="px-3 py-2 text-right">단가</th>
                <th className="px-3 py-2 text-right">비율</th>
                <th className="px-3 py-2 text-right">고정급</th>
                <th className="px-3 py-2 text-right">1회당 (계산)</th>
              </tr>
            </thead>
            <tbody>
              {(config.items || []).length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-6 text-center text-zinc-400"
                  >
                    설정된 tier 가 없습니다. "편집" 버튼으로 추가하세요.
                  </td>
                </tr>
              )}
              {(config.items || []).map((item, idx) => {
                const classRate = calculateClassRate(item, config.academyFee);
                return (
                  <tr
                    key={item.id || idx}
                    className="border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/30"
                  >
                    <td className="px-3 py-2">
                      <span
                        className="inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-xs font-semibold"
                        style={{
                          borderColor: item.color,
                          color: item.color,
                        }}
                      >
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        {item.name}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-500">
                      {item.type === "fixed" ? "고정급" : "비율제"}
                    </td>
                    <td className="px-3 py-2 text-right text-zinc-700 dark:text-zinc-300">
                      {item.baseTuition?.toLocaleString() || "-"}원
                    </td>
                    <td className="px-3 py-2 text-right text-zinc-700 dark:text-zinc-300">
                      {item.unitPrice?.toLocaleString() || "-"}원
                    </td>
                    <td className="px-3 py-2 text-right text-zinc-700 dark:text-zinc-300">
                      {item.type === "percentage" ? `${item.ratio}%` : "-"}
                    </td>
                    <td className="px-3 py-2 text-right text-zinc-700 dark:text-zinc-300">
                      {item.type === "fixed"
                        ? item.fixedRate?.toLocaleString() + "원"
                        : "-"}
                    </td>
                    <td className="px-3 py-2 text-right text-blue-700 dark:text-blue-300 font-semibold">
                      {classRate.toLocaleString()}원
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 선생님별 비율 오버라이드 */}
      {config.teacherRatios && Object.keys(config.teacherRatios).length > 0 && (
        <div className="mb-4 border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-bold text-zinc-700 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-300">
            👩‍🏫 선생님별 비율 오버라이드
            <span className="ml-2 text-xs font-normal text-zinc-500">
              (선생님 상세 페이지에서 편집 권장)
            </span>
          </div>
          <div className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">
            {Object.entries(config.teacherRatios).map(([teacher, ratios]) => (
              <div key={teacher} className="mb-1">
                <b className="text-zinc-800 dark:text-zinc-200">{teacher}</b>:{" "}
                {Object.entries(ratios)
                  .flatMap(([subject, groups]) =>
                    Object.entries(groups || {}).map(
                      ([group, r]) => `${subject} ${group} ${r}%`
                    )
                  )
                  .join(" · ")}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 안내 */}
      <div className="rounded-sm border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        ⚠️ 잘못 수정 시 모든 선생님 정산에 영향. 변경 전 백업 권장. 모든 변경은
        audit_logs 에 자동 기록되어 추적 가능.
      </div>

      {saving && (
        <div className="fixed bottom-4 right-4 rounded-sm bg-blue-600 px-3 py-2 text-xs text-white shadow-lg">
          저장 중...
        </div>
      )}

      <SalarySettingsModal
        isOpen={editorOpen}
        onClose={() => setEditorOpen(false)}
        config={config}
        onSave={handleSave}
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-0.5 text-base font-bold text-zinc-900 dark:text-zinc-100">
        {value}
      </p>
      {hint && (
        <p className="mt-0.5 text-[10px] text-zinc-400">{hint}</p>
      )}
    </div>
  );
}
