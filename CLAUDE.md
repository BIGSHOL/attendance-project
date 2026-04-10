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
