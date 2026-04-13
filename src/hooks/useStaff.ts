"use client";

import { useEffect, useMemo, useState } from "react";
import type { Teacher } from "@/types";
import { cachedFetch, getCached } from "@/lib/fetchCache";

const URL_KEY = "/api/staff";

export function useStaff() {
  // 캐시에 있으면 초기값으로 즉시 사용 — 페이지 전환 시 로딩 깜빡임 제거
  const cached = getCached<Teacher[]>(URL_KEY);
  const [staff, setStaff] = useState<Teacher[]>(cached ?? []);
  const [loading, setLoading] = useState(!cached);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await cachedFetch<Teacher[]>(URL_KEY);
        if (!cancelled) setStaff(data);
      } catch (e) {
        console.error("[useStaff]", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const teachers = useMemo(
    () => staff.filter((s) => s.role === "teacher" || s.role === "강사"),
    [staff]
  );

  return { staff, teachers, loading };
}
