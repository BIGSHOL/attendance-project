"use client";

import { useCallback, useEffect, useState } from "react";
import { INITIAL_SALARY_CONFIG } from "@/types";
import type { SalaryConfig, TeacherRatios } from "@/types";

/**
 * 전체 공통 급여 설정 로드/저장 (Supabase 영속화).
 *
 * teacherRatios 는 두 소스를 합쳐서 제공한다:
 *   1) salary_configs.config.teacherRatios (레거시/기본값)
 *   2) teacher_settings.ratios — 선생님 페이지에서 편집. staff 이름으로 키 매핑.
 *   (2) 가 존재하면 (1) 을 덮어쓴다.
 */
export function useSalaryConfig() {
  const [config, setConfig] = useState<SalaryConfig>(INITIAL_SALARY_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 초기 로드 — salary-config + teacher-settings + staff 합성
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cfgRes, tsRes, staffRes] = await Promise.all([
          fetch("/api/salary-config", { cache: "no-store" }),
          fetch("/api/teacher-settings", { cache: "no-store" }),
          fetch("/api/staff", { cache: "no-store" }),
        ]);
        const cfgData = cfgRes.ok ? await cfgRes.json() : null;
        const tsData = tsRes.ok ? await tsRes.json() : [];
        const staffData = staffRes.ok ? await staffRes.json() : [];

        if (cancelled) return;

        const baseCfg = (cfgData?.config as SalaryConfig | null) || INITIAL_SALARY_CONFIG;
        // 선생님 id → 이름 매핑 (teacher_settings.ratios 는 staff_id 로 저장됨)
        const staffMap = new Map<string, string>();
        const staffArr = Array.isArray(staffData) ? staffData : [];
        for (const st of staffArr as { id: string; name?: string }[]) {
          if (st.id && st.name) staffMap.set(st.id, st.name);
        }

        const mergedRatios: TeacherRatios = { ...(baseCfg.teacherRatios || {}) };
        const tsArr = Array.isArray(tsData) ? tsData : [];
        for (const ts of tsArr as { staff_id: string; ratios?: Record<string, Record<string, number>> }[]) {
          const ratios = ts.ratios;
          if (!ratios || typeof ratios !== "object") continue;
          if (Object.keys(ratios).length === 0) continue;
          const name = staffMap.get(ts.staff_id) || ts.staff_id;
          mergedRatios[name] = ratios;
        }

        setConfig({ ...baseCfg, teacherRatios: mergedRatios });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "불러오기 실패");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 저장 (낙관적 업데이트)
  const save = useCallback(async (next: SalaryConfig) => {
    setConfig(next);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/salary-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }, []);

  return { config, setConfig, save, loading, saving, error };
}
