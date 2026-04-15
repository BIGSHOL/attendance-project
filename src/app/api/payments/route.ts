import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireAuth } from "@/lib/apiAuth";
import { logAuditSafe } from "@/lib/audit";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if (!auth.ok) return auth.response;

  const { rows, staffMap } = await request.json();

  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "데이터가 없습니다" }, { status: 400 });
  }

  // staffMap: { "강사이름": "firebase_staff_id" }
  const records = rows.map((r: Record<string, unknown>) => ({
    student_code: r.student_code,
    student_name: r.student_name,
    grade: r.grade,
    school: r.school,
    billing_month: r.billing_month,
    payment_name: r.payment_name,
    charge_amount: r.charge_amount,
    discount_amount: r.discount_amount,
    paid_amount: r.paid_amount,
    unpaid_amount: r.unpaid_amount,
    payment_method: r.payment_method,
    payment_date: r.payment_date,
    teacher_name: r.teacher_name,
    teacher_staff_id: staffMap?.[r.teacher_name as string] || null,
    memo: r.memo,
  }));

  // 같은 청구월 데이터가 이미 있으면 삭제 후 재삽입 (덮어쓰기)
  const billingMonth = records[0].billing_month;
  if (billingMonth) {
    await supabase.from("payments").delete().eq("billing_month", billingMonth);
  }

  // 50건씩 배치 삽입
  const batchSize = 50;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const { error } = await supabase.from("payments").insert(batch);
    if (error) {
      return NextResponse.json(
        { error: `저장 실패: ${error.message}` },
        { status: 500 }
      );
    }
  }

  logAuditSafe(supabase, {
    table: "payments",
    recordId: String(billingMonth || "(unknown)"),
    action: "bulk",
    changes: { imported_count: records.length, billing_month: billingMonth },
    editedBy: auth.email,
    context: { note: "수납내역 일괄 업로드 (해당 청구월 덮어쓰기)" },
  });

  return NextResponse.json({ count: records.length });
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month");
  // months=a,b,c 로 여러 billing_month 포맷을 한 번에 필터링 (IN)
  const monthsCsv = searchParams.get("months");
  const monthsList = monthsCsv ? monthsCsv.split(",").map((s) => s.trim()).filter(Boolean) : null;

  // PostgREST 기본 1,000건 제한 우회 (월별 수납이 1000건 초과 가능)
  const pageSize = 1000;
  let all: unknown[] = [];
  let from = 0;
  while (true) {
    let q = supabase
      .from("payments")
      .select("*")
      .order("student_name", { ascending: true })
      .order("charge_amount", { ascending: false })
      .range(from, from + pageSize - 1);
    if (monthsList && monthsList.length > 0) q = q.in("billing_month", monthsList);
    else if (month) q = q.eq("billing_month", month);

    const { data, error } = await q;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return NextResponse.json(all);
}
