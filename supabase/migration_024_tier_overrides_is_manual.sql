-- migration_024 — student_tier_overrides 에 is_manual 컬럼 추가.
--
-- 목적: 운영자가 학생 상세 페이지에서 직접 추가한 분반(class_name) 을
--   시트 동기화 시 보호 (덮어쓰기 금지).
--
-- 패턴: payment_shares.is_manual (migration_017) 과 동일.
--   - true  → 사용자가 앱에서 직접 추가. sync 시 skip.
--   - false → 시트 동기화 결과 또는 레거시 row. sync 가 갱신 가능.
--
-- 기존 row 는 모두 false 로 시작 (시트 sync 결과로 간주).

ALTER TABLE student_tier_overrides
  ADD COLUMN IF NOT EXISTS is_manual BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN student_tier_overrides.is_manual IS
  '관리자가 앱에서 직접 추가한 row. true 면 시트 sync 시 덮어쓰기 금지.';

-- sync 가 is_manual=false 인 row 만 빠르게 필터하기 위한 부분 인덱스.
-- (조회 빈도 낮으므로 부분 인덱스로 디스크 절약)
CREATE INDEX IF NOT EXISTS idx_student_tier_overrides_auto
  ON student_tier_overrides (teacher_id, student_id, class_name)
  WHERE is_manual = FALSE;
