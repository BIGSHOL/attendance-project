"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

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

export function useAttendanceData(teacherId: string, year: number, month: number) {
  const [records, setRecords] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;

  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = `${year}-${String(month).padStart(2, "0")}-${new Date(year, month, 0).getDate()}`;

  // 월별 데이터 로드
  const fetch = useCallback(async () => {
    setLoading(true);
    const query = supabase
      .from("attendance")
      .select("*")
      .eq("teacher_id", teacherId)
      .gte("date", startDate)
      .lte("date", endDate);

    const { data, error } = await query;
    if (!error && data) {
      setRecords(data as AttendanceRow[]);
    }
    setLoading(false);
  }, [teacherId, startDate, endDate]);

  useEffect(() => {
    if (teacherId) {
      fetch();
    } else {
      setRecords([]);
      setLoading(false);
    }
  }, [teacherId, fetch]);

  // 출석 upsert (낙관적 UI)
  const upsertAttendance = useCallback(
    async (studentId: string, date: string, hours: number | null) => {
      const existing = records.find(
        (r) => r.student_id === studentId && r.date === date
      );

      if (hours === null) {
        // 삭제
        if (existing) {
          setRecords((prev) => prev.filter((r) => r.id !== existing.id));
          await supabase.from("attendance").delete().eq("id", existing.id);
        }
        return;
      }

      if (existing) {
        // 업데이트
        setRecords((prev) =>
          prev.map((r) => (r.id === existing.id ? { ...r, hours } : r))
        );
        await supabase.from("attendance").update({ hours, updated_at: new Date().toISOString() }).eq("id", existing.id);
      } else {
        // 삽입
        const newRow = {
          teacher_id: teacherId,
          student_id: studentId,
          date,
          hours,
          memo: "",
          cell_color: "",
          homework: false,
          is_makeup: false,
        };
        const { data, error } = await supabase
          .from("attendance")
          .insert(newRow)
          .select()
          .single();

        if (!error && data) {
          setRecords((prev) => [...prev, data as AttendanceRow]);
        }
      }
    },
    [records, teacherId]
  );

  // 메모 업데이트
  const updateMemo = useCallback(
    async (studentId: string, date: string, memo: string) => {
      const existing = records.find(
        (r) => r.student_id === studentId && r.date === date
      );

      if (existing) {
        setRecords((prev) =>
          prev.map((r) => (r.id === existing.id ? { ...r, memo } : r))
        );
        await supabase.from("attendance").update({ memo, updated_at: new Date().toISOString() }).eq("id", existing.id);
      } else {
        // 출석 없어도 메모만 생성
        const { data, error } = await supabase
          .from("attendance")
          .insert({ teacher_id: teacherId, student_id: studentId, date, hours: 0, memo, cell_color: "", homework: false, is_makeup: false })
          .select()
          .single();
        if (!error && data) {
          setRecords((prev) => [...prev, data as AttendanceRow]);
        }
      }
    },
    [records, teacherId]
  );

  // 셀 색상 업데이트
  const updateCellColor = useCallback(
    async (studentId: string, date: string, cellColor: string | null) => {
      const existing = records.find(
        (r) => r.student_id === studentId && r.date === date
      );

      if (existing) {
        setRecords((prev) =>
          prev.map((r) => (r.id === existing.id ? { ...r, cell_color: cellColor || "" } : r))
        );
        await supabase.from("attendance").update({ cell_color: cellColor || "", updated_at: new Date().toISOString() }).eq("id", existing.id);
      } else if (cellColor) {
        const { data, error } = await supabase
          .from("attendance")
          .insert({ teacher_id: teacherId, student_id: studentId, date, hours: 0, memo: "", cell_color: cellColor, homework: false, is_makeup: false })
          .select()
          .single();
        if (!error && data) {
          setRecords((prev) => [...prev, data as AttendanceRow]);
        }
      }
    },
    [records, teacherId]
  );

  // 숙제 업데이트
  const updateHomework = useCallback(
    async (studentId: string, date: string, homework: boolean) => {
      const existing = records.find(
        (r) => r.student_id === studentId && r.date === date
      );

      if (existing) {
        setRecords((prev) =>
          prev.map((r) => (r.id === existing.id ? { ...r, homework } : r))
        );
        await supabase.from("attendance").update({ homework, updated_at: new Date().toISOString() }).eq("id", existing.id);
      } else {
        const { data, error } = await supabase
          .from("attendance")
          .insert({ teacher_id: teacherId, student_id: studentId, date, hours: 0, memo: "", cell_color: "", homework, is_makeup: false })
          .select()
          .single();
        if (!error && data) {
          setRecords((prev) => [...prev, data as AttendanceRow]);
        }
      }
    },
    [records, teacherId]
  );

  // records → 학생별 attendance/memo/color/homework 맵으로 변환
  const studentDataMap = useCallback(() => {
    const map = new Map<string, {
      attendance: Record<string, number>;
      memos: Record<string, string>;
      cellColors: Record<string, string>;
      homework: Record<string, boolean>;
    }>();

    for (const r of records) {
      if (!map.has(r.student_id)) {
        map.set(r.student_id, { attendance: {}, memos: {}, cellColors: {}, homework: {} });
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
    refetch: fetch,
  };
}
