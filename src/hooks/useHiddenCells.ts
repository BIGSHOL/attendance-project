"use client";

import { useCallback, useMemo } from "react";
import { useLocalStorage } from "./useLocalStorage";

/**
 * 출석부의 숨긴 열(날짜) / 행(학생) 관리
 * 선생님별, 월별로 분리 저장
 */
export function useHiddenCells(teacherId: string, year: number, month: number) {
  const ymKey = `${year}-${String(month).padStart(2, "0")}`;
  const key = teacherId || "none";

  const [hiddenDates, setHiddenDates] = useLocalStorage<Record<string, string[]>>(
    `attendance.hiddenDates.${key}`,
    {}
  );
  const [hiddenStudents, setHiddenStudents] = useLocalStorage<Record<string, string[]>>(
    `attendance.hiddenStudents.${key}`,
    {}
  );

  const hiddenDateSet = useMemo(() => new Set(hiddenDates[ymKey] || []), [hiddenDates, ymKey]);
  const hiddenStudentSet = useMemo(() => new Set(hiddenStudents[ymKey] || []), [hiddenStudents, ymKey]);

  const hideDate = useCallback(
    (dateKey: string) => {
      setHiddenDates((prev) => {
        const cur = new Set(prev[ymKey] || []);
        cur.add(dateKey);
        return { ...prev, [ymKey]: Array.from(cur) };
      });
    },
    [setHiddenDates, ymKey]
  );

  const hideStudent = useCallback(
    (studentId: string) => {
      setHiddenStudents((prev) => {
        const cur = new Set(prev[ymKey] || []);
        cur.add(studentId);
        return { ...prev, [ymKey]: Array.from(cur) };
      });
    },
    [setHiddenStudents, ymKey]
  );

  const showAllDates = useCallback(() => {
    setHiddenDates((prev) => ({ ...prev, [ymKey]: [] }));
  }, [setHiddenDates, ymKey]);

  const showAllStudents = useCallback(() => {
    setHiddenStudents((prev) => ({ ...prev, [ymKey]: [] }));
  }, [setHiddenStudents, ymKey]);

  return {
    hiddenDateSet,
    hiddenStudentSet,
    hideDate,
    hideStudent,
    showAllDates,
    showAllStudents,
  };
}
