"use client";

import type { Student, SalaryConfig } from "@/types";
import {
  matchSalarySetting,
  getEffectiveRatio,
  calculateClassRate,
  applyBlogPenalty,
  subjectToSalarySubject,
} from "@/lib/salary";
import { formatDateKey } from "@/lib/date";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  student: Student | null;
  year: number;
  month: number;
  /** 출석부가 표시 중인 날짜들 (월별 또는 세션별) — monthTotal 집계 범위와 일치 */
  dates: Date[];
  /** 과목 — 단위(영어=U, 그 외=T) 결정 */
  subject?: string;
  salaryConfig: SalaryConfig;
  /** 시트 F열 tier 오버라이드 — student.id → salary_item_id */
  tierOverrideId?: string;
  /** 선생님 이름 — getEffectiveRatio 의 teacherRatios 오버라이드 lookup 용 */
  teacherName?: string;
  /** 등록차수 — payment.charge_amount ÷ unit_price */
  termCount?: number;
  /** 이번 달 학생 수납 합계 (담당 선생님·과목 한정) */
  paidAmount?: number;
  /** 실급여 = calculateStudentSalary 결과 (이미 계산된 값) */
  actualSalary?: number;
  /** 블로그 패널티 적용 여부 (이 선생님 기준) */
  blogPenalty?: boolean;
  /** 학생 단가 오버라이드 (영어 payment_shares.unit_price 등) */
  unitPriceOverride?: number;
}

/**
 * 학생 정산 breakdown 모달 — 시트 N6 수식의 단계별 시각화 (audit #6).
 *
 * 시트 공식: `=MIN(L6, M6) * 0.911 * 비율계산(F6, B$1)`
 *   - L6 = 등록차수 × 단가 (납입금 가정)
 *   - M6 = 출석시수 × 단가
 *   - 0.911 = 1 − 학원수수료 8.9%
 *   - 비율계산() = tier 비율 (선생님 오버라이드 반영)
 *
 * 앱 등가: calculateStudentSalary(settingItem, academyFee, classUnits, paidAmount, blogPenalty, unitPriceOverride)
 */
export default function StudentBreakdownModal({
  isOpen,
  onClose,
  student,
  year,
  month,
  dates,
  subject,
  salaryConfig,
  tierOverrideId,
  teacherName,
  termCount,
  paidAmount,
  actualSalary,
  blogPenalty,
  unitPriceOverride,
}: Props) {
  if (!isOpen || !student) return null;

  // 단계 1 — tier 매칭
  const settingItem = matchSalarySetting(
    student,
    salaryConfig,
    subjectToSalarySubject(subject),
    tierOverrideId
  );
  const tierName = settingItem?.name ?? "(매칭 실패)";
  const baseTuition = settingItem?.baseTuition ?? 0;
  const tierUnitPrice =
    settingItem?.unitPrice && settingItem.unitPrice > 0
      ? settingItem.unitPrice
      : baseTuition;
  const effectiveUnitPrice =
    unitPriceOverride && unitPriceOverride > 0
      ? unitPriceOverride
      : tierUnitPrice;

  // 단계 2 — 출석 시수 (이 월·세션 범위)
  const monthTotal = dates.reduce((sum, d) => {
    const key = formatDateKey(d);
    const v = student.attendance?.[key] ?? 0;
    return sum + (v > 0 ? v : 0);
  }, 0);

  // 단계 3 — 등록차수 (charge ÷ 단가) — 부모에서 계산된 값 사용
  const term = termCount ?? null;

  // 단계 4 — 정산 시수 = min(출석, 등록)
  const billableUnits =
    typeof term === "number" && term > 0 ? Math.min(monthTotal, term) : monthTotal;

  // 단계 5 — 1회당 선생님 몫
  const academyFee = salaryConfig.academyFee;
  const baseRatio = settingItem
    ? getEffectiveRatio(settingItem, salaryConfig, teacherName)
    : 0;
  const effectiveRatio = applyBlogPenalty(baseRatio, !!blogPenalty);
  const classRate = settingItem
    ? calculateClassRate(settingItem, academyFee, effectiveRatio)
    : 0;

  // 단계 6 — 학생 정산
  // 모달은 이미 계산된 actualSalary 가 있으면 그것을 표시 (소수 정책 일치).
  // 없으면 step-by-step 으로 추정.
  const computedSalary =
    typeof actualSalary === "number" && Number.isFinite(actualSalary)
      ? actualSalary
      : Math.floor(billableUnits * classRate);

  // 영어 단위 vs 일반 단위
  const unit: "U" | "T" = subject === "english" ? "U" : "T";

  // 시트 수식 표기
  const formulaN6 = `MIN(${monthTotal.toFixed(1)}${unit}, ${
    term !== null ? term.toFixed(1) + unit : "—"
  }) × ${effectiveUnitPrice.toLocaleString()}원 × ${(
    1 -
    academyFee / 100
  ).toFixed(3)} × ${effectiveRatio}%`;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
          <div>
            <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              {student.name}
              <span className="ml-2 text-xs font-normal text-zinc-500">
                {year}년 {month}월 정산 breakdown
              </span>
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              {(student.school || "") + " " + (student.grade || "")}
              {student.group ? ` · ${student.group}` : ""}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-sm text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto px-4 py-3 text-sm">
          {!settingItem && (
            <div className="mb-3 rounded-sm border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              ⚠ tier 매칭 실패 — 정산 0. 학생 학년·시트 F열·salary_config 점검 필요.
            </div>
          )}

          {/* 단계별 카드 */}
          <ol className="space-y-2">
            <Step
              n={1}
              label="단가 매칭 (tier)"
              value={`${tierName} — ${effectiveUnitPrice.toLocaleString()}원`}
              hint={
                unitPriceOverride && unitPriceOverride !== tierUnitPrice
                  ? `tier 단가 ${tierUnitPrice.toLocaleString()} → 학생 오버라이드 ${unitPriceOverride.toLocaleString()}`
                  : undefined
              }
            />
            <Step
              n={2}
              label="출석 시수"
              value={`${monthTotal.toFixed(1)}${unit}`}
              hint={`이 월 ${dates.length}일 중 출석 합계`}
            />
            <Step
              n={3}
              label="등록차수"
              value={
                term !== null ? `${term.toFixed(1)}${unit}` : "수납 정보 없음"
              }
              hint={
                term !== null
                  ? `청구액 ÷ 단가 = ${term.toFixed(1)}${unit}` +
                    (typeof paidAmount === "number"
                      ? ` (이번달 수납 ${paidAmount.toLocaleString()}원)`
                      : "")
                  : "수납 매칭 안 됨 — 출석 그대로 정산"
              }
            />
            <Step
              n={4}
              label="정산 시수"
              value={`${billableUnits.toFixed(1)}${unit}`}
              hint={
                term !== null && term > 0
                  ? `min(출석 ${monthTotal.toFixed(1)}, 등록 ${term.toFixed(1)})`
                  : "출석 = 정산"
              }
              highlight={term !== null && monthTotal !== term}
            />
            <Step
              n={5}
              label="1회당 선생님 몫"
              value={`${classRate.toLocaleString()}원`}
              hint={
                settingItem?.type === "fixed"
                  ? `고정급 ${settingItem.fixedRate.toLocaleString()}원`
                  : `${effectiveUnitPrice.toLocaleString()} × (1 − ${academyFee}%) × ${effectiveRatio}%` +
                    (blogPenalty ? " (블로그 −2%)" : "") +
                    (baseRatio !== effectiveRatio
                      ? ` · 기본 ${baseRatio}%`
                      : "")
              }
            />
            <Step
              n={6}
              label="학생 정산 (실급여)"
              value={`${computedSalary.toLocaleString()}원`}
              hint={`정산시수 ${billableUnits.toFixed(1)}${unit} × ${classRate.toLocaleString()}원`}
              total
            />
          </ol>

          {/* 시트 N6 수식 */}
          <div className="mt-4 rounded-sm border border-zinc-200 bg-zinc-50 px-3 py-2 text-[11px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
            <div className="mb-0.5 font-mono font-bold text-zinc-700 dark:text-zinc-300">
              N6 ≡
            </div>
            <div className="font-mono">{formulaN6}</div>
            <div className="mt-1.5 text-zinc-500">
              ※ 시트 출석부의 N열 수식과 동일한 공식 — 1회당 단가 × 정산시수 ×
              수수료 × 비율.
            </div>
          </div>
        </div>

        {/* 푸터 */}
        <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-zinc-200 bg-zinc-50 px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950">
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

function Step({
  n,
  label,
  value,
  hint,
  highlight,
  total,
}: {
  n: number;
  label: string;
  value: string;
  hint?: string;
  highlight?: boolean;
  total?: boolean;
}) {
  const ringCls = total
    ? "border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950"
    : highlight
      ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950"
      : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950";
  const valueCls = total
    ? "text-blue-700 dark:text-blue-300 text-base font-bold"
    : "text-zinc-900 dark:text-zinc-100 font-semibold";
  return (
    <li
      className={`flex items-start gap-3 rounded-sm border px-3 py-2 ${ringCls}`}
    >
      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[11px] font-bold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
        {n}
      </span>
      <div className="flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {label}
          </span>
          <span className={valueCls}>{value}</span>
        </div>
        {hint && (
          <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            {hint}
          </div>
        )}
      </div>
    </li>
  );
}
