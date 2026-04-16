"use client";

import { useEffect, useState, useCallback } from "react";

export interface TeacherSheet {
  teacher_id: string;
  sheet_url: string;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * 선생님별 Google Sheets URL 매핑 훅
 * 서버 /api/teacher-sheets 엔드포인트를 경유해 RLS 우회(dev bypass) 호환.
 */
export function useTeacherSheets() {
  const [sheets, setSheets] = useState<TeacherSheet[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.fetch("/api/teacher-sheets", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as TeacherSheet[];
        setSheets(data || []);
      } else {
        setSheets([]);
      }
    } catch {
      setSheets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const upsertSheet = useCallback(
    async (teacherId: string, sheetUrl: string) => {
      await window.fetch("/api/teacher-sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teacher_id: teacherId, sheet_url: sheetUrl }),
      });
      await refetch();
    },
    [refetch]
  );

  const deleteSheet = useCallback(
    async (teacherId: string) => {
      await window.fetch(
        `/api/teacher-sheets/${encodeURIComponent(teacherId)}`,
        { method: "DELETE" }
      );
      await refetch();
    },
    [refetch]
  );

  const markSynced = useCallback(
    async (teacherId: string) => {
      await window.fetch(
        `/api/teacher-sheets/${encodeURIComponent(teacherId)}`,
        { method: "PATCH" }
      );
      await refetch();
    },
    [refetch]
  );

  return { sheets, loading, refetch, upsertSheet, deleteSheet, markSynced };
}
