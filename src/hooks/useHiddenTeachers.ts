"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "attendance_hidden_teachers";

/**
 * 출석부에서 숨김 처리된 선생님 ID 관리
 * localStorage에 저장 (추후 Supabase로 이관 가능)
 */
export function useHiddenTeachers() {
  const [hiddenTeacherIds, setHiddenTeacherIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setHiddenTeacherIds(new Set(JSON.parse(stored)));
      }
    } catch {
      // 무시
    }
  }, []);

  const persist = (ids: Set<string>) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(ids)));
  };

  const toggleHidden = useCallback((teacherId: string) => {
    setHiddenTeacherIds((prev) => {
      const next = new Set(prev);
      if (next.has(teacherId)) {
        next.delete(teacherId);
      } else {
        next.add(teacherId);
      }
      persist(next);
      return next;
    });
  }, []);

  const isHidden = useCallback(
    (teacherId: string) => hiddenTeacherIds.has(teacherId),
    [hiddenTeacherIds]
  );

  return { hiddenTeacherIds, toggleHidden, isHidden };
}
