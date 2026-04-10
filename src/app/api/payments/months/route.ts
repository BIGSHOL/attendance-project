import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { searchParams } = new URL(request.url);
  const summary = searchParams.get("summary");

  const { data, error } = await supabase
    .from("payments")
    .select("billing_month, charge_amount, paid_amount");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 월별 집계
  const monthMap = new Map<string, { count: number; total_charge: number; total_paid: number }>();
  for (const r of data || []) {
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
