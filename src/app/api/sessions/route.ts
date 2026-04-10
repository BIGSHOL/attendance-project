import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireAuth } from "@/lib/apiAuth";

/**
 * GET /api/sessions?year=2026&category=math
 * 세션 목록 조회 (인증된 사용자 허용)
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const year = searchParams.get("year");
  const category = searchParams.get("category");

  let q = supabase.from("session_periods").select("*").order("month", { ascending: true });
  if (year) q = q.eq("year", Number(year));
  if (category) q = q.eq("category", category);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

/**
 * POST /api/sessions
 * 세션 upsert — 관리자 이상만
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if (!auth.ok) return auth.response;

  const body = await request.json();
  const rows = Array.isArray(body) ? body : [body];
  const normalized = rows.map((r) => ({
    id: r.id || `${r.year}-${r.category}-${r.month}`,
    year: Number(r.year),
    category: String(r.category),
    month: Number(r.month),
    ranges: r.ranges || [],
    sessions: r.sessions ?? 12,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from("session_periods").upsert(normalized, { onConflict: "id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ count: normalized.length });
}
