"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import type { AttendanceRow } from "./useAttendanceData";

/**
 * 특정 연도의 모든 출석 데이터 조회 (hours > 0 인 것만)
 * 서버 /api/attendance/yearly 엔드포인트를 경유해 RLS 우회(dev bypass) 호환.
 */
export function useYearlyAttendance(year: number) {
  const [records, setRecords] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.fetch(`/api/attendance/yearly?year=${year}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as AttendanceRow[];
        setRecords(data || []);
      } else {
        setRecords([]);
      }
    } catch {
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // 선생님 id → distinct student_id Set
  const activeStudentsByTeacher = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const r of records) {
      if (!r.hours || r.hours <= 0) continue;
      if (!map.has(r.teacher_id)) map.set(r.teacher_id, new Set());
      map.get(r.teacher_id)!.add(r.student_id);
    }
    return map;
  }, [records]);

  return { records, loading, activeStudentsByTeacher, refetch: fetchAll };
}
