import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/apiAuth";

/**
 * GET /api/teacher-blog-posts?teacher_id=...&year=...&month=...
 * teacher_id, year, month 조합 필터. 없으면 전체.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const teacherId = searchParams.get("teacher_id");
  const year = searchParams.get("year");
  const month = searchParams.get("month");

  let q = supabase
    .from("teacher_blog_posts")
    .select("*")
    .order("year", { ascending: false })
    .order("month", { ascending: false });

  if (teacherId) q = q.eq("teacher_id", teacherId);
  if (year) q = q.eq("year", Number(year));
  if (month) q = q.eq("month", Number(month));

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

/**
 * POST /api/teacher-blog-posts
 * body: { teacher_id, year, month, dates: string[], note? }
 * (teacher_id, year, month) 유니크 upsert
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth.response;

  const body = await request.json();
  const { teacher_id, year, month, dates, note } = body || {};

  if (!teacher_id || !year || !month || !Array.isArray(dates)) {
    return NextResponse.json(
      { error: "teacher_id, year, month, dates 필수" },
      { status: 400 }
    );
  }

  // 선생님 본인 또는 관리자만 저장 허용
  if (auth.role === "teacher") {
    const { data: me } = await supabase
      .from("user_roles")
      .select("staff_id")
      .eq("email", auth.email)
      .single();
    if (me?.staff_id !== teacher_id) {
      return NextResponse.json({ error: "본인 기록만 저장 가능" }, { status: 403 });
    }
  } else if (auth.role !== "master" && auth.role !== "admin") {
    return NextResponse.json({ error: "권한 부족" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("teacher_blog_posts")
    .upsert(
      {
        teacher_id,
        year: Number(year),
        month: Number(month),
        dates,
        note: note || "",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "teacher_id,year,month" }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
