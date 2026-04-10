-- 학생별 급여 tier 오버라이드 (선생님×학생 단위)
-- 시트 F열의 "중등 3T" 같은 값을 SalarySettingItem.name 과 매칭해 저장

CREATE TABLE student_tier_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id text NOT NULL,
  student_id text NOT NULL,
  salary_item_id text NOT NULL,   -- SalaryConfig.items[].id
  tier_name text,                 -- 원본 텍스트 (디버깅용)
  updated_at timestamptz DEFAULT now(),
  UNIQUE (teacher_id, student_id)
);

CREATE INDEX idx_student_tier_overrides_teacher ON student_tier_overrides (teacher_id);

ALTER TABLE student_tier_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all_student_tier_overrides" ON student_tier_overrides
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
