import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/apiAuth";

/**
 * DELETE /api/teacher-sheets/[teacherId]
 * 해당 선생님의 sheet 매핑 삭제 (관리자 이상)
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ teacherId: string }> }
) {
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if (!auth.ok) return auth.response;

  const { teacherId } = await params;
  const { error } = await supabase
    .from("teacher_sheets")
    .delete()
    .eq("teacher_id", teacherId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/**
 * PATCH /api/teacher-sheets/[teacherId]
 * last_synced_at 업데이트 (관리자 이상)
 */
export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ teacherId: string }> }
) {
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if (!auth.ok) return auth.response;

  const { teacherId } = await params;
  const { error } = await supabase
    .from("teacher_sheets")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("teacher_id", teacherId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
