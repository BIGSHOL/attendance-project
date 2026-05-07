import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/apiAuth";
import { getAuthedUser } from "@/lib/getAuthedUser";
import { logAuditSafe } from "@/lib/audit";

/**
 * GET /api/attendance/tier-overrides
 *   ?teacher_id=...   특정 선생님의 모든 학생 tier
 *   ?student_id=...   특정 학생의 모든 선생님 tier (학생 상세 페이지용, audit J)
 *   둘 다 가능 — AND 결합.
 *
 * class_name 포함 — 같은 학생이 서로 다른 분반(요일 세트) 수업을 들을 때 분반별 저장.
 * is_manual = true 면 사용자가 앱에서 직접 추가한 row (시트 sync 시 보호됨).
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const teacherId = params.get("teacher_id");
  const studentId = params.get("student_id");

  let query = supabase
    .from("student_tier_overrides")
    .select(
      "id, student_id, class_name, salary_item_id, tier_name, teacher_id, is_manual, updated_at"
    );
  if (teacherId) query = query.eq("teacher_id", teacherId);
  if (studentId) query = query.eq("student_id", studentId);

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

interface OverrideRow {
  student_id: string;
  class_name?: string;
  salary_item_id: string;
  tier_name: string;
  /**
   * true 면 사용자가 앱에서 직접 추가한 row.
   *   sync 가 SELECT 후 if (before.is_manual === true) → skip.
   *   사용자 모달에서 호출 시 true 전달, 시트 sync 에서는 미전달(=false 유지).
   */
  is_manual?: boolean;
}

interface PutBody {
  teacherId: string;
  /**
   * 분반별 tier 저장 지원.
   * - 배열: 각 항목은 (student_id, class_name, salary_item_id, tier_name, is_manual?).
   *   같은 학생이라도 class_name 이 다르면 다른 레코드로 upsert.
   * - 레거시 객체 형식도 허용: Record<studentId, {salary_item_id, tier_name}>.
   */
  overrides:
    | OverrideRow[]
    | Record<string, { salary_item_id: string; tier_name: string }>;
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
        is_manual: !!r.is_manual,
      }))
    : Object.entries(body.overrides).map(([studentId, v]) => ({
        student_id: studentId,
        class_name: "",
        salary_item_id: v.salary_item_id,
        tier_name: v.tier_name,
        is_manual: false,
      }));

  if (rows.length === 0)
    return NextResponse.json({ count: 0, protectedCount: 0 });

  const now = new Date().toISOString();
  let upserted = 0;
  // is_manual=true 인 기존 row 와 충돌해 sync 가 skip 한 카운터.
  //   UI 의 동기화 결과 모달이 "보호 N" 으로 표시.
  let protectedCount = 0;

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

    // 사용자 수동 추가 row 보호 — is_manual=true + 입력 row 의 is_manual !== true.
    //   즉 "사용자 추가 vs 사용자 추가" 는 갱신 허용 (의도적 수정),
    //   "시트 sync vs 사용자 추가" 만 skip.
    if (
      before &&
      (before as { is_manual?: boolean }).is_manual === true &&
      !row.is_manual
    ) {
      protectedCount++;
      continue;
    }

    if (before) {
      const { data: updated, error } = await supabase
        .from("student_tier_overrides")
        .update({
          salary_item_id: row.salary_item_id,
          tier_name: row.tier_name,
          class_name: cn,
          // is_manual 은 입력에 명시되어 있을 때만 갱신 (true 또는 false).
          //   미지정 시 기존 값 유지.
          ...(row.is_manual !== undefined ? { is_manual: row.is_manual } : {}),
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
          is_manual: !!row.is_manual,
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

  return NextResponse.json({ count: upserted, protectedCount });
}

/**
 * DELETE /api/attendance/tier-overrides?id=...
 * 관리자 이상만. is_manual=true 인 row 만 삭제 허용 (자동 row 직접 삭제 금지 — 다음 sync 에서
 * 재생성될 수 있어 의미 없음).
 */
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
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

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 });

  const { data: before } = await supabase
    .from("student_tier_overrides")
    .select("*")
    .eq("id", id)
    .single();
  if (!before) {
    return NextResponse.json({ error: "row 없음" }, { status: 404 });
  }
  if (!(before as { is_manual?: boolean }).is_manual) {
    return NextResponse.json(
      {
        error:
          "자동 row(is_manual=false) 는 직접 삭제 불가 — 시트에서 분반을 제거 후 sync 하세요.",
      },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("student_tier_overrides")
    .delete()
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logAuditSafe(supabase, {
    table: "student_tier_overrides",
    recordId: id,
    action: "delete",
    before: before as Record<string, unknown>,
    editedBy: user.email!,
  });

  return NextResponse.json({ deleted: true });
}
