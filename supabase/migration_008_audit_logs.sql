-- 통합 변경 이력 (수납/세션/단가/설정 등 모든 쓰기 작업 기록)
-- 출석부는 빈번하므로 별도 처리 (현재는 미적용)

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,            -- 'payments', 'session_periods', 'tier_overrides' 등
  record_id text NOT NULL,             -- 대상 row id (uuid 또는 text key)
  action text NOT NULL CHECK (action IN ('insert', 'update', 'delete', 'bulk')),
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { field: { from, to } } 또는 스냅샷
  edited_by text NOT NULL,             -- 사용자 이메일 또는 'system:...'
  edited_by_name text,                 -- 표시용
  edited_at timestamptz NOT NULL DEFAULT now(),
  context jsonb DEFAULT '{}'::jsonb    -- { page, ua, note 등 부가정보 }
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_table_record
  ON audit_logs (table_name, record_id, edited_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user
  ON audit_logs (edited_by, edited_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_recent
  ON audit_logs (edited_at DESC);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- 조회는 마스터/관리자만 (클라이언트 + API 양쪽에서 강제)
-- 정책은 일단 authenticated 로 열고 API 라우트에서 권한 체크
CREATE POLICY "auth_select_audit_logs" ON audit_logs
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_insert_audit_logs" ON audit_logs
  FOR INSERT TO authenticated WITH CHECK (true);
