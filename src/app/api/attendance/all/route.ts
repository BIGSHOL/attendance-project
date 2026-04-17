import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/apiAuth";

/**
 * GET /api/attendance/all?year=2026&month=4
 *   또는 /api/attendance/all?startDate=2026-03-06&endDate=2026-04-02
 * 기간 내 모든 선생님 출석 기록 조회.
 * startDate/endDate 가 주어지면 그 범위로 조회 (세션 기반 급여용).
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const overrideStart = searchParams.get("startDate");
  const overrideEnd = searchParams.get("endDate");

  let startDate: string;
  let endDate: string;
  if (overrideStart && overrideEnd) {
    startDate = overrideStart;
    endDate = overrideEnd;
  } else {
    const year = Number(searchParams.get("year"));
    const month = Number(searchParams.get("month"));
    if (!year || !month) {
      return NextResponse.json(
        { error: "year+month 또는 startDate+endDate 필수" },
        { status: 400 }
      );
    }
    startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  }

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
  console.log(`[attendance/all] ${startDate}~${endDate} returned=${accumulated.length}`);
  return NextResponse.json(accumulated);
}
