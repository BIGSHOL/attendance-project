/**
 * 단가 매칭 — 정산의 핵심 로직. 회귀 차단용 테스트 하네스.
 *
 * 실패 시 `pickBillingUnitPrice` 정책을 변경한 의도가 명확하지 않으면 머지 금지.
 */

import { describe, it, expect } from "vitest";
import { pickBillingUnitPrice, roundToHalf } from "./billingUnitPrice";
import { INITIAL_SALARY_CONFIG } from "@/types";

const config = INITIAL_SALARY_CONFIG;

describe("pickBillingUnitPrice — 청구액 자동 추론", () => {
  it("85,000원 ÷ 21,250 = 4.0 → 초등 3T(21,250) 선택", () => {
    // 류다인 초등M 개별 JJ2I — 김은정 4시간
    const item = pickBillingUnitPrice({
      billingName: "초등M 개별 JJ2I 수",
      paid: 85000,
      subject: "math",
      config,
    });
    expect(item?.baseTuition).toBe(21250);
  });

  it("288,000원 ÷ 24,000 = 12.0 → 중등 3T(24,000) 선택", () => {
    // 류다인 중등M 초6 MS2B — 김화영 12회
    const item = pickBillingUnitPrice({
      billingName: "중등M 초6 MS2B 월목",
      paid: 288000,
      subject: "math",
      config,
    });
    expect(item?.baseTuition).toBe(24000);
  });

  it("216,000원 ÷ 24,000 = 9.0 → 중등 3T(24,000) 선택 (분리 케이스)", () => {
    // 류다인 분리 후 김화영 담임분
    const item = pickBillingUnitPrice({
      billingName: "중등M 초6 MS2B 월목",
      paid: 216000,
      subject: "math",
      config,
    });
    expect(item?.baseTuition).toBe(24000);
  });

  it("72,000원 ÷ 24,000 = 3.0 → 중등 3T(24,000) 선택 (부담임 분리분)", () => {
    // 류다인 분리 후 김은정 부담임분
    const item = pickBillingUnitPrice({
      billingName: "중등M 초6 MS2B 월목",
      paid: 72000,
      subject: "math",
      config,
    });
    expect(item?.baseTuition).toBe(24000);
  });

  it("45,000원 ÷ 22,500 = 2.0 → 초등 2T(22,500) 선택 (3T 21,250 으로는 2.117 안 떨어짐)", () => {
    const item = pickBillingUnitPrice({
      billingName: "초등M 무엇반",
      paid: 45000,
      subject: "math",
      config,
    });
    expect(item?.baseTuition).toBe(22500);
  });
});

describe("pickBillingUnitPrice — 자동 추론 실패 시 fallback", () => {
  it("215,000원 — 모든 초등 단가에서 .5 단위 안 떨어짐 → 2T fallback (22,500)", () => {
    // 215,000/21,250 = 10.117 ❌, 215,000/22,500 = 9.555 ❌
    const item = pickBillingUnitPrice({
      billingName: "초등M 무엇반",
      paid: 215000,
      subject: "math",
      config,
    });
    expect(item?.name).toContain("2T");
    expect(item?.baseTuition).toBe(22500);
  });

  it("paid=0 이면 자동 추론 스킵 → 2T fallback", () => {
    const item = pickBillingUnitPrice({
      billingName: "중등M",
      paid: 0,
      subject: "math",
      config,
    });
    expect(item?.name).toContain("2T");
  });
});

describe("pickBillingUnitPrice — 매칭 불가", () => {
  it("학년 prefix 추출 안 되면 undefined", () => {
    const item = pickBillingUnitPrice({
      billingName: "정체불명 청구",
      paid: 100000,
      subject: "math",
      config,
    });
    expect(item).toBeUndefined();
  });

  it("subject undefined 면 undefined", () => {
    const item = pickBillingUnitPrice({
      billingName: "초등M",
      paid: 100000,
      subject: undefined,
      config,
    });
    expect(item).toBeUndefined();
  });
});

describe("pickBillingUnitPrice — 영어/기타 과목", () => {
  it("영어 청구는 영어 단가 풀에서 매칭", () => {
    // 중등 영어 단가 12,000 — 144,000 / 12,000 = 12.0
    const item = pickBillingUnitPrice({
      billingName: "중등E_중1 정규 A Sarah 월수금",
      paid: 144000,
      subject: "english",
      config,
    });
    expect(item?.subject).toBe("english");
    expect(item?.baseTuition).toBe(12000);
  });

  it("EiE 초등 영어 → english 초등 단가", () => {
    // EIE 파닉스 6,250 — 31,250 / 6,250 = 5.0
    const item = pickBillingUnitPrice({
      billingName: "[EiE] 파닉스 A",
      paid: 31250,
      subject: "english",
      config,
    });
    expect(item?.subject).toBe("english");
    expect(item?.group).toBe("초등");
  });
});

describe("roundToHalf", () => {
  it("0.1 → 0", () => expect(roundToHalf(0.1)).toBe(0));
  it("0.25 → 0.5", () => expect(roundToHalf(0.25)).toBe(0.5));
  it("0.3 → 0.5", () => expect(roundToHalf(0.3)).toBe(0.5));
  it("0.5 → 0.5", () => expect(roundToHalf(0.5)).toBe(0.5));
  it("0.7 → 0.5", () => expect(roundToHalf(0.7)).toBe(0.5));
  it("0.75 → 1.0 (banker's rounding 영향 가능)", () => {
    // Math.round 는 .5 를 위로 올림 — 0.75 * 2 = 1.5 → round → 2 → / 2 = 1.0
    expect(roundToHalf(0.75)).toBe(1);
  });
  it("0.8 → 1.0", () => expect(roundToHalf(0.8)).toBe(1));
  it("9.555 → 9.5", () => expect(roundToHalf(9.555)).toBe(9.5));
  it("10.117 → 10.0", () => expect(roundToHalf(10.117)).toBe(10));
  it("12.0 → 12.0 (이미 .0)", () => expect(roundToHalf(12.0)).toBe(12));
  it("4.5 → 4.5 (이미 .5)", () => expect(roundToHalf(4.5)).toBe(4.5));
});
