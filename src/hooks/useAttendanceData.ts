"use client";

import { useEffect, useState, useCallback } from "react";

export interface AttendanceRow {
  id: string;
  teacher_id: string;
  student_id: string;
  date: string;
  hours: number;
  memo: string;
  cell_color: string;
  homework: boolean;
  is_makeup: boolean;
}

interface UpsertPayload {
  teacher_id: string;
  student_id: string;
  date: string;
  hours?: number | null;
  memo?: string;
  cell_color?: string | null;
  homework?: boolean;
}

async function patchAttendance(payload: UpsertPayload): Promise<AttendanceRow | null> {
  const res = await fetch("/api/attendance", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (data?.deleted) return null;
  return data as AttendanceRow;
}

export function useAttendanceData(
  teacherId: string,
  year: number,
  month: number,
  /** 세션 모드 등에서 기간을 덮어쓰기 (YYYY-MM-DD) */
  rangeOverride?: { startDate: string; endDate: string } | null
) {
  const [records, setRecords] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const overrideStart = rangeOverride?.startDate;
  const overrideEnd = rangeOverride?.endDate;

  // 월별 or 범위별 데이터 로드
  const fetchRecords = useCallback(async () => {
    if (!teacherId) {
      setRecords([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ teacher_id: teacherId });
      if (overrideStart && overrideEnd) {
        params.set("startDate", overrideStart);
        params.set("endDate", overrideEnd);
      } else {
        params.set("year", String(year));
        params.set("month", String(month));
      }
      const res = await fetch(`/api/attendance?${params}`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as AttendanceRow[];
        setRecords(data);
      }
    } finally {
      setLoading(false);
    }
  }, [teacherId, year, month, overrideStart, overrideEnd]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  // 공통 낙관적 업데이트 + 서버 upsert
  const optimisticUpdate = useCallback(
    async (
      studentId: string,
      date: string,
      patch: Partial<Pick<AttendanceRow, "hours" | "memo" | "cell_color" | "homework">>,
      payload: UpsertPayload
    ) => {
      const existing = records.find(
        (r) => r.student_id === studentId && r.date === date
      );

      // 삭제 케이스 (hours === null + 필드 없음)
      const isDelete =
        payload.hours === null &&
        payload.memo === undefined &&
        payload.cell_color === undefined &&
        payload.homework === undefined;

      if (isDelete) {
        if (existing) {
          setRecords((prev) => prev.filter((r) => r.id !== existing.id));
        }
        await patchAttendance(payload);
        return;
      }

      // 낙관적 UI
      if (existing) {
        setRecords((prev) =>
          prev.map((r) => (r.id === existing.id ? { ...r, ...patch } : r))
        );
      }

      const row = await patchAttendance(payload);
      if (row) {
        setRecords((prev) => {
          const idx = prev.findIndex((r) => r.id === row.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = row;
            return next;
          }
          return [...prev, row];
        });
      }
    },
    [records]
  );

  const upsertAttendance = useCallback(
    (studentId: string, date: string, hours: number | null) =>
      optimisticUpdate(
        studentId,
        date,
        { hours: hours ?? 0 },
        { teacher_id: teacherId, student_id: studentId, date, hours }
      ),
    [optimisticUpdate, teacherId]
  );

  const updateMemo = useCallback(
    (studentId: string, date: string, memo: string) =>
      optimisticUpdate(
        studentId,
        date,
        { memo },
        { teacher_id: teacherId, student_id: studentId, date, memo }
      ),
    [optimisticUpdate, teacherId]
  );

  const updateCellColor = useCallback(
    (studentId: string, date: string, cellColor: string | null) =>
      optimisticUpdate(
        studentId,
        date,
        { cell_color: cellColor || "" },
        { teacher_id: teacherId, student_id: studentId, date, cell_color: cellColor }
      ),
    [optimisticUpdate, teacherId]
  );

  const updateHomework = useCallback(
    (studentId: string, date: string, homework: boolean) =>
      optimisticUpdate(
        studentId,
        date,
        { homework },
        { teacher_id: teacherId, student_id: studentId, date, homework }
      ),
    [optimisticUpdate, teacherId]
  );

  // records → 학생별 attendance/memo/color/homework 맵으로 변환
  const studentDataMap = useCallback(() => {
    const map = new Map<
      string,
      {
        attendance: Record<string, number>;
        memos: Record<string, string>;
        cellColors: Record<string, string>;
        homework: Record<string, boolean>;
      }
    >();

    for (const r of records) {
      if (!map.has(r.student_id)) {
        map.set(r.student_id, {
          attendance: {},
          memos: {},
          cellColors: {},
          homework: {},
        });
      }
      const d = map.get(r.student_id)!;
      if (r.hours > 0 || r.hours === 0) d.attendance[r.date] = r.hours;
      if (r.memo) d.memos[r.date] = r.memo;
      if (r.cell_color) d.cellColors[r.date] = r.cell_color;
      if (r.homework) d.homework[r.date] = r.homework;
    }

    return map;
  }, [records]);

  return {
    records,
    loading,
    studentDataMap,
    upsertAttendance,
    updateMemo,
    updateCellColor,
    updateHomework,
    refetch: fetchRecords,
  };
}
