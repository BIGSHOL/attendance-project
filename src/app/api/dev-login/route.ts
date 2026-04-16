import { NextRequest, NextResponse } from "next/server";
import {
  DEV_BYPASS_EMAIL,
  DEV_BYPASS_EMAIL_COOKIE,
  DEV_BYPASS_TOKEN_COOKIE,
  getDevBypassPassword,
  isDevBypassEnabled,
  verifyPassword,
} from "@/lib/devBypass";

/**
 * POST /api/dev-login
 *
 * 개발 환경 전용 — 비밀번호 검증 후 dev bypass 쿠키를 설정해
 * Google 로그인 없이 마스터 권한으로 접근 가능하게 한다.
 *
 * 프로덕션 빌드에서는 404 반환.
 */
export async function POST(request: NextRequest) {
  if (!isDevBypassEnabled()) {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }

  // env 설정 확인
  if (!getDevBypassPassword() || !process.env.DEV_BYPASS_SECRET) {
    return NextResponse.json(
      { error: "DEV_BYPASS_PASSWORD 또는 DEV_BYPASS_SECRET 환경변수 미설정" },
      { status: 500 }
    );
  }

  let password = "";
  try {
    const body = await request.json();
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }

  const token = verifyPassword(password);
  if (!token) {
    return NextResponse.json(
      { error: "비밀번호가 일치하지 않습니다" },
      { status: 401 }
    );
  }

  const response = NextResponse.json({
    ok: true,
    email: DEV_BYPASS_EMAIL,
  });

  // 서버 검증용: HttpOnly
  response.cookies.set(DEV_BYPASS_TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false, // dev 환경이라 http 허용
    path: "/",
    maxAge: 60 * 60 * 24, // 24시간
  });

  // 클라이언트 UI 힌트: 비 HttpOnly
  response.cookies.set(DEV_BYPASS_EMAIL_COOKIE, DEV_BYPASS_EMAIL, {
    httpOnly: false,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 60 * 60 * 24,
  });

  return response;
}

/**
 * DELETE /api/dev-login
 * dev bypass 세션 로그아웃
 */
export async function DELETE() {
  if (!isDevBypassEnabled()) {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(DEV_BYPASS_TOKEN_COOKIE);
  response.cookies.delete(DEV_BYPASS_EMAIL_COOKIE);
  return response;
}
