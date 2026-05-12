/**
 * MakeEdu billing.billingName 에서 담임 강사 추출.
 *
 * 패턴 예시:
 *   "중등E_중1 정규 A Jane 화수금 16:20-18:10"  → englishName="Jane" → staff 매칭
 *   "중등M 중3 BS2O 화금"                        → 분반 코드(BS2O) → 강사 매칭 불가
 *   "초등M 개별 JJ2I 수"                          → 분반 코드(JJ2I) → 매칭 불가
 *   "스쿨버스비"                                  → category=차량비, 매칭 불가
 *
 * 우선순위:
 *   1) billingName 토큰 중 staff.englishName 정확 일치 (영어 강사 — 가장 흔함)
 *   2) billingName 토큰 중 staff.name 정확 일치 (한국이름 직접 노출 케이스)
 *   3) 매칭 실패 → undefined
 *
 * 매칭 실패는 정상 — 차량비/교재/원복 등 강사가 없는 청구가 다수.
 * 수학 분반은 분반 코드만 들어가서 별도 tier 역매칭이 필요하지만, 그건 호출측 책임.
 */

interface StaffMin {
  id: string;
  name: string;
  englishName?: string;
}

export interface TeacherMatch {
  staffId?: string;
  teacherName?: string;
}

export function extractTeacherFromBillingName(
  billingName: string | undefined | null,
  staff: StaffMin[]
): TeacherMatch {
  if (!billingName) return {};

  // 공백 / 언더바 / 괄호 기준 토큰화.
  //   "중등E_중1 정규 A Jane 화수금"     → ["중등E","중1","정규","A","Jane","화수금"]
  //   "이성우반 내신대비 주말보강 (고등)" → ["이성우반","내신대비","주말보강","고등"]
  //   "교재 (김화영)"                    → ["교재","김화영"]
  const tokens = billingName.split(/[\s_()\[\]]+/).filter(Boolean);

  // (1) 영어이름 — 영어 강사는 staff.englishName 으로 들어감
  for (const t of tokens) {
    const found = staff.find((s) => s.englishName && s.englishName === t);
    if (found) return { staffId: found.id, teacherName: found.name };
  }

  // (2) 한국이름 정확 일치 — "(김화영)" 같이 토큰화 후 단독으로 나타나는 케이스
  for (const t of tokens) {
    const found = staff.find((s) => s.name === t);
    if (found) return { staffId: found.id, teacherName: found.name };
  }

  // (3) 한국이름 prefix 일치 — "이성우반", "김화영T" 같이 이름 뒤에 접미사 붙은 케이스
  //   3자 이상 한국이름만 (2자 이름은 오매칭 위험 큼 — "김민" 이 "김민주" 와 충돌)
  for (const t of tokens) {
    const found = staff.find(
      (s) => s.name.length >= 3 && t.startsWith(s.name)
    );
    if (found) return { staffId: found.id, teacherName: found.name };
  }

  return {};
}
