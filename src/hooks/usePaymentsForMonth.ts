"use client";

import { useEffect, useState } from "react";
import type { PaymentLite } from "@/lib/studentPaymentMatcher";
import { cachedFetch, getCached } from "@/lib/fetchCache";

/**
 * billing_month 가 해당 연월에 매칭되는지 확인.
 * DB에 저장된 포맷이 YYYYMM / YYYY-MM / YYYY.MM / YYYY/MM 중 무엇이든 대응.
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
 * SWR: 모듈 캐시에 있으면 즉시 반환하고 백그라운드 revalidate → 월 전환 시 깜빡임 제거.
 */
export function usePaymentsForMonth(year: number, month: number) {
  const mm = String(month).padStart(2, "0");
  const yyyy = String(year);
  const candidates = `${yyyy}${mm},${yyyy}-${mm},${yyyy}/${mm},${yyyy}.${mm}`;
  const url = `/api/payments?months=${encodeURIComponent(candidates)}`;

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
