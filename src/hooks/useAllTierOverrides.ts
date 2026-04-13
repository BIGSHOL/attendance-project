"use client";

import { useEffect, useState, useCallback } from "react";

/** `${teacher_id}|${student_id}` → salary_item_id */
export type TierOverrideMap = Record<string, string>;

export function useAllTierOverrides() {
  const [overrides, setOverrides] = useState<TierOverrideMap>({});
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/attendance/tier-overrides`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as {
          student_id: string;
          salary_item_id: string;
          teacher_id: string;
        }[];
        const map: TierOverrideMap = {};
        for (const r of data) map[`${r.teacher_id}|${r.student_id}`] = r.salary_item_id;
        setOverrides(map);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { overrides, loading, refetch };
}
