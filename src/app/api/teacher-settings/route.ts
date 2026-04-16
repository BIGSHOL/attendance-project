import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireAuth } from "@/lib/apiAuth";
import { logAuditSafe } from "@/lib/audit";

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
    return NextResponse.json(
      data || {
        staff_id: staffId,
        blog_required: false,
        salary_type: "commission",
        commission_days: [],
        ratios: {},
      }
    );
  }

  const { data, error } = await supabase.from("teacher_settings").select("*");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

/**
 * POST /api/teacher-settings
 * body: { staff_id, blog_required?, salary_type?, commission_days? }
 * - 전달된 필드만 부분 업데이트 (기존 값 유지)
 * 관리자 이상만
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if (!auth.ok) return auth.response;

  const body = await request.json();
  const { staff_id, blog_required, salary_type, commission_days, ratios } = body || {};

  if (!staff_id) {
    return NextResponse.json({ error: "staff_id 필수" }, { status: 400 });
  }
  if (salary_type && !["commission", "fixed", "mixed"].includes(salary_type)) {
    return NextResponse.json({ error: "잘못된 salary_type" }, { status: 400 });
  }

  // 기존 row 조회 후 partial merge
  const { data: existing } = await supabase
    .from("teacher_settings")
    .select("*")
    .eq("staff_id", staff_id)
    .maybeSingle();

  const merged = {
    staff_id,
    blog_required:
      blog_required !== undefined ? !!blog_required : !!existing?.blog_required,
    salary_type:
      salary_type !== undefined
        ? salary_type
        : existing?.salary_type || "commission",
    commission_days:
      commission_days !== undefined
        ? commission_days
        : existing?.commission_days || [],
    ratios:
      ratios !== undefined && ratios !== null && typeof ratios === "object"
        ? ratios
        : existing?.ratios || {},
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("teacher_settings")
    .upsert(merged, { onConflict: "staff_id" })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logAuditSafe(supabase, {
    table: "teacher_settings",
    recordId: staff_id,
    action: existing ? "update" : "insert",
    before: (existing as Record<string, unknown>) || null,
    after: data as Record<string, unknown>,
    editedBy: auth.email,
  });

  return NextResponse.json(data);
}
