"use client";

import { useCallback, useEffect, useState } from "react";
import type { NoteInspection, NoteInspectionStatus } from "@/types";
import { cachedFetch, getCached, invalidateCache } from "@/lib/fetchCache";

/**
 * 월별 노트 검사 기록 CRUD 훅
 *   - useConsultations 과 동일한 캐시 전략
 *   - 생성/수정/삭제 시 해당 월 캐시 invalidate 후 재조회
 * @param month YYYY-MM
 */
export function useNoteInspections(month: string) {
  const urlKey = `/api/note-inspections?month=${month}`;
  const cached = getCached<NoteInspection[]>(urlKey);
  const [inspections, setInspections] = useState<NoteInspection[]>(cached ?? []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    invalidateCache(urlKey);
    setLoading(true);
    try {
      const data = await cachedFetch<NoteInspection[]>(urlKey);
      setInspections(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "조회 실패");
    } finally {
      setLoading(false);
    }
  }, [urlKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(!getCached<NoteInspection[]>(urlKey));
    (async () => {
      try {
        const data = await cachedFetch<NoteInspection[]>(urlKey);
        if (!cancelled) {
          setInspections(data);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          console.error("[useNoteInspections]", e);
          setInspections([]);
          setError(e instanceof Error ? e.message : "조회 실패");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [urlKey]);

  /** 새 검사 기록 추가 */
  const create = useCallback(
    async (input: {
      studentId: string;
      studentName: string;
      teacherName: string;
      date: string;
      status?: NoteInspectionStatus;
      memo?: string;
    }) => {
      const res = await fetch("/api/note-inspections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await reload();
      return (await res.json()) as NoteInspection;
    },
    [reload]
  );

  /** 기존 기록 수정 */
  const update = useCallback(
    async (
      id: string,
      patch: {
        status?: NoteInspectionStatus;
        memo?: string | null;
        date?: string;
        teacherName?: string;
      }
    ) => {
      const res = await fetch(`/api/note-inspections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await reload();
      return (await res.json()) as NoteInspection;
    },
    [reload]
  );

  /** 기록 삭제 */
  const remove = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/note-inspections/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await reload();
    },
    [reload]
  );

  return { inspections, loading, error, reload, create, update, remove };
}
