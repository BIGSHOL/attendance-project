"use client";

import { type CSSProperties, type ReactNode } from "react";

/**
 * 로딩 상태 표시용 스켈레톤
 *   - CLAUDE.md 규칙: rounded-sm 이하
 *   - animate-pulse + 중성 회색 박스로 레이아웃 점유 유지
 */

interface SkeletonProps {
  className?: string;
  style?: CSSProperties;
}

/** 기본 박스 — 크기는 className으로 조절 */
export function Skeleton({ className = "", style }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded-sm bg-zinc-200 dark:bg-zinc-800 ${className}`}
      style={style}
      aria-hidden="true"
    />
  );
}

/** 여러 줄 텍스트 모양 */
export function SkeletonText({
  lines = 1,
  widths,
  className = "",
}: {
  lines?: number;
  widths?: string[]; // 예: ["80%", "60%"]
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-3"
          style={{ width: widths?.[i] ?? (i === lines - 1 ? "60%" : "100%") }}
        />
      ))}
    </div>
  );
}

/** KPI 카드 모양 (작은 박스 + 숫자 박스) */
export function SkeletonKpi({ className = "" }: { className?: string }) {
  return (
    <div
      className={`border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
    >
      <Skeleton className="mb-1.5 h-2.5 w-16" />
      <Skeleton className="h-5 w-20" />
    </div>
  );
}

/** 카드 — 제목 + 본문 */
export function SkeletonCard({
  title = true,
  lines = 3,
  className = "",
}: {
  title?: boolean;
  lines?: number;
  className?: string;
}) {
  return (
    <div
      className={`border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
    >
      {title && <Skeleton className="mb-3 h-4 w-28" />}
      <SkeletonText lines={lines} />
    </div>
  );
}

/** 표 형태 — 지정한 행/열 수로 렌더 */
export function SkeletonTable({
  rows = 6,
  cols = 5,
  withHeader = true,
  className = "",
}: {
  rows?: number;
  cols?: number;
  withHeader?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
    >
      <table className="w-full text-sm">
        {withHeader && (
          <thead className="bg-zinc-50 dark:bg-zinc-800/50">
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              {Array.from({ length: cols }).map((_, i) => (
                <th key={i} className="px-3 py-2.5 text-left">
                  <Skeleton className="h-3 w-16" />
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr
              key={r}
              className="border-b border-zinc-100 dark:border-zinc-800 last:border-b-0"
            >
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c} className="px-3 py-2.5">
                  <Skeleton
                    className="h-3"
                    style={{ width: c === 0 ? "60%" : c === cols - 1 ? "40%" : "80%" }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 페이지 전체 로딩 — 헤더 + 툴바 + 본문 */
export function SkeletonPage({
  children,
  className = "",
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-4 ${className}`}>
      {children ?? (
        <>
          <div className="flex items-center gap-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-32" />
          </div>
          <SkeletonTable rows={8} cols={5} />
        </>
      )}
    </div>
  );
}
