"use client";

import { useEffect, useState, useCallback } from "react";

/**
 * tier override 맵.
 * 키: `${studentId}|${classNameOrDays}` 로 분반까지 구분.
 * 분반 정보가 없는 레거시 레코드는 class_name 이 빈 문자열/NULL 이므로
 * `${studentId}|` 키 + `${studentId}` 키 두 곳에 동시 등록해 호환.
 *
 * 값: salary_item_id (SalaryConfig.items[].id).
 */
export type TierOverrideMap = Record<string, string>;

interface TierOverrideRow {
  student_id: string;
  class_name: string | null;
  salary_item_id: string;
}

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
        const data = (await res.json()) as TierOverrideRow[];
        const map: TierOverrideMap = {};
        for (const r of data) {
          const cn = r.class_name || "";
          // 복합 키 (분반 포함)
          map[`${r.student_id}|${cn}`] = r.salary_item_id;
          // 레거시 호환: 분반 미지정시 학생 id 단독으로도 접근 가능
          if (!cn) map[r.student_id] = r.salary_item_id;
        }
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
