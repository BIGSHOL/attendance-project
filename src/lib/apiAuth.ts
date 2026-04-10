import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

type AuthResult =
  | { ok: true; email: string; role: "master" | "admin" | "teacher" | "pending" }
  | { ok: false; response: NextResponse };

type Client = SupabaseClient;

/**
 * 로그인된 사용자인지 확인
 */
export async function requireAuth(supabase: Client): Promise<AuthResult> {
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
