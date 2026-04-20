"use client";

import { useEffect, useState, useMemo, useCallback } from "react";

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
 * 영어 선생님 AttendancePage 에서 기존 payments 대신 사용.
 */
export function usePaymentShares(teacherStaffId: string, year: number, month: number) {
  const [shares, setShares] = useState<PaymentShare[]>([]);
  const [loading, setLoading] = useState(true);

  const monthStr = useMemo(
    () => `${year}-${String(month).padStart(2, "0")}`,
    [year, month]
  );

  const fetchShares = useCallback(async () => {
    if (!teacherStaffId) {
      setShares([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({
        teacher_id: teacherStaffId,
        month: monthStr,
      });
      const res = await fetch(`/api/payment-shares?${params}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as PaymentShare[];
        setShares(data);
      } else {
        setShares([]);
      }
    } finally {
      setLoading(false);
    }
  }, [teacherStaffId, monthStr]);

  useEffect(() => {
    fetchShares();
  }, [fetchShares]);

  return { shares, loading, refetch: fetchShares };
}
