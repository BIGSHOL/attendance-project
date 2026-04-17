import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/apiAuth";

/**
 * 시트에만 있는 학생(=Firebase 미등록) 관리 API.
 * 시트가 권위이므로 동기화 시 여기에 upsert 된 학생도 앱 출석부에 노출된다.
 */

/**
 * GET /api/virtual-students
 * 전체 조회 (인증 사용자)
 */
export async function GET() {
  const supabase = await createClient();
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth.response;

  const { data, error } = await supabase
    .from("virtual_students")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

/**
 * PUT /api/virtual-students
 * body: { students: Array<{ id, name, school?, grade?, teacher_staff_id, class_name?, days?, subject? }> }
 * upsert (존재하면 업데이트, 없으면 생성). id 는 "virtual_{name}_{school}_{grade}" 형식.
 */
export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth.response;

  const body = await request.json();
  const students = Array.isArray(body?.students) ? body.students : [];
  if (students.length === 0) return NextResponse.json({ upserted: 0 });

  // 필수 필드 검증
  const now = new Date().toISOString();
  const rows = students
    .filter(
      (s: Record<string, unknown>) =>
        typeof s.id === "string" &&
        typeof s.name === "string" &&
        typeof s.teacher_staff_id === "string"
    )
    .map((s: Record<string, unknown>) => ({
      id: s.id as string,
      name: s.name as string,
      school: (s.school as string) || "",
      grade: (s.grade as string) || "",
      teacher_staff_id: s.teacher_staff_id as string,
      class_name: (s.class_name as string) || "",
      days: Array.isArray(s.days) ? s.days : [],
      subject: (s.subject as string) || "math",
      updated_at: now,
    }));

  if (rows.length === 0) return NextResponse.json({ upserted: 0 });

  const { data, error } = await supabase
    .from("virtual_students")
    .upsert(rows, { onConflict: "id" })
    .select();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ upserted: data?.length || 0 });
}

/**
 * DELETE /api/virtual-students?id=...
 * Firebase 쪽에 진짜 학생이 생긴 후 수동 정리용.
 */
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 });

  const { error } = await supabase.from("virtual_students").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
