"use client";

import { useCallback, useEffect, useState } from "react";

export interface TeacherSetting {
  staff_id: string;
  blog_required: boolean;
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

  const setBlogRequired = useCallback(
    async (targetStaffId: string, required: boolean) => {
      setSaving(true);
      try {
        const res = await fetch("/api/teacher-settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ staff_id: targetStaffId, blog_required: required }),
        });
        if (!res.ok) return;
        const row = (await res.json()) as TeacherSetting;
        setSettings((prev) => {
          const idx = prev.findIndex((s) => s.staff_id === row.staff_id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = row;
            return next;
          }
          return [...prev, row];
        });
      } finally {
        setSaving(false);
      }
    },
    []
  );

  const isBlogRequired = useCallback(
    (id: string): boolean => {
      return !!settings.find((s) => s.staff_id === id)?.blog_required;
    },
    [settings]
  );

  return {
    settings,
    loading,
    saving,
    setBlogRequired,
    isBlogRequired,
    refetch: fetchSettings,
  };
}
