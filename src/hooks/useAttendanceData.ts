"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { getCached, cachedFetch, invalidateCache } from "@/lib/fetchCache";

export interface AttendanceRow {
  id: string;
  teacher_id: string;
  student_id: string;
  class_name: string;
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
  class_name?: string;
  date: string;
  hours?: number | null;
  memo?: string;
  cell_color?: string | null;
  homework?: boolean;
}

/**
 * rowKey = `${studentId}|${className}` 또는 단일 분반이면 studentId.
 * studentRows 에서 쓰는 가상 id 포맷과 일치.
 */
function parseRowKey(rowKey: string): { studentId: string; className: string } {
  const idx = rowKey.indexOf("|");
  if (idx < 0) return { studentId: rowKey, className: "" };
  return { studentId: rowKey.slice(0, idx), className: rowKey.slice(idx + 1) };
}

function makeRowKey(studentId: string, className: string): string {
  return className ? `${studentId}|${className}` : studentId;
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

// presence/편집 추적 key. rowKey 에 "|" 가 포함될 수 있어 "::" 구분자 사용.
const cellKey = (rowKey: string, date: string) => `${rowKey}::${date}`;

export function useAttendanceData(
  teacherId: string,
  year: number,
  month: number,
  /** 세션 모드 등에서 기간을 덮어쓰기 (YYYY-MM-DD) */
  rangeOverride?: { startDate: string; endDate: string } | null
) {
  // fetch URL — 캐시 키로도 사용. 월별 / 세션별 범위 모두 고유 키.
  const fetchUrl = useMemo(() => {
    if (!teacherId) return null;
    const params = new URLSearchParams({ teacher_id: teacherId });
    if (rangeOverride?.startDate && rangeOverride?.endDate) {
      params.set("startDate", rangeOverride.startDate);
      params.set("endDate", rangeOverride.endDate);
    } else {
      params.set("year", String(year));
      params.set("month", String(month));
    }
    return `/api/attendance?${params}`;
  }, [teacherId, year, month, rangeOverride?.startDate, rangeOverride?.endDate]);

  // SWR: 캐시에 있으면 즉시 보여주고 백그라운드 revalidate (스켈레톤 깜빡임 제거)
  const initialCached = fetchUrl ? getCached<AttendanceRow[]>(fetchUrl) : undefined;
  const [records, setRecords] = useState<AttendanceRow[]>(initialCached ?? []);
  const [loading, setLoading] = useState(!initialCached && !!teacherId);
  const recordsRef = useRef<AttendanceRow[]>(initialCached ?? []);
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

  // 월별 or 범위별 데이터 로드.
  // ─ race condition 방지: deps 변경으로 fetch 가 여러 번 호출될 때 (예: 첫 렌더 후
  //   session 뷰로 rangeOverride 가 나중에 들어오는 케이스), 이전 요청이 늦게 resolve
  //   되어도 그 결과로 records 를 덮어쓰지 않도록 reqId 로 stale 체크.
  const reqIdRef = useRef(0);
  const fetchRecords = useCallback(async () => {
    if (!fetchUrl) {
      setRecords([]);
      setLoading(false);
      return;
    }
    const myReqId = ++reqIdRef.current;
    // 캐시에 있으면 로딩 표시 없이 조용히 revalidate
    const hasCached = !!getCached<AttendanceRow[]>(fetchUrl);
    if (!hasCached) setLoading(true);
    try {
      const data = await cachedFetch<AttendanceRow[]>(fetchUrl);
      if (reqIdRef.current === myReqId) setRecords(data);
    } catch {
      // 네트워크 에러는 무시 — 기존 상태 유지
    } finally {
      if (reqIdRef.current === myReqId) setLoading(false);
    }
  }, [fetchUrl]);

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
        // 본인이 편집 중인 셀이면 무시 (입력 충돌 방지) — class_name 포함 rowKey 기준
        const rowKey = makeRowKey(row.student_id, row.class_name || "");
        const key = cellKey(rowKey, row.date);
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

    // Presence 구독 — 다른 사용자가 편집 중인 셀 추적 (rowKey::date 포맷)
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState() as Record<
        string,
        Array<{ email: string; name: string; cells: string[] }>
      >;
      const next = new Map<string, EditingPeer>();
      for (const presences of Object.values(state)) {
        for (const p of presences) {
          if (p.email === myEmail) continue;
          for (const c of p.cells || []) {
            const sep = c.lastIndexOf("::");
            if (sep < 0) continue;
            const rowKey = c.slice(0, sep);
            const date = c.slice(sep + 2);
            const { studentId } = parseRowKey(rowKey);
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
    async (rowKey: string, date: string, editing: boolean) => {
      const key = cellKey(rowKey, date);
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

  // 공통 낙관적 업데이트 + 서버 upsert (rowKey = studentId|className 기반)
  const optimisticUpdate = useCallback(
    async (
      rowKey: string,
      date: string,
      patch: Partial<Pick<AttendanceRow, "hours" | "memo" | "cell_color" | "homework">>,
      payload: UpsertPayload
    ) => {
      const { studentId, className } = parseRowKey(rowKey);
      const existing = recordsRef.current.find(
        (r) =>
          r.student_id === studentId &&
          (r.class_name || "") === className &&
          r.date === date
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
    (rowKey: string, date: string, hours: number | null) => {
      const { studentId, className } = parseRowKey(rowKey);
      return optimisticUpdate(
        rowKey,
        date,
        { hours: hours ?? 0 },
        {
          teacher_id: teacherId,
          student_id: studentId,
          class_name: className,
          date,
          hours,
        }
      );
    },
    [optimisticUpdate, teacherId]
  );

  const updateMemo = useCallback(
    (rowKey: string, date: string, memo: string) => {
      const { studentId, className } = parseRowKey(rowKey);
      return optimisticUpdate(
        rowKey,
        date,
        { memo },
        {
          teacher_id: teacherId,
          student_id: studentId,
          class_name: className,
          date,
          memo,
        }
      );
    },
    [optimisticUpdate, teacherId]
  );

  const updateCellColor = useCallback(
    (rowKey: string, date: string, cellColor: string | null) => {
      const { studentId, className } = parseRowKey(rowKey);
      return optimisticUpdate(
        rowKey,
        date,
        { cell_color: cellColor || "" },
        {
          teacher_id: teacherId,
          student_id: studentId,
          class_name: className,
          date,
          cell_color: cellColor,
        }
      );
    },
    [optimisticUpdate, teacherId]
  );

  const updateHomework = useCallback(
    (rowKey: string, date: string, homework: boolean) => {
      const { studentId, className } = parseRowKey(rowKey);
      return optimisticUpdate(
        rowKey,
        date,
        { homework },
        {
          teacher_id: teacherId,
          student_id: studentId,
          class_name: className,
          date,
          homework,
        }
      );
    },
    [optimisticUpdate, teacherId]
  );

  /**
   * 데이터 맵. 두 수준의 key 로 조회 가능:
   *   - 학생 단위 (studentId) — 해당 학생의 **모든** 분반 출석을 합침 (레거시 호환)
   *   - rowKey (studentId|className) — 해당 분반 전용 출석만
   * AttendancePage 의 studentRows 분할된 rowId 로 조회하면 분반별 독립 데이터.
   */
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
    const ensure = (key: string) => {
      let d = map.get(key);
      if (!d) {
        d = { attendance: {}, memos: {}, cellColors: {}, homework: {} };
        map.set(key, d);
      }
      return d;
    };

    for (const r of records) {
      const cn = r.class_name || "";
      const rowKey = makeRowKey(r.student_id, cn);
      // 1) 분반별 rowKey 맵
      const rd = ensure(rowKey);
      if (r.hours > 0 || r.hours === 0) rd.attendance[r.date] = r.hours;
      if (r.memo) rd.memos[r.date] = r.memo;
      if (r.cell_color) rd.cellColors[r.date] = r.cell_color;
      if (r.homework) rd.homework[r.date] = r.homework;
      // 2) 학생 전체 맵 (레거시) — rowKey 와 studentId 가 다를 때만 추가
      if (rowKey !== r.student_id) {
        const sd = ensure(r.student_id);
        if (r.hours > 0 || r.hours === 0) sd.attendance[r.date] = r.hours;
        if (r.memo) sd.memos[r.date] = r.memo;
        if (r.cell_color) sd.cellColors[r.date] = r.cell_color;
        if (r.homework) sd.homework[r.date] = r.homework;
      }
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
    refetch: useCallback(async () => {
      if (fetchUrl) invalidateCache(fetchUrl);
      await fetchRecords();
    }, [fetchUrl, fetchRecords]),
    /** 다른 사용자가 편집 중인 셀 맵 (key: "studentId|date") */
    editingByPeers,
    /** 셀 편집 시작/종료 broadcast */
    setEditingCell,
  };
}
