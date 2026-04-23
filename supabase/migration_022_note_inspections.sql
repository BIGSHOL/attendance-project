-- 노트 검사 기록 테이블
-- 학생별 노트 검사 이벤트 (상담과 유사하게 이벤트 기반)
--   - 상담과 달리 이 테이블은 앱에서 직접 읽기·쓰기
--   - 학생 정보는 ijw-calander 에 있으므로 studentId/studentName 은 denormalized 저장
--   - 선생님 canonical name 으로 teacher_name 저장

CREATE TABLE IF NOT EXISTS note_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id text NOT NULL,              -- ijw-calander student id
  student_name text NOT NULL,
  teacher_name text NOT NULL,            -- 담당(또는 검사한) 선생님 canonical name
  date date NOT NULL,
  status text NOT NULL DEFAULT 'done'
    CHECK (status IN ('done', 'needs_fix', 'missing')),
  -- done       : 정상 검사 완료
  -- needs_fix  : 보완 필요 / 재작성 요청
  -- missing    : 미제출
  memo text,
  created_by text,                       -- 기록자 이메일 (감사용)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_note_inspections_date
  ON note_inspections(date);
CREATE INDEX IF NOT EXISTS idx_note_inspections_student
  ON note_inspections(student_id);
CREATE INDEX IF NOT EXISTS idx_note_inspections_teacher
  ON note_inspections(teacher_name);
-- 월별 × 선생님별 조회 최적화
CREATE INDEX IF NOT EXISTS idx_note_inspections_date_teacher
  ON note_inspections(date, teacher_name);

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION set_note_inspections_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_note_inspections_updated_at ON note_inspections;
CREATE TRIGGER trg_note_inspections_updated_at
  BEFORE UPDATE ON note_inspections
  FOR EACH ROW EXECUTE FUNCTION set_note_inspections_updated_at();
