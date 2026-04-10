import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/apiAuth";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if (!auth.ok) return auth.response;

  const updates = await request.json();
  const nowIso = new Date().toISOString();

  // 변경 이력 기록용 — 기존 행 스냅샷
  const { data: before } = await supabase
    .from("payments")
    .select("*")
    .eq("id", id)
    .single();

  const { error } = await supabase
    .from("payments")
    .update({
      ...updates,
      updated_at: nowIso,
      edited_by: auth.email,
      edited_at: nowIso,
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 변경된 필드만 diff 로 남기기
  if (before) {
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [k, v] of Object.entries(updates)) {
      if ((before as Record<string, unknown>)[k] !== v) {
        changes[k] = { from: (before as Record<string, unknown>)[k], to: v };
      }
    }
    if (Object.keys(changes).length > 0) {
      await supabase.from("payment_edits").insert({
        payment_id: id,
        edited_by: auth.email,
        edited_at: nowIso,
        changes,
      });
    }
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if (!auth.ok) return auth.response;

  const { error } = await supabase.from("payments").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
