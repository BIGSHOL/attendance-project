"use client";

import { useEffect, useState } from "react";
import type { Consultation } from "@/types";
import { cachedFetch, getCached } from "@/lib/fetchCache";

/**
 * 월별 상담 기록 조회 (ijw-calander의 student_consultations)
 *   - 입력은 ijw-calander가 전담, 여기선 읽기 전용
 *   - 월 전환 시 cachedFetch 캐시에 히트되어 전환 속도 빠름
 * @param month YYYY-MM 형식 (예: "2026-04")
 */
export function useConsultations(month: string) {
  const urlKey = `/api/consultations?month=${month}`;
  const cached = getCached<Consultation[]>(urlKey);
  const [consultations, setConsultations] = useState<Consultation[]>(cached ?? []);
  const [loading, setLoading] = useState(!cached);

  useEffect(() => {
    let cancelled = false;
    setLoading(!getCached<Consultation[]>(urlKey));
    (async () => {
      try {
        const data = await cachedFetch<Consultation[]>(urlKey);
        if (!cancelled) setConsultations(data);
      } catch (e) {
        console.error("[useConsultations]", e);
        if (!cancelled) setConsultations([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [urlKey]);

  return { consultations, loading };
}
