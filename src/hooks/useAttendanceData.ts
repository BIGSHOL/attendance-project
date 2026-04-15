"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";

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

export interface EditingPeer {
  email: string;
  name: string;
  studentId: string;
  date: string;
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

const cellKey = (studentId: string, date: string) => `${studentId}|${date}`;

export function useAttendanceData(
  teacherId: string,
  year: number,
  month: number,
  /** 세션 모드 등에서 기간을 덮어쓰기 (YYYY-MM-DD) */
  rangeOverride?: { startDate: string; endDate: string } | null
) {
  const [records, setRecords] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const recordsRef = useRef<AttendanceRow[]>([]);
  useEffect(() => {
    recordsRef.current = records;
  }, [records]);

  const { email: myEmail, userRole } = useUserRole();
  const myName = userRole?.staff_name || (myEmail ? myEmail.split("@")[0] : "익명");

  // 본인이 편집 중인 셀 — realtime 외부 변경을 일시적으로 무시할 때 참조
  const editingByMeRef = useRef<Set<string>>(new Set());
  // 다른 사용자가 편집 중인 셀 (UI 표시용)
  const [editingByPeers, setEditingByPeers] = useState<Map<string, EditingPeer>>(
    new Map()
  );

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

  // 현재 보고 있는 기간 (날짜 필터링)
  const periodStart = useMemo(() => {
    if (overrideStart) return overrideStart;
    return `${year}-${String(month).padStart(2, "0")}-01`;
  }, [overrideStart, year, month]);
  const periodEnd = useMemo(() => {
    if (overrideEnd) return overrideEnd;
    const lastDay = new Date(year, month, 0).getDate();
    return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  }, [overrideEnd, year, month]);

  // ── Realtime + Presence ──
  useEffect(() => {
    if (!teacherId) return;
    const supabase = createClient();
    const channelName = `attendance:${teacherId}`;
    const channel = supabase.channel(channelName, {
      config: { presence: { key: myEmail || "anon" } },
    });

    // postgres_changes 구독
    channel.on(
      "postgres_changes" as never,
      {
        event: "*",
        schema: "public",
        table: "attendance",
        filter: `teacher_id=eq.${teacherId}`,
      },
      (payload: { eventType: string; new: AttendanceRow; old: Partial<AttendanceRow> }) => {
        const eventType = payload.eventType;
        const row = payload.new as AttendanceRow;
        const old = payload.old as AttendanceRow;

        if (eventType === "DELETE") {
          if (!old?.id) return;
          setRecords((prev) => prev.filter((r) => r.id !== old.id));
          return;
        }

        if (!row?.date) return;
        // 현재 기간 밖이면 무시
        if (row.date < periodStart || row.date > periodEnd) return;
        // 본인이 편집 중인 셀이면 무시 (입력 충돌 방지)
        const key = cellKey(row.student_id, row.date);
        if (editingByMeRef.current.has(key)) return;

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
    );

    // Presence 구독 — 다른 사용자가 편집 중인 셀 추적
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState() as Record<
        string,
        Array<{ email: string; name: string; cells: string[] }>
      >;
      const next = new Map<string, EditingPeer>();
      for (const presences of Object.values(state)) {
        for (const p of presences) {
          if (p.email === myEmail) continue; // 본인 제외
          for (const c of p.cells || []) {
            const [studentId, date] = c.split("|");
            if (!studentId || !date) continue;
            next.set(c, { email: p.email, name: p.name, studentId, date });
          }
        }
      }
      setEditingByPeers(next);
    });

    channel.subscribe(async (status: string) => {
      if (status === "SUBSCRIBED") {
        await channel.track({
          email: myEmail || "anon",
          name: myName || (myEmail ? myEmail.split("@")[0] : "익명"),
          cells: [],
        });
      }
    });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [teacherId, myEmail, myName, periodStart, periodEnd]);

  // 편집 중 셀 broadcast — 외부에서 호출
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(
    null
  );
  useEffect(() => {
    if (!teacherId) return;
    const supabase = createClient();
    // 위 useEffect 와 같은 채널 이름 → 같은 인스턴스 반환
    channelRef.current = supabase.channel(`attendance:${teacherId}`);
    return () => {
      channelRef.current = null;
    };
  }, [teacherId]);

  const setEditingCell = useCallback(
    async (studentId: string, date: string, editing: boolean) => {
      const key = cellKey(studentId, date);
      if (editing) editingByMeRef.current.add(key);
      else editingByMeRef.current.delete(key);

      const ch = channelRef.current;
      if (!ch) return;
      try {
        await ch.track({
          email: myEmail || "anon",
          name: myName || (myEmail ? myEmail.split("@")[0] : "익명"),
          cells: Array.from(editingByMeRef.current),
        });
      } catch {
        // presence 실패는 무시
      }
    },
    [myEmail, myName]
  );

  // 공통 낙관적 업데이트 + 서버 upsert
  const optimisticUpdate = useCallback(
    async (
      studentId: string,
      date: string,
      patch: Partial<Pick<AttendanceRow, "hours" | "memo" | "cell_color" | "homework">>,
      payload: UpsertPayload
    ) => {
      const existing = recordsRef.current.find(
        (r) => r.student_id === studentId && r.date === date
      );

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
    []
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

  const studentDataMap = useMemo(() => {
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
      let d = map.get(r.student_id);
      if (!d) {
        d = { attendance: {}, memos: {}, cellColors: {}, homework: {} };
        map.set(r.student_id, d);
      }
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
    /** 다른 사용자가 편집 중인 셀 맵 (key: "studentId|date") */
    editingByPeers,
    /** 셀 편집 시작/종료 broadcast */
    setEditingCell,
  };
}
