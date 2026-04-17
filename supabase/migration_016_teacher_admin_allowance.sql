-- teacher_settings 에 행정급여 필드 추가
-- 김민주 선생님처럼 학생 수업 외 행정업무를 겸임하는 선생님의 월 고정 행정급여.
--
-- 계산식: admin_base_amount × (tier.ratio / 100) × (1 - academyFee / 100)
--   - admin_base_amount: 월 기본액 (원)
--   - admin_tier_id: salaryConfig.items 중 참조할 tier 의 id
--     (해당 tier 의 ratio / 수수료 기준으로 실급여 환산)
--
-- 기존 가상 학생(virtual_행정1~5) 방식에서 선생님 설정 필드 방식으로 이관.

ALTER TABLE teacher_settings
  ADD COLUMN IF NOT EXISTS admin_base_amount integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS admin_tier_id text;
