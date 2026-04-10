"use client";

import { useMemo } from "react";
import { getHolidaysForYear, type KoreanHoliday } from "@/lib/koreanHolidays";

/**
 * 해당 연도의 한국 공휴일을 반환한다.
 * 하드코딩 상수 기반 — ijw-calander 와 동일한 데이터를 사용.
 * 네트워크 호출/캐시 없음, 동기 반환.
 */
export function useHolidays(year: number) {
  const items: KoreanHoliday[] = useMemo(() => getHolidaysForYear(year), [year]);

  const dateSet = useMemo(() => new Set(items.map((h) => h.date)), [items]);

  const nameMap = useMemo(() => {
    const m = new Map<string, string>();
    items.forEach((h) => m.set(h.date, h.name));
    return m;
  }, [items]);

  return { items, dateSet, nameMap, loading: false };
}
