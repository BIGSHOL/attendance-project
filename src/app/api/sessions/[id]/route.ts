import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/apiAuth";
import { logAuditSafe } from "@/lib/audit";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if (!auth.ok) return auth.response;

  const { data: before } = await supabase
    .from("session_periods")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("session_periods").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logAuditSafe(supabase, {
    table: "session_periods",
    recordId: id,
    action: "delete",
    before: before as Record<string, unknown> | null,
    editedBy: auth.email,
  });

  return NextResponse.json({ success: true });
}
