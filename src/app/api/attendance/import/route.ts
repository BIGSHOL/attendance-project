import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/getAuthedUser";

interface ImportRequest {
  teacherId: string;
  year: number;
  month: number;
  // studentId → { "YYYY-MM-DD": number }
  records: Record<string, Record<string, number>>;
  // studentId → { "YYYY-MM-DD": 메모 }
  memos?: Record<string, Record<string, string>>;
  overwrite?: boolean;
  /** 덮어쓰기 범위 (YYYY-MM-DD). 지정 시 month 기반 대신 이 범위로 삭제 */
  startDate?: string;
  endDate?: string;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  // 관리자 이상 체크
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

  const body = (await request.json()) as ImportRequest;
  const {
    teacherId,
    year,
    month,
    records,
    memos,
    overwrite,
    startDate: bodyStartDate,
    endDate: bodyEndDate,
  } = body;

  if (!teacherId || !year || !month || !records) {
    return NextResponse.json({ error: "필수 파라미터 누락" }, { status: 400 });
  }

  // 덮어쓰기 범위 결정: startDate/endDate가 명시되면 그 범위, 아니면 해당 월 전체
  if (overwrite) {
    let delStart: string;
    let delEnd: string;
    if (bodyStartDate && bodyEndDate) {
      delStart = bodyStartDate;
      delEnd = bodyEndDate;
    } else {
      delStart = `${year}-${String(month).padStart(2, "0")}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      delEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    }

    await supabase
      .from("attendance")
      .delete()
      .eq("teacher_id", teacherId)
      .gte("date", delStart)
      .lte("date", delEnd);
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

  // 출석값이 있는 셀 + 메모만 있는 셀 모두 포함
  const studentIds = new Set([
    ...Object.keys(records),
    ...Object.keys(memos || {}),
  ]);
  for (const studentId of studentIds) {
    const dateMap = records[studentId] || {};
    const memoMap = memos?.[studentId] || {};
    const allDates = new Set([...Object.keys(dateMap), ...Object.keys(memoMap)]);
    for (const date of allDates) {
      rows.push({
        teacher_id: teacherId,
        student_id: studentId,
        date,
        hours: Number(dateMap[date]) || 0,
        memo: memoMap[date] || "",
        cell_color: "",
        homework: false,
        is_makeup: false,
      });
    }
  }

  const memoRowCount = rows.filter((r) => r.memo && r.memo.length > 0).length;
  console.log(
    `[import] teacher=${teacherId} ${year}.${String(month).padStart(2, "0")} ` +
      `rows=${rows.length} (메모 포함 ${memoRowCount}개), overwrite=${overwrite}, ` +
      `범위 ${bodyStartDate || "month"}~${bodyEndDate || "month"}`
  );

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
