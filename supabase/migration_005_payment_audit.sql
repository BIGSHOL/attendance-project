-- 결제 수정 이력 추적
-- payments 테이블에 수정자/수정시각 컬럼 추가 + 이력 테이블

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS edited_by text,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

-- 상세 이력 테이블 (필드별 변경 기록)
CREATE TABLE IF NOT EXISTS payment_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  edited_by text NOT NULL,
  edited_at timestamptz NOT NULL DEFAULT now(),
  changes jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_payment_edits_payment ON payment_edits (payment_id, edited_at DESC);

ALTER TABLE payment_edits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_select_payment_edits" ON payment_edits FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_payment_edits" ON payment_edits FOR INSERT TO authenticated WITH CHECK (true);
