/**
 * 정산 페이지 상단의 통계 카드 — 라벨 + 값 + (옵션) highlight.
 *
 * SettlementPage.tsx 에서 분리됨 — 동작 변경 없음.
 */
export default function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className={`border border-zinc-200 px-4 py-3 dark:border-zinc-800 ${highlight ? "bg-blue-50 dark:bg-blue-950" : "bg-white dark:bg-zinc-900"}`}>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className={`mt-1 text-lg font-bold ${highlight ? "text-blue-600 dark:text-blue-400" : "text-zinc-900 dark:text-zinc-100"}`}>
        {value}
      </p>
    </div>
  );
}
