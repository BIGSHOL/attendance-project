import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/apiAuth";
import { logAuditSafe } from "@/lib/audit";

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

  const { data: before } = await supabase
    .from("payments")
    .select("*")
    .eq("id", id)
    .single();

  const { data: after, error } = await supabase
    .from("payments")
    .update({
      ...updates,
      updated_at: nowIso,
      edited_by: auth.email,
      edited_at: nowIso,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  logAuditSafe(supabase, {
    table: "payments",
    recordId: id,
    action: "update",
    before: before as Record<string, unknown> | null,
    after: after as Record<string, unknown> | null,
    editedBy: auth.email,
  });

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

  const { data: before } = await supabase
    .from("payments")
    .select("*")
    .eq("id", id)
    .single();

  const { error } = await supabase.from("payments").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  logAuditSafe(supabase, {
    table: "payments",
    recordId: id,
    action: "delete",
    before: before as Record<string, unknown> | null,
    editedBy: auth.email,
  });

  return NextResponse.json({ success: true });
}
