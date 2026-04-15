import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/apiAuth";
import { logAuditSafe } from "@/lib/audit";

/**
 * GET /api/attendance/tier-overrides?teacher_id=...
 * 특정 선생님의 모든 학생 tier 오버라이드 조회
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth.response;

  const teacherId = new URL(request.url).searchParams.get("teacher_id");

  let query = supabase
    .from("student_tier_overrides")
    .select("student_id, salary_item_id, tier_name, teacher_id");
  if (teacherId) query = query.eq("teacher_id", teacherId);

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

interface PutBody {
  teacherId: string;
  /** { student_id: { salary_item_id, tier_name } } — 지정된 학생만 upsert */
  overrides: Record<string, { salary_item_id: string; tier_name: string }>;
}

/**
 * PUT /api/attendance/tier-overrides
 * 선생님의 여러 학생 tier 오버라이드를 upsert
 */
export async function PUT(request: NextRequest) {
  const supabase = await createClient();

  // 관리자 이상만
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { data: role } = await supabase
    .from("user_roles")
    .select("role")
    .eq("email", user.email)
    .single();
  if (!role || !["master", "admin"].includes(role.role)) {
    return NextResponse.json({ error: "권한 부족" }, { status: 403 });
  }

  const { teacherId, overrides } = (await request.json()) as PutBody;
  if (!teacherId || !overrides) {
    return NextResponse.json({ error: "teacherId, overrides 필수" }, { status: 400 });
  }

  const rows = Object.entries(overrides).map(([studentId, v]) => ({
    teacher_id: teacherId,
    student_id: studentId,
    salary_item_id: v.salary_item_id,
    tier_name: v.tier_name,
    updated_at: new Date().toISOString(),
  }));

  if (rows.length === 0) return NextResponse.json({ count: 0 });

  // 변경 전 스냅샷
  const studentIds = rows.map((r) => r.student_id);
  const { data: beforeRows } = await supabase
    .from("student_tier_overrides")
    .select("*")
    .eq("teacher_id", teacherId)
    .in("student_id", studentIds);
  const beforeMap = new Map(
    (beforeRows || []).map((r) => [
      r.student_id as string,
      r as Record<string, unknown>,
    ])
  );

  const { data: afterRows, error } = await supabase
    .from("student_tier_overrides")
    .upsert(rows, { onConflict: "teacher_id,student_id" })
    .select();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  for (const after of afterRows || []) {
    const before = beforeMap.get(after.student_id as string);
    logAuditSafe(supabase, {
      table: "student_tier_overrides",
      recordId: `${after.teacher_id}:${after.student_id}`,
      action: before ? "update" : "insert",
      before: before || null,
      after: after as Record<string, unknown>,
      editedBy: user.email!,
    });
  }

  return NextResponse.json({ count: rows.length });
}
