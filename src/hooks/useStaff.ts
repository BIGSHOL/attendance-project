"use client";

import { useEffect, useState } from "react";
import type { Teacher } from "@/types";

export function useStaff() {
  const [staff, setStaff] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/staff", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Teacher[];
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

  const teachers = staff.filter(
    (s) => s.role === "teacher" || s.role === "강사"
  );

  return { staff, teachers, loading };
}
