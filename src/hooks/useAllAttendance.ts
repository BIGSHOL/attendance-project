"use client";

import { useEffect, useState, useCallback } from "react";
import type { AttendanceRow } from "./useAttendanceData";
import { cachedFetch, getCached, invalidateCache } from "@/lib/fetchCache";

/**
 * 특정 월 또는 세션 기간의 모든 선생님 출석 데이터 조회.
 * rangeOverride 가 주어지면 해당 기간으로 조회 (세션 기반 급여 정산용).
 *
 * cachedFetch 사용 — 같은 URL 의 동시/연속 호출은 inflight dedup + last-response 캐시.
 *   예: SettlementPage 에서 attendanceRecords (sessionRange) + verificationAttendance
 *       (null) 두 hook 호출 시 sessionRange 가 null/빈 케이스에 한 번만 실제 fetch.
 */
export function useAllAttendance(
  year: number,
  month: number,
  rangeOverride?: { startDate: string; endDate: string } | null
) {
  const overrideStart = rangeOverride?.startDate;
  const overrideEnd = rangeOverride?.endDate;

  const url =
    overrideStart && overrideEnd
      ? `/api/attendance/all?startDate=${overrideStart}&endDate=${overrideEnd}`
      : `/api/attendance/all?year=${year}&month=${month}`;

  const cached = getCached<AttendanceRow[]>(url);
  const [records, setRecords] = useState<AttendanceRow[]>(cached ?? []);
  const [loading, setLoading] = useState(!cached);

  const refetch = useCallback(async () => {
    if (!getCached<AttendanceRow[]>(url)) setLoading(true);
    try {
      const data = await cachedFetch<AttendanceRow[]>(url);
      setRecords(data || []);
    } catch {
      // 네트워크 에러 — 기존 상태 유지
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  // 외부에서 강제 새로고침 (cache invalidate)
  const forceRefetch = useCallback(async () => {
    invalidateCache(url);
    await refetch();
  }, [url, refetch]);

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

  return { records, loading, getAttendanceByTeacher, refetch: forceRefetch };
}
