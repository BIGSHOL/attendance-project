"use client";

import { useEffect, useState, useCallback } from "react";
import type { SessionPeriod } from "@/types";

/**
 * 세션 기간 조회 (Supabase 기반)
 * - GET /api/sessions?year=&category=
 * - POST /api/sessions (upsert)
 * - DELETE /api/sessions/:id
 */
export function useSessionPeriods(year: number, category?: string) {
  const [sessions, setSessions] = useState<SessionPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const refresh = useCallback(() => setRefreshTrigger((n) => n + 1), []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const params = new URLSearchParams();
      params.set("year", String(year));
      if (category) params.set("category", category);
      try {
        const res = await fetch(`/api/sessions?${params.toString()}`);
        const data = await res.json();
        if (Array.isArray(data)) {
          setSessions(data as SessionPeriod[]);
        } else {
          setSessions([]);
        }
      } catch {
        setSessions([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [year, category, refreshTrigger]);

  /** 세션 저장/수정 (upsert) */
  const saveSession = useCallback(
    async (session: SessionPeriod) => {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(session),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "저장 실패");
      }
      refresh();
    },
    [refresh]
  );

  /** 세션 삭제 */
  const deleteSession = useCallback(
    async (sessionId: string) => {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "삭제 실패");
      }
      refresh();
    },
    [refresh]
  );

  /** 배치 저장 (마이그레이션용) */
  const saveManySessions = useCallback(
    async (list: SessionPeriod[]) => {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(list),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "배치 저장 실패");
      }
      refresh();
      return (await res.json()) as { count: number };
    },
    [refresh]
  );

  return { sessions, loading, saveSession, deleteSession, saveManySessions, refetch: refresh };
}
