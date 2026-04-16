import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAuth, requireAdmin } from "@/lib/apiAuth";

interface UpsertBody {
  teacher_id: string;
  sheet_url: string;
}

/**
 * GET /api/teacher-sheets
 * 선생님별 Google Sheets URL 매핑 목록
 */
export async function GET() {
  const supabase = await createClient();
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth.response;

  const { data, error } = await supabase.from("teacher_sheets").select("*");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

/**
 * POST /api/teacher-sheets
 * { teacher_id, sheet_url } 업서트 (관리자 이상)
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if (!auth.ok) return auth.response;

  const { teacher_id, sheet_url } = (await request.json()) as UpsertBody;
  if (!teacher_id || !sheet_url) {
    return NextResponse.json({ error: "teacher_id, sheet_url 필수" }, { status: 400 });
  }

  const { error } = await supabase.from("teacher_sheets").upsert(
    {
      teacher_id,
      sheet_url,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "teacher_id" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
