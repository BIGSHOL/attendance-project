"use client";

import { useEffect, useState, useCallback } from "react";

/**
 * 전 선생님 tier override 맵 (정산 페이지 등 전체 뷰용).
 * 키: `${teacher_id}|${student_id}|${class_name||''}` — 분반까지 포함.
 * 레거시 호환: 분반 미지정 레코드는 `${teacher_id}|${student_id}` 키도 함께 등록.
 */
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
          class_name?: string | null;
        }[];
        const map: TierOverrideMap = {};
        for (const r of data) {
          const cn = r.class_name || "";
          map[`${r.teacher_id}|${r.student_id}|${cn}`] = r.salary_item_id;
          if (!cn) map[`${r.teacher_id}|${r.student_id}`] = r.salary_item_id;
        }
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
