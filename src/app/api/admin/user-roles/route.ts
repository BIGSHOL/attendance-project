import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/apiAuth";

/**
 * GET /api/admin/user-roles
 * 전체 user_roles 목록 조회 (관리자 이상만)
 */
export async function GET() {
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if (!auth.ok) return auth.response;

  const { data, error } = await supabase
    .from("user_roles")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}
