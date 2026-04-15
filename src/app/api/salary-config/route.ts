import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireAuth } from "@/lib/apiAuth";
import { logAuditSafe } from "@/lib/audit";

/**
 * GET /api/salary-config
 * 전체 공통 급여 설정(global) 조회 — 인증 사용자 모두
 */
export async function GET() {
  const supabase = await createClient();
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth.response;

  const { data, error } = await supabase
    .from("salary_configs")
    .select("config, updated_at")
    .eq("teacher_id", "global")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    config: data?.config || null,
    updatedAt: data?.updated_at || null,
  });
}

/**
 * POST /api/salary-config
 * 전체 공통 급여 설정 저장 — 관리자 이상만
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if (!auth.ok) return auth.response;

  const body = await request.json();
  if (!body || typeof body !== "object" || !("config" in body)) {
    return NextResponse.json({ error: "config 필드 누락" }, { status: 400 });
  }

  const { data: before } = await supabase
    .from("salary_configs")
    .select("config")
    .eq("teacher_id", "global")
    .maybeSingle();

  const { error } = await supabase
    .from("salary_configs")
    .upsert(
      {
        teacher_id: "global",
        config: body.config,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "teacher_id" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logAuditSafe(supabase, {
    table: "salary_configs",
    recordId: "global",
    action: "update",
    before: { config: before?.config ?? null },
    after: { config: body.config },
    editedBy: auth.email,
    context: { note: "급여 설정 변경" },
  });

  return NextResponse.json({ ok: true });
}
