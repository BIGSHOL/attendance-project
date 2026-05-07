import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/apiAuth";

/**
 * GET /api/admin/audit-logs
 *   ?table=...           — 단일 테이블 (legacy, single-select)
 *   ?tables=a,b,c        — 다중 테이블 (audit #16)
 *   ?actions=insert,update — 다중 action (audit #16)
 *   ?user=...&record_id=...&from=YYYY-MM-DD&to=YYYY-MM-DD
 *   &page=1&pageSize=50
 * 마스터/관리자만
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const table = searchParams.get("table");
  const tablesParam = searchParams.get("tables");
  const actionsParam = searchParams.get("actions");
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

  // 테이블 필터 — tables(다중) 우선, 없으면 table(legacy single)
  const tableList = tablesParam
    ? tablesParam.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  if (tableList.length > 0) {
    q = q.in("table_name", tableList);
  } else if (table) {
    q = q.eq("table_name", table);
  }

  // action 필터 (다중)
  const actionList = actionsParam
    ? actionsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  if (actionList.length > 0) {
    q = q.in("action", actionList);
  }

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
