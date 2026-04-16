-- student_tier_overrides 의 class_name 을 NOT NULL (기본 '') 로 고정하고
-- 정식 UNIQUE 제약조건으로 바꿔 ON CONFLICT upsert 를 사용할 수 있게 함.
-- (앞 migration_010 의 부분 인덱스는 ON CONFLICT target 으로 쓸 수 없음)

-- 기존 NULL 값 빈 문자열로 치환
UPDATE student_tier_overrides SET class_name = '' WHERE class_name IS NULL;

-- NOT NULL + 기본값 ''
ALTER TABLE student_tier_overrides ALTER COLUMN class_name SET DEFAULT '';
ALTER TABLE student_tier_overrides ALTER COLUMN class_name SET NOT NULL;

-- 부분 UNIQUE INDEX 제거 (migration_010 에서 만든 것)
DROP INDEX IF EXISTS idx_student_tier_overrides_triple;

-- 정식 UNIQUE 제약조건 추가 (ON CONFLICT 가능)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'student_tier_overrides'::regclass
      AND contype = 'u'
      AND conname = 'student_tier_overrides_teacher_student_class_key'
  ) THEN
    ALTER TABLE student_tier_overrides
      ADD CONSTRAINT student_tier_overrides_teacher_student_class_key
      UNIQUE (teacher_id, student_id, class_name);
  END IF;
END $$;
