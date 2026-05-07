"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * 학생별 tier 오버라이드 조회 (모든 선생님 통합).
 *   학생 상세 페이지의 "수강 분반" 섹션이 호출.
 *
 * row 의 is_manual:
 *   - true  → 학생 상세 페이지에서 운영자가 직접 추가. 시트 sync 시 보호.
 *   - false → 시트 동기화 결과. 다음 sync 에서 갱신 가능.
 */
export interface TierOverrideRow {
  id: string;
  teacher_id: string;
  student_id: string;
  class_name: string;
  salary_item_id: string;
  tier_name: string;
  is_manual: boolean;
  updated_at?: string;
}

export function useTierOverridesByStudent(studentId: string | undefined) {
  const [rows, setRows] = useState<TierOverrideRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    if (!studentId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/attendance/tier-overrides?student_id=${encodeURIComponent(studentId)}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(Array.isArray(data) ? (data as TierOverrideRow[]) : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "로딩 실패");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  return { rows, loading, error, refetch: fetchRows };
}
