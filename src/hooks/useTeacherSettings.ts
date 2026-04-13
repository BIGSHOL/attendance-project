"use client";

import { useCallback, useEffect, useState } from "react";
import type { SalaryType } from "./useUserRole";

export interface TeacherSetting {
  staff_id: string;
  blog_required: boolean;
  salary_type: SalaryType;
  commission_days: string[];
  updated_at?: string;
}

/**
 * 선생님 설정 (staff_id 기반, 계정 매핑과 무관)
 * - staffId 주면 단일 조회
 * - 없으면 전체 조회
 */
export function useTeacherSettings(staffId?: string) {
  const [settings, setSettings] = useState<TeacherSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const url = staffId
        ? `/api/teacher-settings?staff_id=${encodeURIComponent(staffId)}`
        : "/api/teacher-settings";
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setSettings(Array.isArray(data) ? data : [data]);
      }
    } finally {
      setLoading(false);
    }
  }, [staffId]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const upsertRow = useCallback((row: TeacherSetting) => {
    setSettings((prev) => {
      const idx = prev.findIndex((s) => s.staff_id === row.staff_id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = row;
        return next;
      }
      return [...prev, row];
    });
  }, []);

  const postPatch = useCallback(
    async (body: Record<string, unknown>) => {
      setSaving(true);
      try {
        const res = await fetch("/api/teacher-settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) return null;
        const row = (await res.json()) as TeacherSetting;
        upsertRow(row);
        return row;
      } finally {
        setSaving(false);
      }
    },
    [upsertRow]
  );

  const setBlogRequired = useCallback(
    (targetStaffId: string, required: boolean) =>
      postPatch({ staff_id: targetStaffId, blog_required: required }),
    [postPatch]
  );

  const setSalaryType = useCallback(
    (targetStaffId: string, type: SalaryType, days?: string[]) =>
      postPatch({
        staff_id: targetStaffId,
        salary_type: type,
        // 비율제/급여제는 요일 초기화, 혼합은 넘겨준 값 유지(없으면 빈 배열)
        commission_days: type === "mixed" ? days ?? [] : [],
      }),
    [postPatch]
  );

  const setCommissionDays = useCallback(
    (targetStaffId: string, days: string[]) =>
      postPatch({ staff_id: targetStaffId, commission_days: days }),
    [postPatch]
  );

  const isBlogRequired = useCallback(
    (id: string): boolean =>
      !!settings.find((s) => s.staff_id === id)?.blog_required,
    [settings]
  );

  const getSalary = useCallback(
    (id: string): { type: SalaryType; days: string[] } | null => {
      const row = settings.find((s) => s.staff_id === id);
      if (!row) return null;
      return {
        type: row.salary_type || "commission",
        days: row.commission_days || [],
      };
    },
    [settings]
  );

  return {
    settings,
    loading,
    saving,
    setBlogRequired,
    setSalaryType,
    setCommissionDays,
    isBlogRequired,
    getSalary,
    refetch: fetchSettings,
  };
}
