"use client";

interface Props {
  groupName: string;
  studentCount: number;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  colSpan: number;
}

export default function GroupHeader({
  groupName,
  studentCount,
  isCollapsed,
  onToggleCollapse,
  onMoveUp,
  onMoveDown,
  colSpan,
}: Props) {
  return (
    <tr className="bg-slate-100 dark:bg-zinc-800">
      <td colSpan={colSpan} className="px-2 py-1.5">
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleCollapse}
            className="flex items-center gap-1.5 text-sm font-semibold text-zinc-700 hover:text-zinc-900 dark:text-zinc-300"
          >
            <span className="text-[12px]">{isCollapsed ? "▶" : "▼"}</span>
            <span>{isCollapsed ? "📁" : "📂"}</span>
            <span>{groupName || "미분류"}</span>
            <span className="font-normal text-zinc-400">({studentCount}명)</span>
          </button>

          {onMoveUp && onMoveDown && (
            <div className="flex gap-0.5 ml-auto">
              <button
                onClick={onMoveUp}
                className="rounded px-1 py-0.5 text-[12px] text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600"
              >
                ▲
              </button>
              <button
                onClick={onMoveDown}
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
