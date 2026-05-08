"use client";

import { useEffect, useMemo, useState } from "react";
import type { Teacher } from "@/types";
import { cachedFetch, getCached } from "@/lib/fetchCache";

interface UseStaffOptions {
  /**
   * true 면 /api/staff/archived 호출 → status !== "active" 만 반환.
   * /admin/archive 보관함 페이지에서 AttendancePage 를 archiveMode 로 재사용 시 사용.
   */
  archived?: boolean;
}

export function useStaff(options?: UseStaffOptions) {
  const url = options?.archived ? "/api/staff/archived" : "/api/staff";
  // 캐시에 있으면 초기값으로 즉시 사용 — 페이지 전환 시 로딩 깜빡임 제거
  const cached = getCached<Teacher[]>(url);
  const [staff, setStaff] = useState<Teacher[]>(cached ?? []);
  const [loading, setLoading] = useState(!cached);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await cachedFetch<Teacher[]>(url);
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
  }, [url]);

  const teachers = useMemo(
    () => staff.filter((s) => s.role === "teacher" || s.role === "강사"),
    [staff]
  );

  return { staff, teachers, loading };
}
