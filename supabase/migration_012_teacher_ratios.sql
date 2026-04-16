-- 선생님별 급여 비율 오버라이드 저장.
-- 기존 INITIAL_SALARY_CONFIG.teacherRatios 하드코딩 → DB 영속화.
-- 구조: teacher_settings.ratios jsonb
--   { "math":    { "초등": 45, "중등": 47.5, "고등": 48, "수능": 50, "특강": 50 },
--     "english": { "초등": 43, "중등": 44, "고등": 45.5, ... } }

ALTER TABLE teacher_settings
  ADD COLUMN IF NOT EXISTS ratios jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN teacher_settings.ratios IS
  '과목×그룹별 선생님 비율 오버라이드. 예: {"math":{"초등":47.5,"중등":48.5}}';
