-- Firebase에 등록되지 않았지만 시트에 출석이 존재하는 학생을 저장.
-- 시트가 원본 권위를 가지므로, 동기화 시 Firebase 에 없더라도 출석 집계에
-- 포함되도록 여기에 upsert 한다.
-- 이후 Firebase 쪽에 진짜 학생이 등록되면 여기 레코드는 무시(중복 매칭 회피)된다.

CREATE TABLE IF NOT EXISTS virtual_students (
  id text PRIMARY KEY,                       -- "virtual_{name}_{school}_{grade}"
  name text NOT NULL,
  school text,
  grade text,
  teacher_staff_id text NOT NULL,            -- 시트 담임명 또는 staff_id
  class_name text,                           -- 시트 F열 tier (예: "초등 3T")
  days text[] DEFAULT '{}',                  -- ["화","금"]
  subject text DEFAULT 'math',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_virtual_students_teacher
  ON virtual_students (teacher_staff_id);

-- RLS 는 기본 비활성: 내부 API 만 사용 (service role 로 접근).
-- 프로덕션에서 RLS 필요 시 여기에 정책 추가.
