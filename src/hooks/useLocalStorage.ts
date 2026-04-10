"use client";

import { useState, useEffect, useCallback } from "react";

/**
 * 로컬 스토리지와 동기화되는 useState
 * - SSR 안전: 초기값은 defaultValue, 마운트 후 localStorage에서 로드
 * - hydrated 플래그로 race condition 방지 (로드 전에 저장되어 덮어쓰는 문제)
 */
export function useLocalStorage<T>(key: string, defaultValue: T) {
  const [value, setValue] = useState<T>(defaultValue);
  const [hydrated, setHydrated] = useState(false);

  // 초기 로드 (1회)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) {
        setValue(JSON.parse(stored));
      }
    } catch {
      // 무시
    }
    setHydrated(true);
  }, [key]);

  // 변경 시 저장 — hydrated 이후부터
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // 무시
    }
  }, [key, value, hydrated]);

  return [value, setValue] as const;
}

/**
 * Set 전용 로컬 스토리지 훅
 */
export function useLocalStorageSet(key: string, defaultValue: Set<string> = new Set()) {
  const [array, setArray] = useLocalStorage<string[]>(key, Array.from(defaultValue));

  const set = new Set(array);
  const setAsSet = useCallback(
    (next: Set<string>) => setArray(Array.from(next)),
    [setArray]
  );

  return [set, setAsSet] as const;
}
