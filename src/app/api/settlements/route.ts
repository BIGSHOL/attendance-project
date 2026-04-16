import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/apiAuth";

/**
 * GET /api/settlements?year=2026&month=4
 * 특정 월의 모든 선생님 정산(monthly_settlements) 조회
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month"));
  if (!year || !month) {
    return NextResponse.json({ error: "year, month 필수" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("monthly_settlements")
    .select("*")
    .eq("year", year)
    .eq("month", month);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}
