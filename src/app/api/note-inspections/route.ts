import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/apiAuth";
import type { NoteInspection, NoteInspectionStatus } from "@/types";

type Row = {
  id: string;
  student_id: string;
  student_name: string;
  teacher_name: string;
  date: string;
  status: NoteInspectionStatus;
  memo: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

function rowToInspection(r: Row): NoteInspection {
  return {
    id: r.id,
    studentId: r.student_id,
    studentName: r.student_name,
    teacherName: r.teacher_name,
    date: r.date,
    status: r.status,
    memo: r.memo ?? undefined,
    createdBy: r.created_by ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const VALID_STATUS: NoteInspectionStatus[] = ["done", "needs_fix", "missing"];

/**
 * GET /api/note-inspections?month=YYYY-MM
 *   지정 월의 노트 검사 이벤트 전체 반환 (최신일자순)
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json(
      { error: "month 파라미터는 YYYY-MM 형식" },
      { status: 400 }
    );
  }
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const start = `${month}-01`;
  const end = `${month}-${String(lastDay).padStart(2, "0")}`;

  const { data, error } = await supabase
    .from("note_inspections")
    .select("*")
    .gte("date", start)
    .lte("date", end)
    .order("date", { ascending: false });

  if (error) {
    console.error("[GET /api/note-inspections]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const inspections = (data as Row[]).map(rowToInspection);
  return NextResponse.json(inspections);
}

/**
 * POST /api/note-inspections
 *   body: { studentId, studentName, teacherName, date, status, memo? }
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth.response;

  let body: {
    studentId?: string;
    studentName?: string;
    teacherName?: string;
    date?: string;
    status?: string;
    memo?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문" }, { status: 400 });
  }

  const { studentId, studentName, teacherName, date, status, memo } = body;
  if (!studentId || !studentName || !teacherName || !date) {
    return NextResponse.json(
      { error: "studentId/studentName/teacherName/date 모두 필수" },
      { status: 400 }
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date 는 YYYY-MM-DD 형식" }, { status: 400 });
  }
  const resolvedStatus = (status || "done") as NoteInspectionStatus;
  if (!VALID_STATUS.includes(resolvedStatus)) {
    return NextResponse.json({ error: "status 유효값 아님" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("note_inspections")
    .insert({
      student_id: studentId,
      student_name: studentName,
      teacher_name: teacherName,
      date,
      status: resolvedStatus,
      memo: memo ?? null,
      created_by: auth.email ?? null,
    })
    .select("*")
    .single();

  if (error) {
    console.error("[POST /api/note-inspections]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(rowToInspection(data as Row), { status: 201 });
}
