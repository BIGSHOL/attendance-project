"use client";

import { useEffect, useState } from "react";
import type { Student } from "@/types";
import { cachedFetch, getCached } from "@/lib/fetchCache";

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

  return { students, loading };
}
