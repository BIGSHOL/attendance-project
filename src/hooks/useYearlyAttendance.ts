"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AttendanceRow } from "./useAttendanceData";

/**
 * 특정 연도의 모든 출석 데이터 조회 (hours > 0 인 것만 의미 있음)
 * - 선생님별 재원학생(distinct student_id) 집계에 사용
 */
export function useYearlyAttendance(year: number) {
  const [records, setRecords] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const supabaseRef = useRef(createClient());

  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabaseRef.current
      .from("attendance")
      .select("teacher_id, student_id, date, hours")
      .gte("date", startDate)
      .lte("date", endDate)
      .gt("hours", 0);

    if (!error && data) {
      setRecords(data as AttendanceRow[]);
    }
    setLoading(false);
  }, [startDate, endDate]);

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
