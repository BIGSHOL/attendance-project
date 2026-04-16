import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/apiAuth";

/**
 * GET /api/attendance/all?year=2026&month=4
 * 특정 월의 모든 선생님 출석 기록 조회
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month"));
  if (!year || !month) {
    return NextResponse.json(
      { error: "year, month 필수" },
      { status: 400 }
    );
  }

  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const { data, error } = await supabase
    .from("attendance")
    .select("id, teacher_id, student_id, date, hours, memo, cell_color, homework, is_makeup")
    .gte("date", startDate)
    .lte("date", endDate);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}
