import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface ImportRequest {
  teacherId: string;
  year: number;
  month: number;
  // studentId → { "YYYY-MM-DD": number }
  records: Record<string, Record<string, number>>;
  overwrite?: boolean;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  // 관리자 이상 체크
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

  const body = (await request.json()) as ImportRequest;
  const { teacherId, year, month, records, overwrite } = body;

  if (!teacherId || !year || !month || !records) {
    return NextResponse.json({ error: "필수 파라미터 누락" }, { status: 400 });
  }

  // 해당 선생님+월 기존 데이터 삭제 (overwrite 모드)
  if (overwrite) {
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    await supabase
      .from("attendance")
      .delete()
      .eq("teacher_id", teacherId)
      .gte("date", startDate)
      .lte("date", endDate);
  }

  // 데이터 생성
  const rows: {
    teacher_id: string;
    student_id: string;
    date: string;
    hours: number;
    memo: string;
    cell_color: string;
    homework: boolean;
    is_makeup: boolean;
  }[] = [];

  for (const [studentId, dateMap] of Object.entries(records)) {
    for (const [date, hours] of Object.entries(dateMap)) {
      rows.push({
        teacher_id: teacherId,
        student_id: studentId,
        date,
        hours: Number(hours) || 0,
        memo: "",
        cell_color: "",
        homework: false,
        is_makeup: false,
      });
    }
  }

  if (rows.length === 0) {
    return NextResponse.json({ count: 0 });
  }

  // 배치 삽입
  const batchSize = 100;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase.from("attendance").insert(batch);
    if (error) {
      return NextResponse.json(
        { error: `저장 실패: ${error.message}` },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ count: rows.length });
}
