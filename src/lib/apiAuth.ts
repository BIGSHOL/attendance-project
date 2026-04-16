import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEV_BYPASS_EMAIL,
  DEV_BYPASS_TOKEN_COOKIE,
  verifyTokenCookie,
} from "@/lib/devBypass";

type AuthResult =
  | { ok: true; email: string; role: "master" | "admin" | "teacher" | "pending" }
  | { ok: false; response: NextResponse };

type Client = SupabaseClient;

/**
 * 로그인된 사용자인지 확인
 */
export async function requireAuth(supabase: Client): Promise<AuthResult> {
  // 개발 환경 로그인 우회 — 유효한 dev bypass 쿠키가 있으면 마스터로 간주
  const cookieStore = await cookies();
  const devBypassToken = cookieStore.get(DEV_BYPASS_TOKEN_COOKIE)?.value;
  if (verifyTokenCookie(devBypassToken)) {
    return { ok: true, email: DEV_BYPASS_EMAIL, role: "master" };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
    return {
      ok: false,
      response: NextResponse.json({ error: "인증 필요" }, { status: 401 }),
    };
  }
  const { data: role } = await supabase
    .from("user_roles")
    .select("role")
    .eq("email", user.email)
    .single();
  const userRole = (role?.role || "pending") as AuthResult extends { ok: true }
    ? AuthResult["role"]
    : "master" | "admin" | "teacher" | "pending";
  return { ok: true, email: user.email, role: userRole };
}

/**
 * 관리자 이상(admin / master)만 허용
 */
export async function requireAdmin(supabase: Client): Promise<AuthResult> {
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth;
  if (auth.role !== "master" && auth.role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json({ error: "권한 부족 (관리자 이상 필요)" }, { status: 403 }),
    };
  }
  return auth;
}

/**
 * 마스터만 허용
 */
export async function requireMaster(supabase: Client): Promise<AuthResult> {
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth;
  if (auth.role !== "master") {
    return {
      ok: false,
      response: NextResponse.json({ error: "권한 부족 (마스터 필요)" }, { status: 403 }),
    };
  }
  return auth;
}
