import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/apiAuth";

/**
 * GET /api/admin/audit-logs
 *   ?table=...&user=...&from=YYYY-MM-DD&to=YYYY-MM-DD&page=1&pageSize=50
 * 마스터/관리자만
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const table = searchParams.get("table");
  const user = searchParams.get("user");
  const recordId = searchParams.get("record_id");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const page = Math.max(1, Number(searchParams.get("page") || "1"));
  const pageSize = Math.min(200, Math.max(1, Number(searchParams.get("pageSize") || "50")));

  let q = supabase
    .from("audit_logs")
    .select("*", { count: "exact" })
    .order("edited_at", { ascending: false });

  if (table) q = q.eq("table_name", table);
  if (user) q = q.ilike("edited_by", `%${user}%`);
  if (recordId) q = q.eq("record_id", recordId);
  if (from) q = q.gte("edited_at", from);
  if (to) q = q.lte("edited_at", `${to}T23:59:59.999Z`);

  const fromIdx = (page - 1) * pageSize;
  q = q.range(fromIdx, fromIdx + pageSize - 1);

  const { data, error, count } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ rows: data || [], total: count || 0, page, pageSize });
}
