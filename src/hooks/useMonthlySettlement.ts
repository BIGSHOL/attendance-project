"use client";

import { useEffect, useState, useCallback } from "react";
import type { SalaryConfig, MonthlySettlement } from "@/types";

export interface SettlementRow {
  id: string;
  teacher_id: string;
  year: number;
  month: number;
  has_blog: boolean;
  has_retention: boolean;
  other_amount: number;
  note: string;
  is_finalized: boolean;
  finalized_at: string | null;
  salary_config: SalaryConfig | null;
}

/**
 * 특정 월의 모든 선생님 정산 데이터 조회
 * 서버 /api/settlements 엔드포인트를 경유해 RLS 우회(dev bypass) 호환.
 */
export function useMonthlySettlement(year: number, month: number) {
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.fetch(
        `/api/settlements?year=${year}&month=${month}`,
        { cache: "no-store" }
      );
      if (res.ok) {
        const data = (await res.json()) as SettlementRow[];
        setSettlements(data || []);
      } else {
        setSettlements([]);
      }
    } catch {
      setSettlements([]);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const getByTeacher = useCallback(
    (teacherId: string): MonthlySettlement => {
      const row = settlements.find((s) => s.teacher_id === teacherId);
      if (!row) {
        return { hasBlog: false, hasRetention: false, otherAmount: 0, note: "" };
      }
      return {
        hasBlog: row.has_blog,
        hasRetention: row.has_retention,
        otherAmount: Number(row.other_amount),
        note: row.note,
        isFinalized: row.is_finalized,
        finalizedAt: row.finalized_at || undefined,
        salaryConfig: row.salary_config || undefined,
      };
    },
    [settlements]
  );

  return { settlements, loading, getByTeacher, refetch: fetch };
}
