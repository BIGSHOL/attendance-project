import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { DEV_BYPASS_TOKEN_COOKIE, verifyTokenCookie } from "@/lib/devBypass";

/**
 * 서버 측 Supabase 클라이언트 생성.
 *
 * 기본은 anon key + 요청 쿠키로 생성해 사용자 세션을 따른다.
 * 유효한 dev bypass 토큰이 있고 SUPABASE_SERVICE_ROLE_KEY 가 설정돼 있으면
 * service role key 로 admin 클라이언트를 반환해 RLS 를 우회한다.
 *
 * service role 은 모든 RLS 를 무시하는 관리자 권한이므로 dev 환경 로그인 우회 경로에서만 사용.
 */
export async function createClient() {
  const cookieStore = await cookies();

  // dev bypass: service role key 가 있으면 admin 클라이언트 반환
  const devBypassToken = cookieStore.get(DEV_BYPASS_TOKEN_COOKIE)?.value;
  if (verifyTokenCookie(devBypassToken)) {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (serviceKey) {
      return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        serviceKey,
        {
          cookies: {
            // service role 클라이언트는 사용자 쿠키를 읽을 필요 없음 (RLS 무시)
            getAll() {
              return [];
            },
            setAll() {},
          },
        }
      );
    }
    // service role key 미설정 — anon 으로 폴백 (RLS 에 막힘)
  }

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Component에서 호출 시 무시
          }
        },
      },
    }
  );
}
