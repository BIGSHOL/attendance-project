import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DEV_BYPASS_TOKEN_COOKIE, verifyTokenCookie } from "@/lib/devBypass";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // 개발 환경 로그인 우회 — 유효한 dev bypass 쿠키가 있으면 Supabase 세션 체크 건너뜀
  const devBypassToken = request.cookies.get(DEV_BYPASS_TOKEN_COOKIE)?.value;
  if (verifyTokenCookie(devBypassToken)) {
    return supabaseResponse;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 로그인 안 된 상태에서 대시보드 접근 시 로그인 페이지로
  // /api/dev-login, /api/me 는 자체적으로 401/JSON 응답하므로 리다이렉트 예외
  const pathname = request.nextUrl.pathname;
  if (
    !user &&
    !pathname.startsWith("/login") &&
    !pathname.startsWith("/auth") &&
    !pathname.startsWith("/api/dev-login") &&
    !pathname.startsWith("/api/me")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
