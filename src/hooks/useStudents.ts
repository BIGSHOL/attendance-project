"use client";

import { useCallback, useEffect, useState } from "react";
import type { Student } from "@/types";
import { cachedFetch, getCached, invalidateCache } from "@/lib/fetchCache";

const URL_KEY = "/api/students";

export function useStudents() {
  const cached = getCached<Student[]>(URL_KEY);
  const [students, setStudents] = useState<Student[]>(cached ?? []);
  const [loading, setLoading] = useState(!cached);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await cachedFetch<Student[]>(URL_KEY);
        if (!cancelled) setStudents(data);
      } catch (e) {
        console.error("[useStudents]", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // sync 후 virtual_students 가 업데이트 되었을 때 캐시 무효화 + 재조회
  const refetch = useCallback(async () => {
    invalidateCache(URL_KEY);
    try {
      const data = await cachedFetch<Student[]>(URL_KEY);
      setStudents(data);
    } catch (e) {
      console.error("[useStudents refetch]", e);
    }
  }, []);

  return { students, loading, refetch };
}
