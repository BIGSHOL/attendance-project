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
 * PATCH /api/note-inspections/:id
 *   body: { status?, memo?, date?, teacherName? }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  let body: {
    status?: string;
    memo?: string | null;
    date?: string;
    teacherName?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.status !== undefined) {
    if (!VALID_STATUS.includes(body.status as NoteInspectionStatus)) {
      return NextResponse.json({ error: "status 유효값 아님" }, { status: 400 });
    }
    patch.status = body.status;
  }
  if (body.memo !== undefined) patch.memo = body.memo;
  if (body.date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return NextResponse.json({ error: "date 는 YYYY-MM-DD 형식" }, { status: 400 });
    }
    patch.date = body.date;
  }
  if (body.teacherName !== undefined) patch.teacher_name = body.teacherName;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "변경 사항 없음" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("note_inspections")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    console.error("[PATCH /api/note-inspections/:id]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(rowToInspection(data as Row));
}

/**
 * DELETE /api/note-inspections/:id
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const { error } = await supabase.from("note_inspections").delete().eq("id", id);

  if (error) {
    console.error("[DELETE /api/note-inspections/:id]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
