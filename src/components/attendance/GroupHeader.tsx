"use client";

import { memo } from "react";

interface Props {
  groupName: string;
  studentCount: number;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  colSpan: number;
}

function GroupHeaderImpl({
  groupName,
  studentCount,
  isCollapsed,
  onToggleCollapse,
  onMoveUp,
  onMoveDown,
  colSpan,
}: Props) {
  return (
    <tr
      onClick={onToggleCollapse}
      className="bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 cursor-pointer select-none"
    >
      <td colSpan={colSpan} className="p-0">
        <div className="sticky left-0 z-[5] flex items-center gap-2 px-2 py-1.5 bg-slate-100 dark:bg-zinc-800 w-fit max-w-[calc(100vw-40px)]">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            <span className="text-[12px]">{isCollapsed ? "▶" : "▼"}</span>
            <span>{isCollapsed ? "📁" : "📂"}</span>
            <span>{groupName || "미분류"}</span>
            <span className="font-normal text-zinc-400">({studentCount}명)</span>
          </div>

          {onMoveUp && onMoveDown && (
            <div className="flex gap-0.5 ml-auto">
              <button
                onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
                className="rounded px-1 py-0.5 text-[12px] text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600"
              >
                ▲
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
                className="rounded px-1 py-0.5 text-[12px] text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600"
              >
                ▼
              </button>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

const GroupHeader = memo(GroupHeaderImpl);
export default GroupHeader;
