import type { SupabaseClient } from "@supabase/supabase-js";

export type AuditAction = "insert" | "update" | "delete" | "bulk";

export interface AuditOptions {
  table: string;
  recordId: string;
  action: AuditAction;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /** before/after 비교 없이 임의 변경 내용을 직접 넣고 싶을 때 */
  changes?: Record<string, unknown>;
  editedBy: string;
  editedByName?: string | null;
  context?: Record<string, unknown>;
}

const IGNORED_DIFF_KEYS = new Set([
  "updated_at",
  "edited_at",
  "edited_by",
  "uploaded_at",
  "created_at",
]);

function diff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set<string>([
    ...Object.keys(before || {}),
    ...Object.keys(after || {}),
  ]);
  for (const k of keys) {
    if (IGNORED_DIFF_KEYS.has(k)) continue;
    const a = before ? (before as Record<string, unknown>)[k] : undefined;
    const b = after ? (after as Record<string, unknown>)[k] : undefined;
    // jsonb 등은 깊은 비교를 위해 stringify 비교
    const aStr = JSON.stringify(a ?? null);
    const bStr = JSON.stringify(b ?? null);
    if (aStr !== bStr) out[k] = { from: a ?? null, to: b ?? null };
  }
  return out;
}

/**
 * audit_logs 에 변경 이력 1건 기록.
 * 실패해도 본 작업은 계속되도록 try/catch 로 감싸서 사용 권장.
 */
export async function logAudit(
  supabase: SupabaseClient,
  opts: AuditOptions
): Promise<void> {
  let changes: Record<string, unknown>;
  if (opts.changes) {
    changes = opts.changes;
  } else if (opts.action === "insert") {
    changes = { after: opts.after ?? {} };
  } else if (opts.action === "delete") {
    changes = { before: opts.before ?? {} };
  } else {
    const d = diff(opts.before, opts.after);
    if (Object.keys(d).length === 0) return; // 실제 변경 없음 → 기록 생략
    changes = d;
  }

  await supabase.from("audit_logs").insert({
    table_name: opts.table,
    record_id: opts.recordId,
    action: opts.action,
    changes,
    edited_by: opts.editedBy,
    edited_by_name: opts.editedByName ?? null,
    context: opts.context ?? {},
  });
}

/** 안전한 fire-and-forget 래퍼 — 본 작업 실패 위험 없이 호출 */
export function logAuditSafe(
  supabase: SupabaseClient,
  opts: AuditOptions
): void {
  void logAudit(supabase, opts).catch((e) => {
    // 로깅 실패는 콘솔에만 남기고 무시
    console.error("[audit] 기록 실패", e);
  });
}
