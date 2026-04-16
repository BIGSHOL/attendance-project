import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEV_BYPASS_EMAIL,
  DEV_BYPASS_TOKEN_COOKIE,
  verifyTokenCookie,
} from "@/lib/devBypass";

/** 서버 컴포넌트/라우트에서 인증된 사용자 이메일을 가져온다.
 *  dev bypass 쿠키가 유효하면 마스터 이메일을 우선 반환.
 *  그 외에는 Supabase 세션으로 확인. 없으면 null.
 */
export async function getAuthedUser(
  supabase: SupabaseClient
): Promise<{ email: string } | null> {
  const cookieStore = await cookies();
  const devBypassToken = cookieStore.get(DEV_BYPASS_TOKEN_COOKIE)?.value;
  if (verifyTokenCookie(devBypassToken)) {
    return { email: DEV_BYPASS_EMAIL };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;
  return { email: user.email };
}
