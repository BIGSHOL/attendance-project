/**
 * 정산 테이블 헤더의 정렬 가능 셀 — 라벨 + 정렬 화살표 + onClick.
 *
 * SettlementPage.tsx 에서 분리됨 — 동작 변경 없음.
 */
export default function SortableTh<K extends string>({
  label,
  sortKey,
  current,
  dir,
  onClick,
  align = "left",
}: {
  label: string;
  sortKey: K;
  current: K | "";
  dir: "asc" | "desc";
  onClick: (k: K) => void;
  align?: "left" | "right" | "center";
}) {
  const active = current === sortKey;
  const arrow = active ? (dir === "asc" ? "▲" : "▼") : "";
  const alignCls =
    align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  const justifyCls =
    align === "right"
      ? "justify-end"
      : align === "center"
        ? "justify-center"
        : "justify-start";
  return (
    <th className={`px-3 py-3 font-medium text-zinc-500 ${alignCls}`}>
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        className={`inline-flex w-full items-center gap-1 ${justifyCls} hover:text-zinc-900 dark:hover:text-zinc-100 ${
          active ? "text-zinc-900 dark:text-zinc-100" : ""
        }`}
      >
        <span>{label}</span>
        {arrow && (
          <span className="text-[10px] text-blue-500 dark:text-blue-400">{arrow}</span>
        )}
      </button>
    </th>
  );
}
