-- 1. user_roles 에 블로그 작성 의무 컬럼
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS blog_required boolean DEFAULT false;

-- 2. 블로그 작성 기록 테이블 (선생님별 월별)
CREATE TABLE IF NOT EXISTS teacher_blog_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id text NOT NULL,        -- Firebase staff document ID
  year int NOT NULL,
  month int NOT NULL,
  dates jsonb NOT NULL DEFAULT '[]'::jsonb,  -- ["2026-04-05", "2026-04-15", ...]
  note text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (teacher_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_teacher_blog_posts ON teacher_blog_posts (teacher_id, year, month);

-- 3. RLS
ALTER TABLE teacher_blog_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_blog_posts" ON teacher_blog_posts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 설명:
-- blog_required = true 인 선생님은 매월 블로그 작성 날짜(dates)를 1개 이상 입력해야 함
-- 해당 월 기록이 없거나 dates가 비어있으면 정산 시 비율제 ratio에서 -2% 패널티 적용
