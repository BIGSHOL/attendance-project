import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * service role 클라이언트 — RLS 우회. 환경변수 누락 시 null 반환.
 */
function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return [];
      },
      setAll() {},
    },
  });
}

/**
 * 매월 1일 03:00 KST (= 18:00 UTC 전월 말일) 자동 호출 (audit #14).
 *
 * 단계:
 *   1. Vercel Cron 인증 (Authorization: Bearer CRON_SECRET)
 *   2. 등록된 teacher_sheets 통계 — 동기화 미완료 식별
 *   3. audit_logs 에 cron 실행 기록 저장 (운영자가 확인 가능)
 *   4. 결과 요약 JSON 반환 (Vercel 대시보드 로그용)
 *
 * 환경변수:
 *   CRON_SECRET — Vercel 콘솔에서 설정. 누구나 endpoint 호출 못 하게 보호.
 *
 * 추가 자동 작업 (예: 자동 일일 sync) 은 향후 이 endpoint 확장으로 추가 가능.
 */
export async function GET(request: NextRequest) {
  // Vercel Cron 인증 — 헤더 또는 쿼리 파라미터
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const provided =
    authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (cronSecret) {
    if (provided !== cronSecret) {
      return NextResponse.json(
        { error: "Unauthorized — CRON_SECRET 불일치" },
        { status: 401 }
      );
    }
  }

  const now = new Date();
  // KST 기준 다음 월 (cron 이 1일 03:00 KST 에 호출되므로 그 시점이 새 달)
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const year = kst.getUTCFullYear();
  const month = kst.getUTCMonth() + 1;

  let summary: {
    year: number;
    month: number;
    timestamp: string;
    teacherSheets: { total: number; registered: number };
    error?: string;
  } = {
    year,
    month,
    timestamp: now.toISOString(),
    teacherSheets: { total: 0, registered: 0 },
  };

  try {
    // service role 로 RLS 우회
    const supabase = getServiceClient();
    if (!supabase) {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY 환경변수 미설정");
    }

    const { data: sheets } = await supabase.from("teacher_sheets").select("*");
    const total = (sheets || []).length;
    const registered = (sheets || []).filter(
      (s: { sheet_url?: string | null }) => !!s.sheet_url
    ).length;

    summary.teacherSheets = { total, registered };

    // audit_logs 에 cron 실행 기록 — 사용자가 변경이력 페이지에서 확인 가능
    await supabase.from("audit_logs").insert({
      table_name: "cron",
      record_id: `prepare-month-${year}-${String(month).padStart(2, "0")}`,
      action: "bulk",
      changes: { summary },
      edited_by: "system:vercel-cron",
      edited_by_name: "Vercel Cron",
    });
  } catch (e) {
    summary = {
      ...summary,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  return NextResponse.json({
    ok: true,
    message: `${year}년 ${month}월 cron 실행됨 — 시트 ${summary.teacherSheets.registered}/${summary.teacherSheets.total}명 등록됨`,
    summary,
  });
}
