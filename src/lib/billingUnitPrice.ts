/**
 * 청구 → 단가 매칭 — 정산의 핵심 로직.
 *
 * ⚠ 변경 시 반드시 `billingUnitPrice.test.ts` 의 모든 테스트가 통과해야 함.
 *   잘못된 단가는 모든 강사의 시수/급여 계산을 어긋나게 함.
 *
 * 정책 (사용자 합의):
 *   1) 수업은 물리적으로 .5/.0 단위로만 진행됨.
 *   2) 청구액 ÷ 단가 가 .5 단위로 떨어지는 단가를 우선 선택 (자동 추론).
 *   3) 떨어지는 게 여러 개면 2T 우선 (담임/부담임 구분 없는 분반은 2T 가 기본).
 *   4) 자동 매칭 실패하면 2T → 3T → 첫 매칭 순서로 fallback.
 *   5) 어떤 단가로도 안 떨어질 때는 표시 단계에서 `.5` 단위로 반올림.
 */

import type { SalaryConfig, SalarySettingItem, SalarySubject } from "@/types";
import { classNameToGroup } from "./salary";

export interface PickUnitPriceArgs {
  /** billingName 또는 enrollment.className — 학년 prefix 추출용 */
  billingName: string;
  /** 청구액 (원). 0 이면 자동 추론 스킵 → fallback */
  paid: number;
  /** 과목 (math/english/other) — `subject + group` 으로 후보 필터 */
  subject: SalarySubject | undefined;
  /** salaryConfig.items 후보 풀 */
  config: SalaryConfig;
}

/**
 * 청구액·과목·분반 학년 정보로 가장 적합한 단가(SalarySettingItem)를 선택.
 *
 * @returns 매칭된 단가 항목, 또는 매칭 불가 시 undefined.
 */
export function pickBillingUnitPrice(
  args: PickUnitPriceArgs
): SalarySettingItem | undefined {
  const { billingName, paid, subject, config } = args;
  const group = classNameToGroup(billingName);
  if (!group || !subject) return undefined;

  const candidates = config.items.filter(
    (i) => i.subject === subject && i.group === group
  );
  if (candidates.length === 0) return undefined;

  // 1) 청구액 ÷ 단가 가 .5 단위로 떨어지는 후보 우선.
  if (paid > 0) {
    const fits = candidates.filter((c) => {
      if (c.baseTuition <= 0) return false;
      const sessions = paid / c.baseTuition;
      return Math.abs(sessions * 2 - Math.round(sessions * 2)) < 0.01;
    });
    if (fits.length > 0) {
      // 떨어지는 게 여러 개면 2T 우선
      const t2 = fits.find((c) => c.name.includes("2T"));
      if (t2) return t2;
      return fits[0];
    }
  }

  // 2) 자동 매칭 실패 — 2T → 3T → 첫 매칭
  const t2 = candidates.find((c) => c.name.includes("2T"));
  if (t2) return t2;
  const t3 = candidates.find((c) => c.name.includes("3T"));
  if (t3) return t3;
  return candidates[0];
}

/**
 * 예상시수 .5 단위 안전망.
 * 수업은 물리적으로 .5/.0 단위로만 진행되므로 .1, .2 등은 표시 금지.
 * 자동 단가 추론이 실패한 경우 (어떤 단가로도 안 떨어짐) 가장 가까운 .5 로 반올림.
 *
 * @example
 *   roundToHalf(9.555) // → 9.5
 *   roundToHalf(10.117) // → 10
 *   roundToHalf(0.3) // → 0.5
 *   roundToHalf(0.2) // → 0
 */
export function roundToHalf(n: number): number {
  return Math.round(n * 2) / 2;
}
