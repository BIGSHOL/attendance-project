import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/apiAuth";

interface AttendanceUpsertBody {
  teacher_id: string;
  student_id: string;
  /** 분반 구분 (예: "화,금" / "토"). 단일 분반이면 빈 문자열. */
  class_name?: string;
  date: string;
  hours?: number | null;
  memo?: string;
  cell_color?: string | null;
  homework?: boolean;
}

/**
 * GET /api/attendance?teacher_id=...&year=2026&month=4
 * 특정 선생님의 한 달 출석 기록 조회
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const teacherId = searchParams.get("teacher_id");
  const overrideStart = searchParams.get("startDate");
  const overrideEnd = searchParams.get("endDate");
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month"));

  if (!teacherId) {
    return NextResponse.json({ error: "teacher_id 필수" }, { status: 400 });
  }

  let startDate: string;
  let endDate: string;
  if (overrideStart && overrideEnd) {
    startDate = overrideStart;
    endDate = overrideEnd;
  } else {
    if (!year || !month) {
      return NextResponse.json(
        { error: "year, month 또는 startDate, endDate 필수" },
        { status: 400 }
      );
    }
    startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  }

  // PostgREST max-rows=1000 제한 우회용 페이지네이션
  const pageSize = 1000;
  const accumulated: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("attendance")
      .select("*")
      .eq("teacher_id", teacherId)
      .gte("date", startDate)
      .lte("date", endDate)
      .range(offset, offset + pageSize - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    accumulated.push(...data);
    if (data.length < pageSize) break;
  }
  return NextResponse.json(accumulated);
}

/**
 * PATCH /api/attendance
 * 단일 출석 셀 upsert/삭제 — 필드 조합(hours/memo/cell_color/homework) 자유
 * hours === null 이면 셀 삭제
 */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as AttendanceUpsertBody;
  const { teacher_id, student_id, date } = body;
  const class_name = body.class_name ?? "";

  if (!teacher_id || !student_id || !date) {
    return NextResponse.json(
      { error: "teacher_id, student_id, date 필수" },
      { status: 400 }
    );
  }

  // 기존 행 조회 (class_name 포함)
  const { data: existing } = await supabase
    .from("attendance")
    .select("*")
    .eq("teacher_id", teacher_id)
    .eq("student_id", student_id)
    .eq("class_name", class_name)
    .eq("date", date)
    .maybeSingle();

  // 삭제 케이스: hours === null + 다른 값 없음
  if (
    body.hours === null &&
    body.memo === undefined &&
    body.cell_color === undefined &&
    body.homework === undefined
  ) {
    if (existing) {
      const { error } = await supabase
        .from("attendance")
        .delete()
        .eq("id", existing.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, deleted: true });
  }

  const nowIso = new Date().toISOString();

  if (existing) {
    const updates: Record<string, unknown> = { updated_at: nowIso };
    if (body.hours !== undefined) updates.hours = body.hours ?? 0;
    if (body.memo !== undefined) updates.memo = body.memo;
    if (body.cell_color !== undefined) updates.cell_color = body.cell_color ?? "";
    if (body.homework !== undefined) updates.homework = body.homework;

    const { data, error } = await supabase
      .from("attendance")
      .update(updates)
      .eq("id", existing.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  // 신규 삽입
  const insertRow = {
    teacher_id,
    student_id,
    class_name,
    date,
    hours: body.hours ?? 0,
    memo: body.memo ?? "",
    cell_color: body.cell_color ?? "",
    homework: body.homework ?? false,
    is_makeup: false,
  };

  const { data, error } = await supabase
    .from("attendance")
    .insert(insertRow)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
