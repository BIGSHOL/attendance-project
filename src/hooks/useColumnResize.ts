import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 일자 컬럼 폭 드래그 리사이즈 hook (audit H).
 *   thead 핸들 mousedown → document mousemove 트래킹 → mouseup 종료.
 *   드래그 중 cursor / userSelect 시각화 + onColumnResize 콜백.
 *
 * AttendanceTable.tsx 의 isResizing + handleResizeStart + useEffect 묶음을
 * 그대로 옮긴 것 (split-only). 동작 100% 동일.
 *
 * 키보드 이벤트와 무관 (mouse 만 사용) → cell selection / drag fill / undo
 * 와 격리되어 있어 안전하게 추출 가능.
 */
export function useColumnResize(args: {
  cellWidthPx: number;
  onColumnResize?: (px: number) => void;
}) {
  const { cellWidthPx, onColumnResize } = args;

  const resizingRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      if (!onColumnResize) return;
      e.preventDefault();
      e.stopPropagation();
      resizingRef.current = { startX: e.clientX, startWidth: cellWidthPx };
      setIsResizing(true);
    },
    [cellWidthPx, onColumnResize]
  );

  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: MouseEvent) => {
      const r = resizingRef.current;
      if (!r) return;
      const delta = e.clientX - r.startX;
      onColumnResize?.(r.startWidth + delta);
    };
    const onUp = () => {
      resizingRef.current = null;
      setIsResizing(false);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    // 드래그 중 텍스트 선택/cursor 변경
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, onColumnResize]);

  return { isResizing, handleResizeStart };
}
