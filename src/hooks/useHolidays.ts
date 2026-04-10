"use client";

import { useEffect, useMemo, useState } from "react";

interface HolidayItem {
  date: string; // YYYY-MM-DD
  name: string;
}

/**
 * 해당 연도의 공휴일을 가져온다.
 * /api/holidays 가 Supabase 캐시 → data.go.kr 순으로 동작
 */
export function useHolidays(year: number) {
  const [items, setItems] = useState<HolidayItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/holidays?year=${year}`)
      .then(async (res) => {
        if (!res.ok) return [] as HolidayItem[];
        const body = await res.json();
        return Array.isArray(body) ? (body as HolidayItem[]) : [];
      })
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [year]);

  const dateSet = useMemo(() => new Set(items.map((h) => h.date)), [items]);
  const nameMap = useMemo(() => {
    const m = new Map<string, string>();
    items.forEach((h) => m.set(h.date, h.name));
    return m;
  }, [items]);

  return { items, dateSet, nameMap, loading };
}
