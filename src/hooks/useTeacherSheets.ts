"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

export interface TeacherSheet {
  teacher_id: string;
  sheet_url: string;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * 선생님별 Google Sheets URL 매핑 훅
 */
export function useTeacherSheets() {
  const [sheets, setSheets] = useState<TeacherSheet[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase.from("teacher_sheets").select("*");
    if (data) setSheets(data as TeacherSheet[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const upsertSheet = useCallback(
    async (teacherId: string, sheetUrl: string) => {
      const supabase = createClient();
      await supabase
        .from("teacher_sheets")
        .upsert(
          {
            teacher_id: teacherId,
            sheet_url: sheetUrl,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "teacher_id" }
        );
      await refetch();
    },
    [refetch]
  );

  const deleteSheet = useCallback(
    async (teacherId: string) => {
      const supabase = createClient();
      await supabase.from("teacher_sheets").delete().eq("teacher_id", teacherId);
      await refetch();
    },
    [refetch]
  );

  const markSynced = useCallback(
    async (teacherId: string) => {
      const supabase = createClient();
      await supabase
        .from("teacher_sheets")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("teacher_id", teacherId);
      await refetch();
    },
    [refetch]
  );

  return { sheets, loading, refetch, upsertSheet, deleteSheet, markSynced };
}
