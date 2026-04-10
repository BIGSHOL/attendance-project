import { DAY_LABELS } from "@/types";

/** 해당 월의 모든 날짜 배열 반환 */
export function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const count = new Date(year, month, 0).getDate();
  for (let d = 1; d <= count; d++) {
    days.push(new Date(year, month - 1, d));
  }
  return days;
}

/** Date → "YYYY-MM-DD" */
export function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Date → { date: number, dayLabel: string, isSunday, isSaturday, isToday } */
export function formatDateDisplay(date: Date) {
  const dayIndex = date.getDay();
  const today = new Date();
  return {
    date: date.getDate(),
    dayLabel: DAY_LABELS[dayIndex],
    isSunday: dayIndex === 0,
    isSaturday: dayIndex === 6,
    isToday:
      today.getFullYear() === date.getFullYear() &&
      today.getMonth() === date.getMonth() &&
      today.getDate() === date.getDate(),
  };
}

/** "YYYY-MM" 형식 반환 */
export function getYearMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}
