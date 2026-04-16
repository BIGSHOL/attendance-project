import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/apiAuth";

/**
 * GET /api/attendance/yearly?year=2026
 * 특정 연도의 출석 기록 (hours > 0) 조회
 * 선생님별 재원 학생 집계에 사용
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const year = Number(searchParams.get("year"));
  if (!year) {
    return NextResponse.json({ error: "year 필수" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("attendance")
    .select("teacher_id, student_id, date, hours")
    .gte("date", `${year}-01-01`)
    .lte("date", `${year}-12-31`)
    .gt("hours", 0);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}
