"use client";

import { useEffect, useState, useCallback } from "react";

export interface PaymentSplitItem {
  teacher_staff_id: string;
  teacher_name: string;
  amount: number;
  role?: string;
}

export interface PaymentSplit {
  id: string;
  billing_month: string;
  student_name: string;
  student_school: string;
  billing_name: string;
  original_amount: number;
  splits: PaymentSplitItem[];
  created_at: string;
  updated_at: string;
  created_by?: string;
  updated_by?: string;
}

/**
 * 특정 월의 수납 분배 데이터 로드 + refetch.
 * 수납 페이지 / 정산 시수 검증에서 공용으로 사용.
 */
export function usePaymentSplits(month: string | null) {
  const [splits, setSplits] = useState<PaymentSplit[]>([]);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    if (!month) {
      setSplits([]);
      return;
    }
    setLoading(true);
    try {
      const res = await window.fetch(
        `/api/payment-splits?month=${month}`,
        { cache: "no-store" }
      );
      if (res.ok) {
        const data = (await res.json()) as PaymentSplit[];
        setSplits(data || []);
      } else {
        setSplits([]);
      }
    } catch {
      setSplits([]);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { splits, loading, refetch: fetch };
}

/**
 * splits 배열을 (billing 자연키) → split 으로 변환.
 *   key = `${billing_month}|${student_name}|${student_school}|${billing_name}`
 */
export function buildSplitMap(splits: PaymentSplit[]): Map<string, PaymentSplit> {
  const map = new Map<string, PaymentSplit>();
  for (const s of splits) {
    const key = `${s.billing_month}|${s.student_name}|${s.student_school}|${s.billing_name}`;
    map.set(key, s);
  }
  return map;
}
