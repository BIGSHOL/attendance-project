import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/getAuthedUser";

/**
 * GET /api/attendance/debug-student?student_id=...&teacher_id=...
 * 특정 학생의 모든 attendance + tier_override 레코드 조회 (디버그용)
 */
export async function GET(request: NextRequest) {
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

  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get("student_id");
  const teacherId = searchParams.get("teacher_id");
  if (!studentId) return NextResponse.json({ error: "student_id 필수" }, { status: 400 });

  let attQuery = supabase
    .from("attendance")
    .select("id, teacher_id, student_id, class_name, date, hours, memo")
    .eq("student_id", studentId);
  if (teacherId) attQuery = attQuery.eq("teacher_id", teacherId);
  const { data: attendance } = await attQuery;

  let tierQuery = supabase
    .from("student_tier_overrides")
    .select("*")
    .eq("student_id", studentId);
  if (teacherId) tierQuery = tierQuery.eq("teacher_id", teacherId);
  const { data: tiers } = await tierQuery;

  // 가상 학생
  const { data: virt } = await supabase
    .from("virtual_students")
    .select("*")
    .eq("id", studentId);

  return NextResponse.json({
    studentId,
    teacherId,
    attendance: attendance || [],
    attendanceByClass: (attendance || []).reduce((acc, r) => {
      const cn = r.class_name || "(빈)";
      acc[cn] = (acc[cn] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    tierOverrides: tiers || [],
    virtualStudents: virt || [],
  });
}
