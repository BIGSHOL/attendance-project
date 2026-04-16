"use client";

import { useEffect, useState, useCallback } from "react";
import type { AttendanceRow } from "./useAttendanceData";

/**
 * 특정 월의 모든 선생님 출석 데이터 조회
 * 서버 /api/attendance/all 엔드포인트를 경유해 RLS 우회(dev bypass) 호환.
 */
export function useAllAttendance(year: number, month: number) {
  const [records, setRecords] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.fetch(
        `/api/attendance/all?year=${year}&month=${month}`,
        { cache: "no-store" }
      );
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
  }, [year, month]);

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
