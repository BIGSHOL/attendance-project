"use client";

import { useEffect, useState } from "react";

/**
 * 화면 너비 기반 모바일 감지 — Tailwind md (768px) breakpoint 기준.
 *   matchMedia 로 resize 이벤트 자동 추적.
 *   SSR 시 false 반환 후 클라이언트에서 갱신.
 */
export function useIsMobile(breakpointPx: number = 768): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`);
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [breakpointPx]);

  return isMobile;
}
