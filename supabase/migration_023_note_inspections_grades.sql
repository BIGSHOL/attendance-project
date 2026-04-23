-- note_inspections.status 값을 등급(ABCF)으로 전환
--   기존: done / needs_fix / missing
--   신규: A / B / C / F
--     A : 우수
--     B : 양호
--     C : 미흡
--     F : 미제출 / 불량
--
-- 기존 데이터 마이그레이션:
--   done       → A (정상 검사 완료를 우수로 간주)
--   needs_fix  → C (보완 필요 = 미흡)
--   missing    → F (미제출)

-- 1) CHECK 제약 제거 (제약 이름이 자동 생성이라 동적 조회)
DO $$
DECLARE
  constr_name text;
BEGIN
  SELECT conname INTO constr_name
  FROM pg_constraint
  WHERE conrelid = 'note_inspections'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%';
  IF constr_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE note_inspections DROP CONSTRAINT %I', constr_name);
  END IF;
END $$;

-- 2) 기본값 일단 제거 (새 기본값 적용 시 경합 방지)
ALTER TABLE note_inspections ALTER COLUMN status DROP DEFAULT;

-- 3) 기존 데이터 변환
UPDATE note_inspections SET status = 'A' WHERE status = 'done';
UPDATE note_inspections SET status = 'C' WHERE status = 'needs_fix';
UPDATE note_inspections SET status = 'F' WHERE status = 'missing';

-- 4) 새 CHECK 제약 + 기본값
ALTER TABLE note_inspections
  ADD CONSTRAINT note_inspections_status_check
  CHECK (status IN ('A', 'B', 'C', 'F'));
ALTER TABLE note_inspections ALTER COLUMN status SET DEFAULT 'A';
