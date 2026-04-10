"use client";

import { useEffect, useState, useCallback } from "react";

/** student_id → salary_item_id */
export type TierOverrideMap = Record<string, string>;

export function useStudentTierOverrides(teacherId: string) {
  const [overrides, setOverrides] = useState<TierOverrideMap>({});
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!teacherId) {
      setOverrides({});
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/attendance/tier-overrides?teacher_id=${encodeURIComponent(teacherId)}`,
        { cache: "no-store" }
      );
      if (res.ok) {
        const data = (await res.json()) as {
          student_id: string;
          salary_item_id: string;
        }[];
        const map: TierOverrideMap = {};
        for (const r of data) map[r.student_id] = r.salary_item_id;
        setOverrides(map);
      }
    } finally {
      setLoading(false);
    }
  }, [teacherId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { overrides, loading, refetch };
}
