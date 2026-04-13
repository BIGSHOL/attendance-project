"use client";

import { useEffect, useState } from "react";
import type { PaymentLite } from "@/lib/studentPaymentMatcher";

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
 * API 의 month 필터 하나로는 포맷 불일치(hypen/no-hypen 등) 케이스에 취약하므로
 * 가능한 포맷들을 순차 시도해서 첫 번째로 비어있지 않은 결과를 반환.
 */
export function usePaymentsForMonth(year: number, month: number) {
  const [payments, setPayments] = useState<PaymentLite[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const mm = String(month).padStart(2, "0");
    const yyyy = String(year);
    // 4가지 포맷을 한 번의 IN 쿼리로 처리 (이전엔 순차 RTT 4회)
    const candidates = [`${yyyy}${mm}`, `${yyyy}-${mm}`, `${yyyy}/${mm}`, `${yyyy}.${mm}`];

    (async () => {
      try {
        const res = await fetch(
          `/api/payments?months=${encodeURIComponent(candidates.join(","))}`
        );
        if (res.ok) {
          const body = await res.json();
          if (!cancelled && Array.isArray(body)) {
            setPayments(body as PaymentLite[]);
            return;
          }
        }
      } catch {
        // fallthrough to fallback
      }

      // fallback: 전체 로드 후 클라 필터
      try {
        const res = await fetch(`/api/payments`);
        if (res.ok) {
          const all = await res.json();
          if (Array.isArray(all)) {
            const filtered = (all as PaymentLite[]).filter((p) =>
              billingMonthMatches(p.billing_month, year, month)
            );
            if (!cancelled) setPayments(filtered);
            return;
          }
        }
      } catch {
        // 무시
      }

      if (!cancelled) setPayments([]);
    })()
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [year, month]);

  return { payments, loading };
}
