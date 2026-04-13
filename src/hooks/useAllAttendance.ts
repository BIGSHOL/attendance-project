"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AttendanceRow } from "./useAttendanceData";

/**
 * 특정 월의 모든 선생님 출석 데이터 조회
 */
export function useAllAttendance(year: number, month: number) {
  const [records, setRecords] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const supabaseRef = useRef(createClient());

  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = `${year}-${String(month).padStart(2, "0")}-${new Date(year, month, 0).getDate()}`;

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabaseRef.current
      .from("attendance")
      .select("id, teacher_id, student_id, date, hours, memo, cell_color, homework, is_makeup")
      .gte("date", startDate)
      .lte("date", endDate);

    if (!error && data) {
      setRecords(data as AttendanceRow[]);
    }
    setLoading(false);
  }, [startDate, endDate]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  /**
   * 선생님별 학생 출석 합계 맵
   * Map<teacherId, Map<studentId, totalHours>>
   */
  const getAttendanceByTeacher = useCallback(() => {
    const teacherMap = new Map<string, Map<string, number>>();
    for (const r of records) {
      if (!teacherMap.has(r.teacher_id)) {
        teacherMap.set(r.teacher_id, new Map());
      }
      const studentMap = teacherMap.get(r.teacher_id)!;
      if (r.hours > 0) {
        studentMap.set(r.student_id, (studentMap.get(r.student_id) || 0) + r.hours);
      }
    }
    return teacherMap;
  }, [records]);

  return { records, loading, getAttendanceByTeacher, refetch: fetch };
}
