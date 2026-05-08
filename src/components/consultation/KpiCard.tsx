/**
 * 상담 페이지 V1 의 KPI 카드 — 라벨 + 숫자 + 톤(neutral/good/warn/alert).
 *
 * ConsultationsPage.tsx 에서 분리됨 — 동작 변경 없음.
 */
export default function KpiCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warn" | "alert";
}) {
  const toneClass = {
    neutral:
      "border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100",
    good: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/50 dark:text-emerald-200",
    warn: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-200",
    alert:
      "border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-200",
  }[tone];

  return (
    <div className={`border ${toneClass} px-3 py-2`}>
      <div className="text-[10px] font-medium opacity-70">{label}</div>
      <div className="text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}
