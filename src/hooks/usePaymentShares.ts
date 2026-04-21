"use client";

import { useEffect, useState, useCallback } from "react";
import { cachedFetch, getCached, invalidateCache } from "@/lib/fetchCache";

/**
 * payment_shares row — 강사별 학생 수납 귀속.
 * 영어 선생님의 "이 학생이 나에게 얼마 귀속되는가" 를 표현.
 */
export interface PaymentShare {
  id: string;
  student_id: string;
  month: string;            // "YYYY-MM"
  teacher_staff_id: string;
  class_name: string;
  allocated_charge: number; // 이 강사 귀속 청구액
  allocated_paid: number;   // 이 강사 귀속 실납입액
  allocated_units: number | null;
  unit_price: number | null;
  source: string | null;
  debug_note: string | null;
  is_manual: boolean;
  created_at?: string;
  updated_at?: string;
}

/**
 * 특정 선생님 × 월 의 payment_shares 조회.
 * SWR: 모듈 캐시에 있으면 즉시 반환, 백그라운드 revalidate → 선생님 전환 깜빡임 제거.
 */
export function usePaymentShares(teacherStaffId: string, year: number, month: number) {
  const monthStr = `${year}-${String(month).padStart(2, "0")}`;
  const url = teacherStaffId
    ? `/api/payment-shares?${new URLSearchParams({ teacher_id: teacherStaffId, month: monthStr })}`
    : null;

  const initial = url ? getCached<PaymentShare[]>(url) : undefined;
  const [shares, setShares] = useState<PaymentShare[]>(initial ?? []);
  const [loading, setLoading] = useState(!initial && !!teacherStaffId);

  const fetchShares = useCallback(async () => {
    if (!url) {
      setShares([]);
      setLoading(false);
      return;
    }
    const hasCached = !!getCached<PaymentShare[]>(url);
    if (!hasCached) setLoading(true);
    try {
      const data = await cachedFetch<PaymentShare[]>(url);
      if (Array.isArray(data)) setShares(data);
    } catch {
      // 기존 값 유지
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    fetchShares();
  }, [fetchShares]);

  const refetch = useCallback(async () => {
    if (url) invalidateCache(url);
    await fetchShares();
  }, [url, fetchShares]);

  return { shares, loading, refetch };
}
