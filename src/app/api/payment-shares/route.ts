import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAuth, requireAdmin } from "@/lib/apiAuth";

/**
 * payment_shares API — 영어 강사별 학생 수납 분배.
 *
 * 수학: 1학생 = 1담임 → payments 테이블로 충분.
 * 영어: 1학생이 담임+부담임 여러 명에게 수납액이 쪼개짐 → 이 테이블로 관리.
 *
 * 각 row = (학생, 월, 강사, 반) 고유 조합.
 */

interface ShareRow {
  student_id: string;
  month: string;
  teacher_staff_id: string;
  class_name: string;
  allocated_charge?: number;
  allocated_paid?: number;
  allocated_units?: number;
  unit_price?: number;
  source?: string;
  debug_note?: string;
  is_manual?: boolean;
}

/**
 * GET /api/payment-shares
 *   - ?teacher_id=...  선생님별
 *   - ?month=YYYY-MM   월별
 *   - ?student_id=...  학생별
 *   (필요한 쿼리만 조합. 없으면 전체 — 관리자만)
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const teacherId = searchParams.get("teacher_id");
  const month = searchParams.get("month");
  const studentId = searchParams.get("student_id");

  let q = supabase.from("payment_shares").select("*");
  if (teacherId) q = q.eq("teacher_staff_id", teacherId);
  if (month) q = q.eq("month", month);
  if (studentId) q = q.eq("student_id", studentId);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

/**
 * PUT /api/payment-shares
 * body: { shares: ShareRow[], replaceScope?: { teacher_id, month } }
 *
 * 일괄 upsert. `replaceScope` 가 주어지면 그 범위의 기존 shares 중
 * `is_manual=false` 인 것은 먼저 삭제 (재동기화 전용).
 */
export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if (!auth.ok) return auth.response;

  const body = await request.json();
  const shares: ShareRow[] = Array.isArray(body?.shares) ? body.shares : [];
  const replaceScope = body?.replaceScope;

  // 재동기화 scope 가 있으면 기존 is_manual=false 레코드 먼저 삭제
  if (replaceScope?.teacher_id && replaceScope?.month) {
    await supabase
      .from("payment_shares")
      .delete()
      .eq("teacher_staff_id", replaceScope.teacher_id)
      .eq("month", replaceScope.month)
      .eq("is_manual", false);
  }

  if (shares.length === 0) return NextResponse.json({ upserted: 0 });

  const now = new Date().toISOString();
  const rows = shares
    .filter(
      (s) =>
        typeof s.student_id === "string" &&
        typeof s.month === "string" &&
        typeof s.teacher_staff_id === "string" &&
        typeof s.class_name === "string"
    )
    .map((s) => ({
      student_id: s.student_id,
      month: s.month,
      teacher_staff_id: s.teacher_staff_id,
      class_name: s.class_name,
      allocated_charge: Math.max(0, Math.floor(Number(s.allocated_charge) || 0)),
      allocated_paid: Math.max(0, Math.floor(Number(s.allocated_paid) || 0)),
      allocated_units:
        s.allocated_units !== undefined ? Number(s.allocated_units) : null,
      unit_price:
        s.unit_price !== undefined
          ? Math.max(0, Math.floor(Number(s.unit_price) || 0))
          : null,
      source: s.source ?? null,
      debug_note: s.debug_note ?? null,
      is_manual: !!s.is_manual,
      updated_at: now,
    }));

  if (rows.length === 0) return NextResponse.json({ upserted: 0 });

  const { data, error } = await supabase
    .from("payment_shares")
    .upsert(rows, {
      onConflict: "student_id,month,teacher_staff_id,class_name",
    })
    .select();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ upserted: data?.length || 0 });
}

/**
 * DELETE /api/payment-shares?id=...
 */
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 });

  const { error } = await supabase.from("payment_shares").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
