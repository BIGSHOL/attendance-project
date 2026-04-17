-- migration_014 보강: 기존 UNIQUE 제약 이름이 환경마다 다를 수 있으므로
-- attendance 테이블의 모든 UNIQUE constraint 을 동적으로 찾아 제거한 후
-- (teacher_id, student_id, date, class_name) 기반 UNIQUE INDEX 를 재생성.

DO $$
DECLARE
  con_name text;
BEGIN
  FOR con_name IN
    SELECT conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'attendance'
      AND contype = 'u'   -- UNIQUE
  LOOP
    EXECUTE format('ALTER TABLE attendance DROP CONSTRAINT IF EXISTS %I', con_name);
  END LOOP;
END $$;

-- class_name 컬럼 보장 (014 누락 대비)
ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS class_name text NOT NULL DEFAULT '';

-- 기존 인덱스도 초기화 후 재생성
DROP INDEX IF EXISTS attendance_unique_teacher_student_date_class;
CREATE UNIQUE INDEX attendance_unique_teacher_student_date_class
  ON attendance (teacher_id, student_id, date, class_name);

-- 보조 인덱스
DROP INDEX IF EXISTS idx_attendance_class_name;
CREATE INDEX idx_attendance_class_name
  ON attendance (class_name)
  WHERE class_name <> '';
