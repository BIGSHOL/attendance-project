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

  // 배치 upsert — (teacher_id, student_id, date, class_name) UNIQUE 충돌 시 UPDATE.
  //
  // audit V7 Phase 2: batch 병렬화 (concurrency=5).
  //   기존: for await — 1000 rows = 10 batch sequential = ~5초
  //   개선: 5 worker pool — 동시 처리, 큰 시트일수록 큼 (5×~10×)
  //
  //   첫 에러 발생 시 cursor 정지 (다른 worker 도 자연 종료) 후 통합 응답.
  //   Supabase pool 안전 한도 (5 concurrent batch) 준수.
  const batchSize = 100;
  const concurrency = 5;
  const batches: (typeof rows)[] = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    batches.push(rows.slice(i, i + batchSize));
  }

  let cursor = 0;
  let upsertedTotal = 0;
  // 첫 에러를 가장 작은 batch idx 로 기록 (모든 worker 의 에러 중 batch 순서가
  // 가장 빠른 것). Node.js single-thread 라 actual race 는 없지만, 첫 호출
  // 순서가 아닌 batch idx 기준으로 보고해야 운영자가 어떤 데이터 batch 에서
  // 실패했는지 명확하게 파악 가능.
  type BatchError = { idx: number; message: string };
  const errorBox: { value: BatchError | null; hasError: boolean } = {
    value: null,
    hasError: false,
  };

  async function worker() {
    while (cursor < batches.length && !errorBox.hasError) {
      const myIdx = cursor++;
      const batch = batches[myIdx];
      const { data: upserted, error } = await supabase
        .from("attendance")
        .upsert(batch, {
          onConflict: "teacher_id,student_id,date,class_name",
          ignoreDuplicates: false,
        })
        .select("id");
      if (error) {
        // 첫 에러 또는 더 작은 idx 의 에러만 기록 (사용자에게 가장 정확한 보고).
        const current = errorBox.value;
        if (!current || current.idx > myIdx) {
          errorBox.value = { idx: myIdx, message: error.message };
        }
        errorBox.hasError = true;
        console.error(`[import] upsert 실패 (batch ${myIdx}):`, error);
        return;
      }
      upsertedTotal += upserted?.length || 0;
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  if (errorBox.value) {
    return NextResponse.json(
      { error: `저장 실패 (batch ${errorBox.value.idx}): ${errorBox.value.message}` },
      { status: 500 }
    );
  }
  console.log(`[import] upsert 완료: ${upsertedTotal}/${rows.length}`);

  return NextResponse.json({ count: rows.length });
}
