@AGENTS.md

# 출석부 프로젝트

## 언어 규칙
- 모든 UI 텍스트, 주석, 커밋 메시지 등 세부 내용은 한글로 작성
- 코드 변수명/함수명은 영어 허용, 그 외 사용자에게 보이는 모든 텍스트는 한글

## UI 규칙
- 목록은 반드시 페이지네이션 사용 (무한 스크롤 금지)
- 출석부 테이블은 월별 달력 형태로 가로 스크롤 허용
- 라운드 최소화: `rounded-sm` 이하만 사용 (rounded-lg, rounded-xl 금지)
- 테이블/목록 래퍼에 rounded 금지 (스크롤과 겹쳐서 사다리꼴 현상 발생)
- 뱃지/태그에만 `rounded-full` 허용
- 스크롤바는 전역 CSS(`src/app/globals.css`)에서 얇은 스타일로 통일됨 (8px, 회색 thumb, 투명 track). 개별 컴포넌트에서 스크롤바 스타일 오버라이드 금지

## 필터/상태 영속화 규칙
- 모든 목록/페이지의 필터값(검색어, 체크박스 필터, 정렬, 선택된 월 등)은 `localStorage`에 저장하여 다음 방문 시에도 유지
- 키 네이밍: `{페이지명}.{필드명}` 형식 (예: `studentList.subjects`, `payments.selectedMonth`)
- `useLocalStorage`, `useLocalStorageSet` 훅 사용 (`src/hooks/useLocalStorage.ts`)
- 단, `page`(현재 페이지 번호), 편집 중인 상태 등 일시적 UI 상태는 저장하지 않음

## 기능 범위
- **시험/점수 연동 기능 사용 안 함** (출석부 전용 프로젝트)
- 출석 셀은 단일 값 표시 (출석값/메모/숙제만, 시험 점수 X)

## 기술 스택
- Next.js (App Router)
- Supabase (PostgreSQL) — 출석 기록, 급여 정산
- Firebase Firestore (ijw-calander 프로젝트) — 선생님/학생 데이터 읽기 전용
- Google 로그인 (Supabase Auth)
- Tailwind CSS
- Vercel 배포

## 프로젝트 구조
- `src/lib/supabase/` — Supabase 클라이언트 (client, server, middleware)
- `src/lib/firebase.ts` — Firebase 연결 (ijw-calander DB: restore20260319)
- `src/hooks/` — 데이터 훅 (useStaff, useStudents, useAttendance)
- `src/components/` — UI 컴포넌트
- `supabase/schema.sql` — DB 스키마

## 데이터 모델 — 가정하기 전 반드시 검증할 것

### 청구액은 `payments` 와 `payment_shares` 양쪽에 동시 존재할 수 있다 (이중 청구 함정)
- `payments`: 수납탭에서 직접 입력된 학원비 (실제 청구의 진실)
- `payment_shares`: 시트 sync(`source: sheet:YY.MM`) 가 시수 × 단가 환산값으로 만든 강사 귀속 분배
- **둘은 같은 청구의 다른 표현이지 합쳐야 할 별개 청구가 아님.** 단순 합산하면 청구액이 2배 가까이 부풀어오름 (2026-04 수학 +60.5M 사고).
- `paid` 계산 공식: 선생님별로 `payments` 있으면 그 값, 없으면 `payment_shares` fallback. 합산 금지.
- 영어 강사 시트만 shares 에 저장된다는 코드 주석은 거짓. 수학·과학도 시트 sync 하면 shares 가 생성됨.

### 청구는 수업료만 — 교재/차량비 절대 포함 금지
- 이 프로그램은 **출석부**. 정산도 수업과 관련된 청구만 다룸.
- Firebase `billing.category` 분포: `수업` / `원복` / `교재` / `차량비`. **수업+원복 만 사용**.
- 교재/차량비는 MakeEdu 외부 시스템에서 별도 관리. 출석부 화면에 가져오면 시수 환산(`청구액 ÷ 단가`) 에서 의미 없는 시수가 만들어지고 정산 합계가 부풀어오름.
- `/api/billing` 기본값이 `categories=수업,원복`. 호출 측은 별도 파라미터 없이 사용 (`?month=YYYY-MM` 단독).
- `categories=all` 옵션은 디버깅 용도. 운영 코드(`PaymentsPage`, `usePaymentsForMonth`)에서는 사용 금지.
- `parsePaymentExcel.ts` 가 "교재 포함 행 제거" 했던 정책과 일관.

### `staff.id` 자체가 복합 포맷일 수 있다 (영어 강사)
- 영어 강사 `staff.id` 는 `"EnglishName 한국이름"` 결합 포맷 (예: `"Charlie 정은지"`, `"Gina 신명진"`, `"Jane 추민아"`, `"Sarah 강보경"`). 한국 강사는 한국이름 단독.
- 일부 영어 강사는 `staff.id` 가 영어이름 단독 (예: `"Kelly"` — name="이수연", englishName="Hannah" 인데 id 만 "Kelly").
- `payment_shares.teacher_staff_id` 는 항상 `staff.id` 와 정확 일치 (sync 코드가 `teacherId` 그대로 저장). **매칭 실패로 보이면 staff DB 의 id 포맷부터 확인.** 결합 포맷이 매칭 실패 원인이라고 짐작하지 말 것.

### 학생 매칭에서 동명이인 / virtual_id 함정
- `findStudentPayments` 는 `student_id` 직접 매칭이 아니라 `studentCode` 또는 `student_name + school` 매칭 (`src/lib/studentPaymentMatcher.ts`).
- `d.students.find(x => x.name === '...')` 만 쓰면 첫 매칭만 반환. **항상 `name + school` 로 좁혀서 동명이인 구분.**
- 시트 sync 가 만드는 virtual student id 포맷: `virtual_{teacherId}_{이름}_{학교}_{학년}` (예: `virtual_Kelly_김하윤C_침산초1_초1`, `virtual_Sam 김태건_김하윤C_납부 확인_납부 확인`). 같은 이름의 firebase 학생과 별개로 존재함.

### 시트의 `unit_price` 는 회당 단가가 아닐 수 있다
- 영어 일부 강사 시트는 unit_price 칸에 회당 단가 대신 **월 수강료** 가 입력됨 (예: 200,000원).
- 단가 × attendance 시수 로 청구액 fallback 환산하면 2,000,000원 단위의 비정상 값이 만들어짐.
- 시수 검증(`SettlementPage.studentChecks`) 같은 화면에서 청구액을 자동 환산하지 말 것. 청구액 자체를 검증의 분자로 쓰는 화면에서 자동 환산하면 항상 일치하게 되어 검증 의미 소실.
- sync 본체(`syncSheet.ts`)에서 charge fallback 은 시트 N/P열(`units`/`classUnits`)이 있을 때만 적용. **attendance 시수 합으로 fallback 금지** (위 위험 때문).

### `attendance.hours` 는 출석 status 와 무관하게 그대로 합산됨
- 시수 검증 코드는 `r.hours > 0` 이면 합산 (status 미반영). `isAttendanceCountable` 은 정산 본체에는 쓰이지만 시수 검증에는 안 씀.
- 결석/공휴일은 hours=0 으로 들어가야 정상. hours 값이 비정상이면 출석 status 분리 로직을 다시 보지 말고 입력 데이터부터 점검.

### `payments.billing_month` 포맷 다양성
- DB 에 `"202604"`, `"2026-04"`, `"2026/04"`, `"2026.04"` 4가지 포맷이 혼재. `billingMonthMatches` 가 모두 매칭.
- `/api/payments?months=...` 쿼리는 4가지를 모두 candidate 로 보내야 누락 없음.

### API endpoint 정확한 경로
- `/api/staff` (O) — `/api/teachers` 는 404
- `/api/students`, `/api/payments?months=...`, `/api/payment-shares?month=YYYY-MM`, `/api/attendance/all?year=YYYY&month=M`
- chrome MCP 디버깅 시: `window.__data = await Promise.all([...])` 로 한 번 모아두고 분석. 매번 fetch 하지 말 것.

### `payment_shares` 디버깅용 marker
- `source: "sheet:YY.MM"` 가 박혀있으면 시트 sync 로 만들어진 row. `is_manual=true` 면 사용자가 직접 추가 (sync 가 덮어쓰지 않음). 디버깅 시 source 부터 확인.

### Firebase `billing` 은 학교/담임강사 정보를 거의 안 채움
- MakeEdu sync 결과 `billing.school` 은 거의 모든 row 에서 빈 문자열. `externalStudentId` 도 비어있는 경우 많음.
- `billing` 에 강사 필드 자체가 없음. ijw-calander UI 도 `students` collection 에서 join 해서 표시하는 구조. 우리 앱도 동일하게 보강해야 함.
- **수납 페이지 표시**: 빈 학교는 `student.school` 로 fallback. 빈 담임강사는 ① `extractTeacherFromBillingName` (영어강사 영어이름 토큰 — Sarah/Jane 등) ② `enrollment.className` 이 `billingName` 의 prefix 매칭 (분반 코드 케이스 — `"중등M 초6 MS2B"` ↔ `"중등M 초6 MS2B 월목"`) ③ 단일 enrollment.
- **boost matching key 일관성**: `(month, name, school, billingName)` natural key 사용 시 `school` 은 항상 `student.school` (정규화된 단축형) 으로 통일. `payment.school` 은 원본이 빈 값이라 키 불일치 발생. 페이지 간 일관 통일.

### 강사별 단가는 enrollment.className 의 학년 prefix 기준 (학생 grade 가 아님)
- 같은 학생도 분반에 따라 다른 단가: 초6 학생이 "중등M 초6 MS2B" 분반(선행)을 들으면 **중등 단가** 적용.
- `matchSalarySetting` 은 `student.grade` 만 보고 group 결정 — 분반 다양성 반영 불가.
- 헬퍼 `classNameToGroup(className)` 사용: `"중등M ..."` → `"중등"`, `"초등M ..."` → `"초등"` 등. payment_name 에도 동일하게 적용 가능 (첫 토큰 패턴 동일).
- 시수 검증의 `teacherBreakdown` 에서 강사별 단가 따로 매칭 — `settingForBilling/settingForEnrollment` 사용.

### 시수 검증의 강사별 row 는 (강사 × 수납명) 단위 — 합산 금지
- 같은 강사가 두 수납명에서 청구 받으면 **별도 row** (예: 김은정이 "초등M JJ2I" 85k + "중등M MS2B 부담임" 72k → 두 row, 합산 안 함).
- 수납명마다 단가/예상시수/실제시수 모두 별도 표시 — 학년 prefix 가 다르면 단가도 다름.
- `teacherBreakdown` 항목 키 = `(tid, billingName, role)`.
- **출석시수 분배 (2026-05 개선)**: 우선순위 3단계 적용.
  1. **share 매칭**: `share.allocated_paid === row.paid` 또는 `share.unit_price` 로 `row.paid` 가 .5 단위로 떨어지면 매칭. 매칭된 share 의 `class_name` 으로 `attendance.class_name` 직접 매칭 (학년 prefix 우회). billing.payment_name 이 분반 코드 (예: "고등M 중3 BS4B") 라 attendance.class_name (예: "중등 3T") 와 학년 prefix 다른 케이스 (학생이 선행 분반 듣기) 대응.
  2. **학년 prefix 매칭**: share 매칭 못 한 row 는 `classNameToGroup(row.billingName)` 으로 attendance 학년 prefix 매칭. share 가 이미 소비한 attendance.class_name 은 제외 (이중 분배 방지).
  3. **leftover fallback**: 매칭 안 된 시수는 **같은 강사의 paid 가장 큰 row** (메인 청구) 에 할당. `insertOrder` 첫 row (보통 부담임 작은 청구) 가 아닌 메인 분반. (이전 버그: 김은민의 9시간이 "김화영반" 72k row 에 잘못 몰림 — 메인 "고등M..." 192k 가 정답.)

### `payment_splits` — 수납 분리 (한 청구를 강사별 쪼개기)
- Firebase billing 한 청구를 담임/부담임으로 쪼개는 수기 분배 (예: "중등M 초6 MS2B 월목" 288k → 김화영 216k + 김은정 72k).
- 별개 수납명(다른 청구)을 통합하는 게 아니라 **한 수납명 내부에서만 쪼개기**. 별개 수납명은 그대로 유지.
- Supabase `payment_splits` 테이블 — natural key `(billing_month, student_name, student_school, billing_name)` (Firebase billing.id 가 sync 시 변할 수 있어 직접 참조 불가).
- 분배 합계 = 원본 청구액 강제 (저장 시 검증).
- 권한: 관리자(admin/master) 만 입력/수정/삭제.
- 시수 검증의 매칭 0순위 — splits 가 있으면 그게 진실. 같은 청구에 다른 매칭(직접/className/share) 적용 안 됨 (`usedPaymentIds` 마킹).
- splits 에 등장한 강사는 enrollment 없어도 자동으로 `teacherIds` 에 추가 (부담임은 보통 enrollment 안 잡힘).

### 시수 검증의 차이 부호 = 실제 − 예상
- 양수 = 청구 대비 수업을 더 진행 (emerald). 음수 = 덜 진행 (red).
- `diffSessions = units - expectedSessions`, `diffAmount = units * unitPrice - paid`.
- 안내 텍스트: "+ 는 청구 대비 수업을 더 진행한 상태, − 는 청구 대비 수업이 덜 진행된 상태입니다."

### 단가 매칭 — 정산의 핵심 (테스트 하네스 필수)
- 수업은 **물리적으로 .5/.0 단위로만** 진행됨. 예상시수가 .1/.2/.3 같은 값으로 나오면 단가가 틀린 것.
- **시수 검증의 단가 결정 우선순위 (2026-05 개선)** — share 가 시트 기준 진실 단가:
  1. **share.allocated_paid 가 row.paid 와 정확 일치** — share.unit_price 사용 (가장 신뢰)
  2. **share.unit_price 로 row.paid 가 .5 단위로 떨어짐** — share.unit_price 사용 (시트 share 와 billing 청구가 1회 차이날 때 — 예: share 9회/216k vs billing 8회/192k, 단가 24k 동일)
  3. **pickBillingUnitPrice fallback** (`src/lib/billingUnitPrice.ts`):
     a. 청구액 ÷ 단가 가 .5 단위로 떨어지는 단가 자동 추론
     b. 떨어지는 게 여러 개면 2T 우선
     c. 자동 매칭 실패하면 2T → 3T → 첫 매칭 fallback
- **회귀 차단 테스트**: `src/lib/billingUnitPrice.test.ts` — 22개 케이스로 정책 검증.
- ⚠ 단가 매칭 정책을 바꾸려면 **반드시 `npm test` 통과** + 의도 명시. 테스트 깨면 정산 전체 어긋남.

### 예상시수 표시 — `.1` 단위 raw 표시 (`roundToHalf` 강제 반올림 금지)
- 수업은 .5/.0 단위로만 진행되므로 정확 매칭이면 자연히 .0/.5 로 떨어짐.
- **단가 오매칭 시 raw 소수점 표시 (예: 9.8)** 가 사용자에게 어긋남 신호. `roundToHalf(9.846) = 10.0` 강제 반올림은 단가 오매칭을 가려서 사고 인지 불가.
- 코드: `Math.round((paid / unitPrice) * 10) / 10` (.1 자리).
- floating-point 오차 (9.5000001) 는 .1 단위 반올림으로 자연히 9.5 정리.
- 검증된 케이스:
  - `85,000 ÷ 21,250 = 4.0` → 초등 3T 자동 선택, 표시 4.0
  - `288,000 ÷ 24,000 = 12.0` → 중등 3T, 표시 12.0
  - `216,000 ÷ 24,000 = 9.0` (분리분) → 중등 3T, 표시 9.0
  - `180,000 ÷ 22,500 = 8.0` → 초등 2T, 표시 8.0
  - `288,000 ÷ 29,250 = 9.846` (단가 오매칭) → **표시 9.8** (raw 노출로 어긋남 인지)

### share-path 가드는 "시트 sync 된 모든 강사" — 영어 한정 금지
- e1e502d (Firebase billing 도입) 시점에 Supabase payments → Firebase billing 갈아끼면서 수학·과학 분반은 billing 에 강사 정보 부재 (분반 코드만). billing 기반 매칭이 실패하면 paidAmount=0 → `Math.min(0, gross)=0` → **학생당 급여 0원**.
- 시트 sync 가 만든 `payment_shares` 가 진실. `teacherShares.length > 0` 이면 영어/수학/과학 무관 share-path 사용해야 함.
- ⚠ 가드 위치 (영어 한정 코드 잔존 시 같은 사고 재발):
  - `src/lib/teacherPayroll.ts` — `buildStudentRows`, `buildPaidAmountByStudent`, `buildUnitPriceByStudent` 3곳
  - `src/lib/attendancePageData.ts` — `buildMonthPayments`, `buildStudentRows`, `buildTermCountMap`, `buildPaidAmountByStudent`, `buildUnitPriceByStudent` 4곳
  - `src/components/AttendancePage.tsx` — `usePaymentShares(selectedTeacherId, ...)` 가드 없이 호출
- 모두 `teacherShares.length > 0` 만 보는 것이 정답. `isEnglishTeacher && ...` 패턴은 금지.

### share.class_name 기반 tierOverrides 자동 보강 필수
- 시트 F열 sync 가 일부 분반 (특히 "특강" 류) tier-override 를 누락하는 경우 있음. 누락되면 `matchSalarySetting` 이 학생 grade 기반 fallback 으로 group="고등/중등/초등" 적용 → ratio 어긋남 (특강 50% → 고등 48.5%).
- share-path 진입 시점에 share.class_name 이 salaryConfig.items.name 과 정확 일치하는 tier 가 있으면 tierOverrides Map 보강 필수. `computeTeacherMonthPayroll` (정산 페이지), AttendancePage 의 `effectiveTierOverrides` useMemo (출석부).
- 김화영 4월 케이스: "고1특강"/"중등특강" share 엔 있는데 tier_overrides 엔 누락 → 보강 안 하면 ratio 48.5% 적용되어 시트와 4만원 차이.

### enrollment 중복 제거 키에 `className` 필수 포함
- `studentChecks` useMemo 가 학생 그룹의 enrollment 통합 시 중복 제거. 키를 `subject|teacher|staffId` 만 쓰면 같은 강사의 다른 분반이 1개로 제거됨 (이시우의 김화영 "중등M 초6 MS2B-2" + "중등M 초6 MS2B" 둘 다 active 인데 첫 분반만 남음).
- step 3 (`enrollment.className` prefix 매칭) 에서 첫 분반만 시도 → billing.payment_name 이 다른 분반과 매칭되어야 할 때 leftover 로 빠지고 share fallback 과 **이중 청구** 발생 (이시우 504k 사고).
- 키: `subject|teacher|staffId|className`. SettlementPage.tsx line ~1028.

### `extractSubjectFromBillingName` 매칭 순서 — 명시적 prefix 우선, 강사명+반 fallback
- "고등E_고1 특별반 Gina 금 19:10-22:00..." 같이 영어 분반에 "특별반" 토큰 혼재 시, 강사명+반 패턴 (`/[가-힣]{2,}반/`) 이 영어 prefix 보다 먼저 시도되면 **math 로 잘못 추정**되어 다른 과목 row 의 `leftoverSubjectPayments` 에 영어 청구가 합산 → 부모 row paid 부풀려짐 (이승민 408k → 735k 사고).
- 매칭 순서 필수: math prefix → english prefix(들) → 과학 → **강사명+반 (math fallback)**.
- 회귀 차단: `src/lib/extractSubjectFromBillingName.ts`. 변경 시 영어 청구가 math 로 잘못 들어가는지 검증.

### 시수 검증 filter chain 순서 — 강사 재계산 `.map` 후 `차이있는건만` filter
- 강사 필터 적용 시 row 의 sub-row 합으로 부모 row 의 paid/units/expectedSessions/diff 재계산하는 `.map` 단계 존재. "차이있는건만" filter 가 재계산 _전_ 에 실행되면 원본 diff (≠0) 로 통과 후 재계산되어 0 인 row 도 표시되는 사고.
- filter chain 순서 필수: `subject → search → teacher → .map(재계산) → 차이있는건만`.
- SettlementPage.tsx 의 시수 검증 테이블 `studentChecks.filter(...)` 체인.

### `flex-wrap` 컨테이너에서 일관 위치 — `basis-full` divider 강제 줄바꿈
- KPI 박스 + 다음 element (과목 탭 등) 가 같은 flex-wrap 컨테이너에 있으면 KPI 길이 차이로 element 위치가 좌/우 흔들림 (영어 강사 KPI 가 더 길어 wrap → 과목 탭 다음 줄 vs 수학 강사 한 줄에 들어감 → 과목 탭 같은 줄).
- 항상 일관 위치 원하면 `<div className="basis-full" />` divider 로 강제 새 줄. `flex-1 min-w-[8px]` spacer 만으로는 부족 (KPI 가 짧을 때만 우측 정렬).
- AttendancePage.tsx 의 상단 KPI 줄 — 과목 탭/선생님 selector 분리 패턴.

### `monthPayments` state 변형 사고 (미해결, 별도 조사 필요)
- SettlementPage 의 `monthPayments` state 가 raw `/api/billing` 응답과 다름 (이승민 408,750 → 367,875, 김주연 360,000 → 327,000, 119건 누락). 직접 chrome fetch 는 정상.
- `usePaymentsForMonth` → `cachedFetch` → fetch + setState 단순 흐름인데 결과가 다름.
- 검사 시도: cache dump 0건, SW 없음, backend 응답 일관 (828건). 클라이언트 측 변형 source 미상.
- 조사 후보: React 18 strict mode useEffect double-invoke, fetchCache module 인스턴스 분리 (HMR), 다른 hook (`usePaymentSplits`/`usePaymentShares`) 이 monthPayments 데이터 mutation, useState 초기값 stale.
- ⚠ 변형이 있어도 시수 검증 매칭 알고리즘 (위 share 단가 매칭) 이 robust 해서 대부분 정상 표시되지만, 일부 row 는 단가 어긋남으로 사용자가 인지 가능.

## 디버깅 워크플로우
- UI 표시값 ↔ 백엔드 데이터 불일치 의심 시 순서:
  1. 화면 표시값을 학생/과목 단위로 빼낸다 (DOM 또는 console)
  2. 백엔드 API 4종(`/api/students`, `/api/payments`, `/api/payment-shares`, `/api/attendance/all`) 를 `window.__data` 에 캐싱
  3. 해당 학생의 `student_id` 정확 매칭으로 raw row 확인 — name 만 쓰지 말 것
  4. UI 가 사용하는 계산 로직(보통 `useMemo` 안)을 수동으로 재현해서 값이 어떻게 만들어지는지 추적
- 가설 세우기 전에 데이터 형태(특히 staff.id, enrollment.staffId, share.teacher_staff_id) 가 어떻게 생겼는지부터 한 줄로 출력.
- chrome MCP 검증 후 dev 서버에 코드 변경하면 **`location.reload()`** 명시적으로 호출. React state 가 stale 일 수 있어 단순 페이지 이동만으로는 새 코드 미반영 사례 있음.

### Supabase RLS — 스크립트로 attendance/payments 직접 조회 불가
- `.env.local` 에 `SUPABASE_SERVICE_ROLE_KEY` 없음. ANON KEY 로는 RLS 정책상 attendance/payments/payment_shares 모두 `TO authenticated` 라 anon 으로 0 rows 반환.
- 진단 스크립트에서 attendance/payments 0 rows 나오면 데이터 부재로 단정 금지. **dev 서버 + chrome MCP 인증 세션** 으로 확인해야 함.
- Firebase 는 Admin SDK 라 스크립트로 직접 조회 가능 (`scripts/inspectBilling.mjs` 등).
- 빈 데이터를 코드 매칭 문제로 오진하지 말 것 — 항상 인증된 클라이언트로 한 번 더 확인.

### 5월(현재 월) 출석부에 출석체크가 거의 안 됨 — 정상
- 2026-05 월 attendance 전체 9건뿐 (4월은 6,038건). 시수 검증 0 이라고 매칭 버그로 의심하지 말 것.
- 학원 운영 패턴: 강사들이 월 중반/말에 몰아서 입력. 월초 검증은 의미 없을 수 있음.

## 검증 명령
- `npm run dev` — 개발 서버 (chrome MCP 검증 시 필수)
- `npx tsc --noEmit` — 타입 체크. 정산/시수 로직 수정 후 반드시 실행
- `npm test` — vitest 회귀 차단 (단가 매칭 등 핵심 로직). 정산 로직 수정 후 반드시 실행
- `npm run lint` — ESLint
- `npm run build` — production 빌드 검증
- 패치 후: ① 타입 체크 → ② 테스트 → ③ 의심 케이스 1명 백엔드 raw 데이터로 재현 → ④ UI 새로고침 후 값 비교. 4단계 다 통과해야 머지.

## 관련 문서
- [`README.md`](./README.md) — 프로젝트 소개 / 셋업 / 환경 변수 / 권한 체계
- [`AGENTS.md`](./AGENTS.md) — Next.js 16 breaking change 안내 (이 파일 첫 줄에서 import)
- [`docs/archive/`](./docs/archive) — 과거 audit / 검증 리포트 (historical record)
- 진단 스크립트: `scripts/verifySalary.mjs`, `scripts/dumpSheet.mjs`
