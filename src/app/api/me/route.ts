import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  DEV_BYPASS_TOKEN_COOKIE,
  getDevBypassUserRole,
  verifyTokenCookie,
} from "@/lib/devBypass";

/**
 * GET /api/me
 *
 * 현재 로그인한 사용자의 user_roles 데이터를 반환.
 * - dev bypass 쿠키가 유효하면 가상 마스터 데이터 반환 (DB 조회 없음)
 * - 그 외에는 Supabase 세션 + user_roles 테이블 조회
 *   미등록 사용자는 pending 으로 자동 등록
 *
 * 클라이언트의 useUserRole 훅이 이 엔드포인트를 호출해 역할 정보를 가져온다.
 */
export async function GET() {
  const cookieStore = await cookies();
  const devBypassToken = cookieStore.get(DEV_BYPASS_TOKEN_COOKIE)?.value;
  const isDevBypass = verifyTokenCookie(devBypassToken);

  // dev bypass — admin 클라이언트로 진짜 마스터 row 조회 (staff_id 등 실제 데이터)
  if (isDevBypass) {
    const supabase = await createClient(); // service role 있으면 admin, 없으면 anon
    const synthetic = getDevBypassUserRole();
    const { data: real } = await supabase
      .from("user_roles")
      .select("*")
      .eq("email", synthetic.email)
      .single();
    // DB 조회 실패 시 가상 객체 반환 (service role 미설정 상황 포함)
    return NextResponse.json({ userRole: real || synthetic });
  }

  // 일반 Supabase 세션 경로
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ userRole: null }, { status: 401 });
  }

  const { data: existing } = await supabase
    .from("user_roles")
    .select("*")
    .eq("email", user.email)
    .single();

  if (existing) {
    return NextResponse.json({ userRole: existing });
  }

  // 미등록 → pending 등록
  const { data: inserted } = await supabase
    .from("user_roles")
    .insert({ email: user.email, role: "pending" })
    .select()
    .single();

  return NextResponse.json({ userRole: inserted ?? null });
}
