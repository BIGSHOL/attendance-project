"use client";

import { useEffect, useState } from "react";
import type { PaymentLite } from "@/lib/studentPaymentMatcher";
import { cachedFetch, getCached } from "@/lib/fetchCache";

/**
 * billing_month 가 해당 연월에 매칭되는지 확인.
 *
 * Firebase billing.month 는 `YYYY-MM` 단일 포맷. 과거 Supabase payments 시절의
 * 4종 포맷(`YYYYMM`/`YYYY-MM`/`YYYY/MM`/`YYYY.MM`) 호환은 그대로 유지 — 외부에서
 * 이 함수를 직접 쓰는 케이스(시트 import 등) 가 있을 수 있으므로.
 */
export function billingMonthMatches(raw: string, year: number, month: number): boolean {
  if (!raw) return false;
  const mm = String(month).padStart(2, "0");
  const yyyy = String(year);
  return (
    raw === `${yyyy}${mm}` ||
    raw === `${yyyy}-${mm}` ||
    raw === `${yyyy}/${mm}` ||
    raw === `${yyyy}.${mm}`
  );
}

/**
 * 특정 연월의 수납 내역을 모두 가져온다.
 *
 * 소스: Firebase Firestore `billing` collection (MakeEdu 매일 새벽 3시 자동 동기화).
 *   기본 카테고리 필터 = 수업/원복 (정산·시수 검증과 호환 — 교재/차량비 제외).
 *   `payments` 탭 같이 모든 청구가 필요한 화면은 `categories=all` 로 별도 호출.
 *
 * SWR: 모듈 캐시에 있으면 즉시 반환하고 백그라운드 revalidate → 월 전환 시 깜빡임 제거.
 */
export function usePaymentsForMonth(year: number, month: number) {
  const mm = String(month).padStart(2, "0");
  const yyyy = String(year);
  // Firebase billing.month 는 YYYY-MM 단일 포맷
  const url = `/api/billing?month=${yyyy}-${mm}`;

  const cached = getCached<PaymentLite[]>(url);
  const [payments, setPayments] = useState<PaymentLite[]>(cached ?? []);
  const [loading, setLoading] = useState(!cached);

  useEffect(() => {
    let cancelled = false;
    const hasCached = !!getCached<PaymentLite[]>(url);
    if (!hasCached) setLoading(true);

    (async () => {
      try {
        const data = await cachedFetch<PaymentLite[]>(url);
        if (!cancelled && Array.isArray(data)) {
          setPayments(data);
        }
      } catch {
        // 기존 값 유지
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url]);

  return { payments, loading };
}
