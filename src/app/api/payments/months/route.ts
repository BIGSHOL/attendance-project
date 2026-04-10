import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * PostgREST 기본 1,000건 제한을 우회하기 위해 1,000건씩 페이지네이션으로 전체 조회
 */
async function fetchAllPaymentsSummaryRows(
  supabase: Awaited<ReturnType<typeof createClient>>
) {
  const pageSize = 1000;
  type Row = { billing_month: string; charge_amount: number; paid_amount: number };
  const all: Row[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("payments")
      .select("billing_month, charge_amount, paid_amount")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...(data as Row[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { searchParams } = new URL(request.url);
  const summary = searchParams.get("summary");

  let rows;
  try {
    rows = await fetchAllPaymentsSummaryRows(supabase);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  // 월별 집계
  const monthMap = new Map<string, { count: number; total_charge: number; total_paid: number }>();
  for (const r of rows) {
    const m = r.billing_month;
    const existing = monthMap.get(m) || { count: 0, total_charge: 0, total_paid: 0 };
    existing.count += 1;
    existing.total_charge += Number(r.charge_amount) || 0;
    existing.total_paid += Number(r.paid_amount) || 0;
    monthMap.set(m, existing);
  }

  const result = Array.from(monthMap.entries())
    .map(([month, stats]) => ({ month, ...stats }))
    .sort((a, b) => b.month.localeCompare(a.month));

  if (summary) {
    return NextResponse.json(result);
  }

  return NextResponse.json(result.map((r) => r.month));
}
