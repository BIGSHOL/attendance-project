import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireAuth } from "@/lib/apiAuth";

/**
 * GET /api/teacher-settings
 *   - 전체 조회 (인증 사용자)
 * GET /api/teacher-settings?staff_id=...
 *   - 단일 조회
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const staffId = searchParams.get("staff_id");

  if (staffId) {
    const { data, error } = await supabase
      .from("teacher_settings")
      .select("*")
      .eq("staff_id", staffId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data || { staff_id: staffId, blog_required: false });
  }

  const { data, error } = await supabase.from("teacher_settings").select("*");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

/**
 * POST /api/teacher-settings
 * body: { staff_id, blog_required }
 * 관리자 이상만
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if (!auth.ok) return auth.response;

  const body = await request.json();
  const { staff_id, blog_required } = body || {};

  if (!staff_id) {
    return NextResponse.json({ error: "staff_id 필수" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("teacher_settings")
    .upsert(
      {
        staff_id,
        blog_required: !!blog_required,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "staff_id" }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
