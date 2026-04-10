-- 기존 테이블 삭제 (데이터 없으므로 안전)
DROP TABLE IF EXISTS monthly_settlements CASCADE;
DROP TABLE IF EXISTS attendance CASCADE;
DROP TABLE IF EXISTS teacher_students CASCADE;
DROP TABLE IF EXISTS students CASCADE;
DROP TABLE IF EXISTS teachers CASCADE;

-- 출석 기록 (Firebase ID 사용)
CREATE TABLE attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id text NOT NULL,        -- Firebase staff document ID
  student_id text NOT NULL,        -- Firebase student document ID
  date date NOT NULL,
  hours numeric(4,1) NOT NULL DEFAULT 1,
  memo text DEFAULT '',
  cell_color text DEFAULT '',
  homework boolean DEFAULT false,
  is_makeup boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (teacher_id, student_id, date)
);

-- 월별 정산
CREATE TABLE monthly_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id text NOT NULL,        -- Firebase staff document ID
  year int NOT NULL,
  month int NOT NULL,
  has_blog boolean DEFAULT false,
  has_retention boolean DEFAULT false,
  other_amount numeric(12,0) DEFAULT 0,
  note text DEFAULT '',
  is_finalized boolean DEFAULT false,
  finalized_at timestamptz,
  salary_config jsonb,             -- 확정 시 급여 설정 스냅샷
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (teacher_id, year, month)
);

-- 급여 설정 (선생님별)
CREATE TABLE salary_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id text NOT NULL UNIQUE,  -- Firebase staff document ID ('global' = 전체 설정)
  config jsonb NOT NULL,            -- SalaryConfig JSON
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 인덱스
CREATE INDEX idx_attendance_teacher_date ON attendance (teacher_id, date);
CREATE INDEX idx_attendance_student_date ON attendance (student_id, date);
CREATE INDEX idx_attendance_date ON attendance (date);
CREATE INDEX idx_settlements_teacher ON monthly_settlements (teacher_id, year, month);

-- RLS
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_configs ENABLE ROW LEVEL SECURITY;

-- 인증된 사용자 접근 정책
CREATE POLICY "auth_all_attendance" ON attendance FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_settlements" ON monthly_settlements FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_salary_configs" ON salary_configs FOR ALL TO authenticated USING (true) WITH CHECK (true);
