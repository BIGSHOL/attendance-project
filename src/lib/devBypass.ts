/**
 * 개발 환경 전용 로그인 우회
 *
 * NODE_ENV=development 에서만 동작.
 * 프로덕션 빌드에서는 모든 함수가 null/false 반환하여 완전히 비활성화됨.
 *
 * 동작 원리:
 * - /api/dev-login 에 DEV_BYPASS_PASSWORD 로 POST 하면
 *   HttpOnly 쿠키 `dev_bypass_token` (서버 검증용) 과
 *   일반 쿠키 `dev_bypass_email` (UI 힌트용) 이 설정됨
 * - 서버는 요청마다 `dev_bypass_token` 값을 DEV_BYPASS_SECRET 과 상수시간 비교
 * - 클라이언트 훅은 `dev_bypass_email` 로 자신이 마스터로 로그인됐다고 판단
 */

export const DEV_BYPASS_TOKEN_COOKIE = "dev_bypass_token";
export const DEV_BYPASS_EMAIL_COOKIE = "dev_bypass_email";

/** 마스터로 임시 로그인될 이메일 (user_roles 테이블에 master 로 등록되어 있어야 함) */
export const DEV_BYPASS_EMAIL = "st2000423@gmail.com";

/** 개발 환경에서만 dev bypass 활성화 */
export function isDevBypassEnabled(): boolean {
  return process.env.NODE_ENV === "development";
}

/** DEV_BYPASS_SECRET (env 값, 쿠키 토큰으로 사용됨) */
function getSecret(): string | null {
  const secret = process.env.DEV_BYPASS_SECRET;
  if (!secret || secret.length < 16) return null;
  return secret;
}

/** DEV_BYPASS_PASSWORD (env 값, 클라이언트 입력과 비교) */
export function getDevBypassPassword(): string | null {
  const pw = process.env.DEV_BYPASS_PASSWORD;
  if (!pw) return null;
  return pw;
}

/** 상수시간 문자열 비교 (타이밍 공격 방어) */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/** 비밀번호가 일치하면 쿠키에 심을 토큰 반환 */
export function verifyPassword(input: string): string | null {
  if (!isDevBypassEnabled()) return null;
  const expected = getDevBypassPassword();
  const secret = getSecret();
  if (!expected || !secret) return null;
  if (!safeEqual(input, expected)) return null;
  return secret;
}

/** 요청의 쿠키에서 dev bypass 토큰을 추출해 검증 */
export function verifyTokenCookie(tokenValue: string | undefined): boolean {
  if (!isDevBypassEnabled()) return false;
  if (!tokenValue) return false;
  const secret = getSecret();
  if (!secret) return false;
  return safeEqual(tokenValue, secret);
}

/**
 * dev bypass 활성 시 돌려줄 가상 마스터 UserRoleData.
 * 클라이언트/서버에서 실제 DB 조회 없이 마스터 권한으로 인식되게 만든다.
 */
export function getDevBypassUserRole() {
  const now = new Date().toISOString();
  return {
    id: "dev-bypass-master",
    email: DEV_BYPASS_EMAIL,
    role: "master" as const,
    staff_id: null,
    staff_name: "개발자(마스터)",
    salary_type: "fixed" as const,
    commission_days: [],
    blog_required: false,
    approved_at: now,
    approved_by: "dev-bypass",
    created_at: now,
  };
}
