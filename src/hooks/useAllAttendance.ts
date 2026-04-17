"use client";

import { useEffect, useState, useCallback } from "react";
import type { AttendanceRow } from "./useAttendanceData";

/**
 * 특정 월 또는 세션 기간의 모든 선생님 출석 데이터 조회.
 * rangeOverride 가 주어지면 해당 기간으로 조회 (세션 기반 급여 정산용).
 */
export function useAllAttendance(
  year: number,
  month: number,
  rangeOverride?: { startDate: string; endDate: string } | null
) {
  const [records, setRecords] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const overrideStart = rangeOverride?.startDate;
  const overrideEnd = rangeOverride?.endDate;

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const qs =
        overrideStart && overrideEnd
          ? `startDate=${overrideStart}&endDate=${overrideEnd}`
          : `year=${year}&month=${month}`;
      const res = await window.fetch(
        `/api/attendance/all?${qs}`,
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
  }, [year, month, overrideStart, overrideEnd]);

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
