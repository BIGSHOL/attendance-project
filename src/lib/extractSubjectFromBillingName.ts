import type { SalarySubject } from "@/types";

/**
 * MakeEdu billing.billingName 에서 과목(SalarySubject) 추정.
 *
 * billing 의 teacher_staff_id 가 분반 코드만 들어있어 null 인 경우(수학 분반 다수),
 * 학생-과목 단위로 청구액을 귀속시키기 위한 보조 함수.
 *
 * 패턴 (4월 1,245건 분석 결과):
 *   수학(math):
 *     - 중등M / 초등M / 고등M  + 공백/언더바
 *     - "이성우반" / "김화영반" / "김민주반" 등 — 강사명 + "반"
 *   영어(english):
 *     - 중등E / 초등E / 고등E / 중고E  + 공백/언더바 (대소문자 무관 E)
 *     - [EiE] / [EIE] / EIE / EiE — Early in English 분반
 *   기타(other):
 *     - [과학]  → SalarySubject "other"
 */
export function extractSubjectFromBillingName(
  name: string | undefined | null
): SalarySubject | undefined {
  if (!name) return undefined;

  // ⚠ prefix 매칭이 우선. "강사명+반" fallback 보다 먼저 시도해야
  //   "고등E_고1 특별반 Gina ..." 같이 영어 분반 + "특별반" 토큰 혼재 케이스에서
  //   "특별반" → math 로 잘못 추정되어 다른 과목 row 의 leftover 로 합산되는 사고 방지.

  // 수학 분반 prefix
  if (/^[중초고]등M(?:[\s_]|$)/.test(name)) return "math";

  // 영어 분반 prefix (수학 강사명+반 패턴보다 먼저 — 영어 분반에 "특별반" 등 토큰 포함 케이스 대응)
  if (/^[중초고]등[Ee](?:[\s_]|$)/.test(name)) return "english";
  if (/^중고[Ee](?:[\s_]|$)/.test(name)) return "english";
  if (/^\[?E[iI]E\]?/.test(name)) return "english";

  // 과학 / 기타
  if (/^\[과학\]/.test(name)) return "other";

  // 강사명 + "반" — 보통 수학 (이성우반 등). 영어 강사는 "반" 접미사 안 씀.
  //   단, 영어 분반 prefix 가 위에서 이미 잡혔으므로 여기 도달했다는 건 그 prefix 가 아닐 때.
  if (/[가-힣]{2,}반(?:\s|$)/.test(name)) return "math";

  return undefined;
}
