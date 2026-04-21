-- 선생님 월별 실급여 캐시
-- AttendancePage가 계산한 값을 그대로 저장 → SettlementPage가 읽어서 표시
-- 동기화 버튼 누를 때 각 선생님마다 upsert

CREATE TABLE IF NOT EXISTS teacher_month_payroll (
  staff_id TEXT NOT NULL,
  billing_month TEXT NOT NULL,         -- "YYYY-MM"
  final_salary INTEGER NOT NULL,
  total_salary INTEGER,
  incentive_total INTEGER,
  settlement_adjust INTEGER,
  admin_salary INTEGER,
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (staff_id, billing_month)
);

CREATE INDEX IF NOT EXISTS idx_teacher_month_payroll_month
  ON teacher_month_payroll(billing_month);

-- RLS — 기존 테이블들과 동일 패턴 (인증된 사용자 전체 허용)
ALTER TABLE teacher_month_payroll ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_teacher_month_payroll" ON teacher_month_payroll
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
