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

  // PostgREST 의 기본 max-rows=1000 제한을 페이지네이션으로 우회.
  const pageSize = 1000;
  type Row = {
    id: string;
    teacher_id: string;
    student_id: string;
    class_name: string;
    date: string;
    hours: number;
    memo: string;
    cell_color: string;
    homework: boolean;
    is_makeup: boolean;
  };
  const columns =
    "id, teacher_id, student_id, class_name, date, hours, memo, cell_color, homework, is_makeup";
  const accumulated: Row[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("attendance")
      .select(columns)
      .gte("date", startDate)
      .lte("date", endDate)
      .range(offset, offset + pageSize - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    accumulated.push(...(data as Row[]));
    if (data.length < pageSize) break;
  }
  console.log(`[attendance/all] ${year}.${month} returned=${accumulated.length}`);
  return NextResponse.json(accumulated);
}
