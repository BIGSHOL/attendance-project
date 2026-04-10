-- 1. 선생님 테이블
CREATE TABLE teachers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  name text NOT NULL,
  email text,
  type text NOT NULL CHECK (type IN ('salary', 'commission')),
  commission_rate numeric(5,2),
  created_at timestamptz DEFAULT now()
);

-- 2. 학생 테이블
CREATE TABLE students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  monthly_fee numeric(10,0) NOT NULL DEFAULT 0,
  class_unit_price numeric(10,0) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- 3. 선생님-학생 담당 관계 (다대다)
CREATE TABLE teacher_students (
  teacher_id uuid REFERENCES teachers(id) ON DELETE CASCADE,
  student_id uuid REFERENCES students(id) ON DELETE CASCADE,
  PRIMARY KEY (teacher_id, student_id)
);

-- 4. 출석 기록
CREATE TABLE attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid REFERENCES teachers(id) ON DELETE CASCADE NOT NULL,
  student_id uuid REFERENCES students(id) ON DELETE CASCADE NOT NULL,
  date date NOT NULL,
  check_in time,
  check_out time,
  hours numeric(4,1) NOT NULL DEFAULT 1,
  is_makeup boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- 5. 월별 정산
CREATE TABLE monthly_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid REFERENCES teachers(id) ON DELETE CASCADE NOT NULL,
  year int NOT NULL,
  month int NOT NULL,
  total_hours numeric(6,1) NOT NULL DEFAULT 0,
  amount numeric(12,0) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE (teacher_id, year, month)
);

-- 6. 수납내역
CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_code text NOT NULL,          -- 원생고유번호
  student_name text NOT NULL,
  grade text,
  school text,
  billing_month text NOT NULL,         -- 청구월 (예: 202604)
  payment_name text NOT NULL,          -- 수납명
  charge_amount numeric(12,0) NOT NULL DEFAULT 0,
  discount_amount numeric(12,0) NOT NULL DEFAULT 0,
  paid_amount numeric(12,0) NOT NULL DEFAULT 0,
  unpaid_amount numeric(12,0) NOT NULL DEFAULT 0,
  payment_method text,                 -- 결제수단
  payment_date text,                   -- 수납일
  teacher_name text,                   -- 담임강사 (원본)
  teacher_staff_id text,               -- Firebase staff ID (자동매칭)
  memo text,
  uploaded_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_payments_billing ON payments (billing_month);
CREATE INDEX idx_payments_student ON payments (student_code);

-- 7. RLS 활성화
ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_settlements ENABLE ROW LEVEL SECURITY;

-- 7. RLS 정책
CREATE POLICY "auth_select_teachers" ON teachers FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_select_students" ON students FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_select_teacher_students" ON teacher_students FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_select_attendance" ON attendance FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_select_settlements" ON monthly_settlements FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_insert_teachers" ON teachers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_insert_students" ON students FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_insert_teacher_students" ON teacher_students FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_insert_attendance" ON attendance FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_insert_settlements" ON monthly_settlements FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "auth_update_teachers" ON teachers FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth_update_students" ON students FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth_update_attendance" ON attendance FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth_update_settlements" ON monthly_settlements FOR UPDATE TO authenticated USING (true);

CREATE POLICY "auth_delete_attendance" ON attendance FOR DELETE TO authenticated USING (true);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_select_payments" ON payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_payments" ON payments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_payments" ON payments FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth_delete_payments" ON payments FOR DELETE TO authenticated USING (true);
