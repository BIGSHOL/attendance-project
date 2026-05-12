import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAuth, requireAdmin } from "@/lib/apiAuth";

/**
 * GET /api/payment-splits?month=2026-04
 *      또는 /api/payment-splits?months=2026-04,2026-03 (CSV)
 *
 * Firebase billing 의 단일 청구를 강사별로 분배한 데이터.
 * 인증된 사용자는 조회 가능 (관리자만 수정).
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month");
  const monthsCsv = searchParams.get("months");
  const months = monthsCsv
    ? monthsCsv.split(",").map((s) => s.trim()).filter(Boolean)
    : month
      ? [month]
      : [];

  let query = supabase.from("payment_splits").select("*");
  if (months.length > 0) query = query.in("billing_month", months);
  const { data, error } = await query.order("billing_month", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

interface SplitItem {
  teacher_staff_id: string;
  teacher_name: string;
  amount: number;
  role?: string;
}

interface PostBody {
  billing_month: string;
  student_name: string;
  student_school?: string;
  billing_name: string;
  original_amount: number;
  splits: SplitItem[];
}

/**
 * POST /api/payment-splits
 * Body: { billing_month, student_name, student_school, billing_name, original_amount, splits }
 *
 * upsert — (billing_month, student_name, student_school, billing_name) unique key.
 * splits 합계가 original_amount 와 일치해야 함.
 * 관리자(admin/master) 만 허용.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if (!auth.ok) return auth.response;

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "잘못된 JSON" }, { status: 400 });
  }

  // 필수 필드 검증
  if (
    !body.billing_month ||
    !body.student_name ||
    !body.billing_name ||
    typeof body.original_amount !== "number" ||
    !Array.isArray(body.splits) ||
    body.splits.length === 0
  ) {
    return NextResponse.json(
      { error: "billing_month / student_name / billing_name / original_amount / splits 필수" },
      { status: 400 }
    );
  }

  // splits 항목 검증
  for (const s of body.splits) {
    if (!s.teacher_staff_id || !s.teacher_name) {
      return NextResponse.json(
        { error: "각 분배에 teacher_staff_id 와 teacher_name 필요" },
        { status: 400 }
      );
    }
    if (typeof s.amount !== "number" || s.amount < 0) {
      return NextResponse.json(
        { error: "분배 금액은 0 이상의 숫자여야 함" },
        { status: 400 }
      );
    }
  }

  // 분배 합계 = 원본 청구액 강제
  const splitSum = body.splits.reduce((a, s) => a + s.amount, 0);
  if (splitSum !== body.original_amount) {
    return NextResponse.json(
      {
        error: `분배 합계(${splitSum.toLocaleString()})가 원본 청구액(${body.original_amount.toLocaleString()})과 일치해야 함`,
      },
      { status: 400 }
    );
  }

  const upsertRow = {
    billing_month: body.billing_month,
    student_name: body.student_name,
    student_school: body.student_school || "",
    billing_name: body.billing_name,
    original_amount: body.original_amount,
    splits: body.splits,
    updated_at: new Date().toISOString(),
    updated_by: auth.email,
  };

  const { data, error } = await supabase
    .from("payment_splits")
    .upsert(upsertRow, {
      onConflict: "billing_month,student_name,student_school,billing_name",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

/**
 * DELETE /api/payment-splits?id=...
 *   또는 /api/payment-splits?billing_month=YYYY-MM&student_name=...&billing_name=...
 *
 * 분리 삭제 — 원본 billing 청구로 복귀.
 */
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (id) {
    const { error } = await supabase.from("payment_splits").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const billingMonth = searchParams.get("billing_month");
  const studentName = searchParams.get("student_name");
  const studentSchool = searchParams.get("student_school") ?? "";
  const billingName = searchParams.get("billing_name");
  if (!billingMonth || !studentName || !billingName) {
    return NextResponse.json(
      { error: "id 또는 (billing_month + student_name + billing_name) 필수" },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("payment_splits")
    .delete()
    .eq("billing_month", billingMonth)
    .eq("student_name", studentName)
    .eq("student_school", studentSchool)
    .eq("billing_name", billingName);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
