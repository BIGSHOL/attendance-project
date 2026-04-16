import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireMaster } from "@/lib/apiAuth";

/**
 * PATCH /api/admin/user-roles/[id]
 * user_roles 수정 (역할, 급여유형, 스태프 매핑 등)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const patch = (await request.json()) as Record<string, unknown>;

  const { error } = await supabase
    .from("user_roles")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/admin/user-roles/[id]
 * user_roles 삭제 (마스터만)
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const auth = await requireMaster(supabase);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const { error } = await supabase.from("user_roles").delete().eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
