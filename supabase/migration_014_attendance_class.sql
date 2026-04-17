-- 분반 2+ 학생의 행별 독립 출석 저장을 위해 attendance 테이블에 class_name 추가.
-- 기존 UNIQUE(teacher_id, student_id, date) 를 확장해 class_name 포함.
-- 기존 row 는 class_name = '' (단일 분반) 로 취급.

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS class_name text NOT NULL DEFAULT '';

-- 기존 UNIQUE 제거 후 재정의
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_teacher_id_student_id_date_key;
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_unique;

-- 인덱스 기반 UNIQUE (class_name 포함)
CREATE UNIQUE INDEX IF NOT EXISTS attendance_unique_teacher_student_date_class
  ON attendance (teacher_id, student_id, date, class_name);

CREATE INDEX IF NOT EXISTS idx_attendance_class_name
  ON attendance (class_name) WHERE class_name <> '';
