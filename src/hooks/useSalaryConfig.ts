"use client";

import { useCallback, useEffect, useState } from "react";
import { INITIAL_SALARY_CONFIG } from "@/types";
import type { SalaryConfig } from "@/types";

/**
 * 전체 공통 급여 설정 로드/저장 (Supabase 영속화)
 * 서버에 저장된 값이 없으면 INITIAL_SALARY_CONFIG 사용
 */
export function useSalaryConfig() {
  const [config, setConfig] = useState<SalaryConfig>(INITIAL_SALARY_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 초기 로드
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/salary-config", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        if (data?.config) setConfig(data.config as SalaryConfig);
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
