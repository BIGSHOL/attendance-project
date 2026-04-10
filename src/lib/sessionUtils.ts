import type { SessionPeriod, DateRange } from "@/types";
import { formatDateKey } from "./date";

/**
 * 특정 날짜가 세션 범위에 포함되는지 확인
 * @param dateKey "YYYY-MM-DD"
 */
export function isDateInSession(dateKey: string, session: SessionPeriod): boolean {
  return session.ranges.some(
    (r) => dateKey >= r.startDate && dateKey <= r.endDate
  );
}

/**
 * 세션 범위를 날짜 배열로 확장
 * 여러 범위를 합쳐 중복 제거 후 정렬
 */
export function expandSessionDates(session: SessionPeriod): Date[] {
  const set = new Set<string>();
  for (const range of session.ranges) {
    const start = parseDateKey(range.startDate);
    const end = parseDateKey(range.endDate);
    const cursor = new Date(start);
    while (cursor <= end) {
      set.add(formatDateKey(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return Array.from(set)
    .sort()
    .map(parseDateKey);
}

/**
 * "YYYY-MM-DD" → Date (로컬 타임존)
 */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * 세션 범위 표시용 문자열 생성
 * 예) "3/6~3/20, 3/25~4/5"
 */
export function formatSessionRanges(session: SessionPeriod): string {
  return session.ranges
    .map((r) => {
      const s = parseDateKey(r.startDate);
      const e = parseDateKey(r.endDate);
      return `${s.getMonth() + 1}/${s.getDate()}~${e.getMonth() + 1}/${e.getDate()}`;
    })
    .join(", ");
}

/**
 * 세션 요약 텍스트 (드롭다운용)
 * 예) "3월 세션 (3/6~3/20, 3/25~4/5) · 12회"
 */
export function formatSessionLabel(session: SessionPeriod): string {
  return `${session.month}월 세션 (${formatSessionRanges(session)}) · ${session.sessions}회`;
}

/**
 * 겹치는 날짜 범위 병합 (정렬 + 통합)
 */
export function mergeOverlappingRanges(ranges: DateRange[]): DateRange[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) =>
    a.startDate.localeCompare(b.startDate)
  );
  const result: DateRange[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = result[result.length - 1];
    const current = sorted[i];
    if (current.startDate <= addOneDay(last.endDate)) {
      // 연속 또는 겹침 → 병합
      if (current.endDate > last.endDate) {
        last.endDate = current.endDate;
      }
    } else {
      result.push(current);
    }
  }
  return result;
}

function addOneDay(dateKey: string): string {
  const d = parseDateKey(dateKey);
  d.setDate(d.getDate() + 1);
  return formatDateKey(d);
}
