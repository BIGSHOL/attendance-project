import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/getAuthedUser";

/**
 * DELETE /api/attendance/purge-class
 * Body: { teacher_id, student_id, class_name }
 * 유령 분반 행(출석 0T지만 class_name 레코드로 남아있는 케이스) 정리용 관리자 API.
 * 지정 (teacher_id, student_id, class_name) 조합의 attendance 레코드 전체 삭제 +
 * 대응하는 tier_overrides 도 함께 삭제.
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

  const body = await request.json();
  const { teacher_id, student_id, class_name } = body || {};

  if (!teacher_id || !student_id || typeof class_name !== "string") {
    return NextResponse.json(
      { error: "teacher_id, student_id, class_name 필수" },
      { status: 400 }
    );
  }

  const { data: before, error: selErr } = await supabase
    .from("attendance")
    .select("id, date, hours, memo")
    .eq("teacher_id", teacher_id)
    .eq("student_id", student_id)
    .eq("class_name", class_name);
  if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });

  const { error: delErr } = await supabase
    .from("attendance")
    .delete()
    .eq("teacher_id", teacher_id)
    .eq("student_id", student_id)
    .eq("class_name", class_name);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  // student_tier_overrides 도 같이 정리 (이게 정확한 테이블명)
  const { data: tBefore } = await supabase
    .from("student_tier_overrides")
    .select("id, tier_name, salary_item_id")
    .eq("teacher_id", teacher_id)
    .eq("student_id", student_id)
    .eq("class_name", class_name);

  const { error: tErr } = await supabase
    .from("student_tier_overrides")
    .delete()
    .eq("teacher_id", teacher_id)
    .eq("student_id", student_id)
    .eq("class_name", class_name);
  if (tErr) {
    console.warn("[purge-class] student_tier_overrides delete 경고:", tErr.message);
  }

  console.log(
    `[purge-class] teacher=${teacher_id} student=${student_id} class='${class_name}' ` +
      `삭제: attendance=${before?.length || 0}건, tier_overrides=${tBefore?.length || 0}건`
  );

  return NextResponse.json({
    ok: true,
    deleted: before?.length || 0,
    tierOverridesDeleted: tBefore?.length || 0,
    records: before || [],
    tierOverrides: tBefore || [],
  });
}
