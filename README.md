# Injaewon 출석부

학원 출석부 + 급여 정산 통합 시스템. 매월 선생님 시트(Google Sheets) 를 동기화해서 출석 / 청구 / 정산 / 시수 검증을 한 화면에서 관리합니다.

## 주요 기능

- **출석부** — 선생님 / 분반 / 학생별 월간 캘린더 뷰. 시수 입력 / 메모 / 숙제 / 컬러 마킹.
- **시트 동기화** — Google Sheets 의 월별 탭(`YY.MM`)을 Supabase 로 일괄 import. 분반(tier) / 단가 / 강사 귀속 수납까지 함께 sync.
- **정산** — 비율제 / 급여제 / 혼합 / 파트타임 4가지 급여 유형. 시수 × 단가 × 비율 + 블로그 인센티브 + 행정급여.
- **시수 검증** — 학생별 청구액 ÷ 단가 vs 실제 출석시수 비교. 학원 청구와 실 수업의 정합성 점검.
- **권한 체계** — 마스터 / 관리자 / 선생님 3단계. 마스터: `st2000423@gmail.com`.

## 기술 스택

| 영역 | 사용 기술 |
|---|---|
| 프레임워크 | Next.js 16 (App Router, Turbopack) |
| 언어 | TypeScript 5 |
| UI | React 19 + Tailwind CSS 4 |
| DB (운영) | Supabase (PostgreSQL) — 출석 / 정산 / 수납 / 분배 |
| DB (참조) | Firebase Firestore (프로젝트 `ijw-calander`, DB `restore20260319`) — 선생님 / 학생 마스터 데이터 (읽기 전용) |
| 인증 | Supabase Auth (Google OAuth) |
| 외부 | Google Sheets API (시트 sync), Firebase Admin SDK |
| 배포 | Vercel |

## 디렉토리 구조

```
src/
├── app/                # App Router 페이지 + API routes
├── components/         # UI 컴포넌트 (AttendancePage / SettlementPage 등)
├── hooks/              # 데이터 훅 (useStaff / useStudents / useAttendance / useMonthlySettlement ...)
├── lib/
│   ├── supabase/       # Supabase 클라이언트 (client / server / middleware)
│   ├── firebase.ts     # Firebase (ijw-calander) 연결
│   ├── firebase-admin.ts
│   ├── salary.ts       # 급여 계산 로직 (matchSalarySetting / calculateFinalSalary)
│   ├── syncSheet.ts    # Google Sheets → Supabase 동기화
│   ├── studentPaymentMatcher.ts
│   └── ...
└── types/              # 공유 타입
supabase/
├── schema.sql          # 현재 스키마 전체
└── migration_001~024_*.sql  # 적용 순서대로 보관된 마이그레이션
```

## 셋업

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경 변수 (`.env.local`)

**Supabase**
```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...      # 서버 전용. RLS 우회용 (마이그레이션 / cron / admin API)
```

**Firebase (클라이언트 — `ijw-calander` 프로젝트)**
```bash
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=ijw-calander
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
```

**Firebase Admin (서버 — 같은 프로젝트의 service account)**
```bash
FIREBASE_ADMIN_PROJECT_ID=ijw-calander
FIREBASE_ADMIN_CLIENT_EMAIL=
FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
```

**Google Sheets API (시트 sync) — 아래 4가지 중 하나로 제공**
```bash
# 옵션 A: env 변수 직접
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."

# 옵션 B: 파일 경로
GOOGLE_SERVICE_ACCOUNT_PATH=/abs/path/to/service-account.json

# 옵션 C: base64 인코딩된 service account JSON
GOOGLE_SERVICE_ACCOUNT_B64=

# 옵션 D: raw JSON
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```

**선택**
```bash
CRON_SECRET=                # /api/cron/* 호출 인증
SHEETS_API_KEY=             # 상담 시트 API 키
DEV_BYPASS_PASSWORD=        # 개발 모드 우회 로그인
DEV_BYPASS_SECRET=
```

### 3. Supabase 스키마 적용

신규 환경: `supabase/schema.sql` 적용 후 `migration_001` ~ `migration_024` 를 번호 순서대로 실행.

기존 환경 업데이트: 적용 안 된 migration 만 순서대로 실행.

### 4. 개발 서버

```bash
npm run dev          # http://localhost:3000
```

## 권한 체계

| 역할 | 권한 |
|---|---|
| 마스터 | 모든 기능 + 사용자 권한 변경. `st2000423@gmail.com` 고정. |
| 관리자 | 전체 학생 / 선생님 / 정산 / 동기화. 사용자 권한 변경 불가. |
| 선생님 | 본인 담당 출석부 / 블로그 / 본인 정산만. |

권한 정보는 Supabase `user_roles` 테이블에서 관리. Google 로그인 후 마스터가 `/admin/users` 에서 역할 부여.

## 배포

Vercel 자동 배포 — `main` 브랜치 push 시 production 배포. 환경 변수는 Vercel 프로젝트 설정에서 동일하게 등록.

## 추가 문서

- [`CLAUDE.md`](./CLAUDE.md) — AI 에이전트(Claude Code 등) 작업 시 따라야 할 코드 / 데이터 규칙, 데이터 모델 함정, 디버깅 워크플로우.
- [`AGENTS.md`](./AGENTS.md) — Next.js 16 breaking change 안내.
