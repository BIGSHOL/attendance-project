"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
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
 */
export function useMonthlySettlement(year: number, month: number) {
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const supabaseRef = useRef(createClient());

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabaseRef.current
      .from("monthly_settlements")
      .select("*")
      .eq("year", year)
      .eq("month", month);

    if (!error && data) {
      setSettlements(data as SettlementRow[]);
    }
    setLoading(false);
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
