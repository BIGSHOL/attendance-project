import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/apiAuth";
import { getAuthedUser } from "@/lib/getAuthedUser";
import { logAuditSafe } from "@/lib/audit";

/**
 * GET /api/attendance/tier-overrides?teacher_id=...
 * 특정 선생님의 모든 학생 tier 오버라이드 조회.
 * class_name 포함 — 같은 학생이 서로 다른 분반(요일 세트) 수업을 들을 때 분반별 저장.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth.response;

  const teacherId = new URL(request.url).searchParams.get("teacher_id");

  let query = supabase
    .from("student_tier_overrides")
    .select("student_id, class_name, salary_item_id, tier_name, teacher_id");
  if (teacherId) query = query.eq("teacher_id", teacherId);

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

interface OverrideRow {
  student_id: string;
  class_name?: string;
  salary_item_id: string;
  tier_name: string;
}

interface PutBody {
  teacherId: string;
  /**
   * 분반별 tier 저장 지원.
   * - 배열: 각 항목은 (student_id, class_name, salary_item_id, tier_name).
   *   같은 학생이라도 class_name 이 다르면 다른 레코드로 upsert.
   * - 레거시 객체 형식도 허용: Record<studentId, {salary_item_id, tier_name}>.
   */
  overrides: OverrideRow[] | Record<string, { salary_item_id: string; tier_name: string }>;
}

/**
 * PUT /api/attendance/tier-overrides
 * 여러 (학생, 분반) tier 오버라이드를 upsert.
 * DB UNIQUE 제약 의존 없이 SELECT → UPDATE/INSERT 수동 처리로 안정성 확보.
 */
export async function PUT(request: NextRequest) {
  const supabase = await createClient();

  // 관리자 이상만
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { data: role } = await supabase
    .from("user_roles")
    .select("role")
    .eq("email", user.email)
    .single();
  if (!role || !["master", "admin"].includes(role.role)) {
    return NextResponse.json({ error: "권한 부족" }, { status: 403 });
  }

  const body = (await request.json()) as PutBody;
  if (!body || !body.teacherId || !body.overrides) {
    return NextResponse.json({ error: "teacherId, overrides 필수" }, { status: 400 });
  }

  // 두 가지 입력 형식을 통일된 배열로 정규화
  const rows: OverrideRow[] = Array.isArray(body.overrides)
    ? body.overrides.map((r) => ({
        student_id: r.student_id,
        class_name: r.class_name ?? "",
        salary_item_id: r.salary_item_id,
        tier_name: r.tier_name,
      }))
    : Object.entries(body.overrides).map(([studentId, v]) => ({
        student_id: studentId,
        class_name: "",
        salary_item_id: v.salary_item_id,
        tier_name: v.tier_name,
      }));

  if (rows.length === 0) return NextResponse.json({ count: 0 });

  const now = new Date().toISOString();
  let upserted = 0;

  for (const row of rows) {
    const cn = row.class_name ?? "";
    // 기존 레코드 조회 — class_name NULL 과 "" 을 동일시
    const { data: existing } = await supabase
      .from("student_tier_overrides")
      .select("*")
      .eq("teacher_id", body.teacherId)
      .eq("student_id", row.student_id)
      .or(`class_name.eq.${cn},class_name.is.null`)
      .limit(1);

    const before = existing?.[0] || null;

    if (before) {
      const { data: updated, error } = await supabase
        .from("student_tier_overrides")
        .update({
          salary_item_id: row.salary_item_id,
          tier_name: row.tier_name,
          class_name: cn,
          updated_at: now,
        })
        .eq("id", before.id)
        .select()
        .single();
      if (!error && updated) {
        upserted++;
        logAuditSafe(supabase, {
          table: "student_tier_overrides",
          recordId: `${body.teacherId}:${row.student_id}:${cn}`,
          action: "update",
          before: before as Record<string, unknown>,
          after: updated as Record<string, unknown>,
          editedBy: user.email!,
        });
      }
    } else {
      const { data: inserted, error } = await supabase
        .from("student_tier_overrides")
        .insert({
          teacher_id: body.teacherId,
          student_id: row.student_id,
          class_name: cn,
          salary_item_id: row.salary_item_id,
          tier_name: row.tier_name,
          updated_at: now,
        })
        .select()
        .single();
      if (!error && inserted) {
        upserted++;
        logAuditSafe(supabase, {
          table: "student_tier_overrides",
          recordId: `${body.teacherId}:${row.student_id}:${cn}`,
          action: "insert",
          before: null,
          after: inserted as Record<string, unknown>,
          editedBy: user.email!,
        });
      }
    }
  }

  return NextResponse.json({ count: upserted });
}
