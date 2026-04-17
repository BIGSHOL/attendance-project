import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/getAuthedUser";

interface ImportRequest {
  teacherId: string;
  year: number;
  month: number;
  // rowKey → { "YYYY-MM-DD": number }
  // rowKey 는 `${studentId}|${className}` 형식 (단일 분반 학생은 className=""로 studentId 뒤에 "|" 포함 가능).
  records: Record<string, Record<string, number>>;
  memos?: Record<string, Record<string, string>>;
  /**
   * rowKey → { "YYYY-MM-DD": true }. 시트 "보강" 섹션에서 나온 출석 날짜 마킹.
   * attendance.is_makeup 으로 DB 저장. 퇴원 후 출석이라도 is_makeup=true 면
   * 급여 집계에서 재원 체크 예외 허용.
   */
  makeups?: Record<string, Record<string, boolean>>;
  overwrite?: boolean;
  startDate?: string;
  endDate?: string;
}

function splitRowKey(key: string): { studentId: string; className: string } {
  const idx = key.indexOf("|");
  if (idx < 0) return { studentId: key, className: "" };
  return { studentId: key.slice(0, idx), className: key.slice(idx + 1) };
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
    makeups,
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

  // 데이터 생성 — rowKey 는 "studentId|className" 포맷
  const rows: {
    teacher_id: string;
    student_id: string;
    class_name: string;
    date: string;
    hours: number;
    memo: string;
    cell_color: string;
    homework: boolean;
    is_makeup: boolean;
  }[] = [];

  const rowKeys = new Set([
    ...Object.keys(records),
    ...Object.keys(memos || {}),
  ]);
  for (const rowKey of rowKeys) {
    const { studentId, className } = splitRowKey(rowKey);
    const dateMap = records[rowKey] || {};
    const memoMap = memos?.[rowKey] || {};
    const makeupMap = makeups?.[rowKey] || {};
    const allDates = new Set([...Object.keys(dateMap), ...Object.keys(memoMap)]);
    for (const date of allDates) {
      rows.push({
        teacher_id: teacherId,
        student_id: studentId,
        class_name: className,
        date,
        hours: Number(dateMap[date]) || 0,
        memo: memoMap[date] || "",
        cell_color: "",
        homework: false,
        is_makeup: !!makeupMap[date],
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

  // 배치 upsert — (teacher_id, student_id, date, class_name) UNIQUE 충돌 시 UPDATE
  const batchSize = 100;
  let upsertedTotal = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { data: upserted, error } = await supabase
      .from("attendance")
      .upsert(batch, {
        onConflict: "teacher_id,student_id,date,class_name",
        ignoreDuplicates: false,
      })
      .select("id");
    if (error) {
      console.error(`[import] upsert 실패 (batch ${i}):`, error);
      return NextResponse.json(
        { error: `저장 실패: ${error.message}` },
        { status: 500 }
      );
    }
    upsertedTotal += upserted?.length || 0;
  }
  console.log(`[import] upsert 완료: ${upsertedTotal}/${rows.length}`);

  return NextResponse.json({ count: rows.length });
}
