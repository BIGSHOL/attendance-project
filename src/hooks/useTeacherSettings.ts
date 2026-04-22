"use client";

import { useCallback, useEffect, useState } from "react";
import type { SalaryType } from "./useUserRole";

/**
 * 선생님별 과목×그룹 비율 오버라이드.
 * 예: { math: { "초등": 47.5, "중등": 48.5 }, english: { "초등": 43 } }
 */
export type TeacherRatioMap = Record<string, Record<string, number>>;

export interface TeacherSetting {
  staff_id: string;
  blog_required: boolean;
  salary_type: SalaryType;
  commission_days: string[];
  ratios?: TeacherRatioMap;
  /**
   * 행정급여 월 기본액 (원). 0 이면 미사용.
   * 실급여 = admin_base_amount × tier.ratio × (1 − academyFee).
   * 김민주 선생님처럼 학생 외 행정업무 겸임하는 케이스 대응.
   */
  admin_base_amount?: number;
  /**
   * 행정급여 환산에 참조할 tier id (salaryConfig.items[].id).
   * 이 tier 의 ratio · 수수료 체계를 그대로 사용해 계산한다.
   */
  admin_tier_id?: string | null;
  /**
   * 월 고정급 금액 (원). salary_type === 'fixed' 선생님의 월 지급액.
   * 정산 탭 표기는 "계약에 따른 급여 지급" 문구로 대체, 실금액은 별도 관리.
   * 0 이면 미설정.
   */
  fixed_salary_amount?: number;
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

  /** 선생님의 비율 오버라이드 맵 반환 (없으면 빈 객체) */
  const getRatios = useCallback(
    (id: string): TeacherRatioMap => {
      const row = settings.find((s) => s.staff_id === id);
      return row?.ratios || {};
    },
    [settings]
  );

  /** 선생님의 비율 오버라이드 맵 저장 */
  const setRatios = useCallback(
    (targetStaffId: string, ratios: TeacherRatioMap) =>
      postPatch({ staff_id: targetStaffId, ratios }),
    [postPatch]
  );

  /** 행정급여 설정 저장 (기본액 + 참조 tier id) */
  const setAdminAllowance = useCallback(
    (
      targetStaffId: string,
      baseAmount: number,
      tierId: string | null
    ) =>
      postPatch({
        staff_id: targetStaffId,
        admin_base_amount: baseAmount,
        admin_tier_id: tierId,
      }),
    [postPatch]
  );

  /** 행정급여 설정 조회 (없으면 null) */
  const getAdminAllowance = useCallback(
    (id: string): { baseAmount: number; tierId: string | null } | null => {
      const row = settings.find((s) => s.staff_id === id);
      if (!row) return null;
      const baseAmount = row.admin_base_amount ?? 0;
      const tierId = row.admin_tier_id ?? null;
      if (baseAmount <= 0 || !tierId) return null;
      return { baseAmount, tierId };
    },
    [settings]
  );

  /** 월 고정급 저장 */
  const setFixedSalary = useCallback(
    (targetStaffId: string, amount: number) =>
      postPatch({
        staff_id: targetStaffId,
        fixed_salary_amount: Math.max(0, Math.floor(amount || 0)),
      }),
    [postPatch]
  );

  /** 월 고정급 조회 (없거나 0 이면 null) */
  const getFixedSalary = useCallback(
    (id: string): number => {
      const row = settings.find((s) => s.staff_id === id);
      return row?.fixed_salary_amount ?? 0;
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
    setRatios,
    setAdminAllowance,
    setFixedSalary,
    isBlogRequired,
    getSalary,
    getRatios,
    getAdminAllowance,
    getFixedSalary,
    refetch: fetchSettings,
  };
}
