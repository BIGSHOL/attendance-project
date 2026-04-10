-- 선생님별 Google Sheets URL 매핑
-- 1 선생님 : 1 시트 (한 시트 안에 월별 탭)
CREATE TABLE teacher_sheets (
  teacher_id text PRIMARY KEY,     -- Firebase staff.id (ijw-calander)
  sheet_url text NOT NULL,
  last_synced_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE teacher_sheets ENABLE ROW LEVEL SECURITY;

-- 인증된 사용자는 SELECT 가능 (마스터/관리자 체크는 클라이언트 + API 라우트에서)
CREATE POLICY "auth_select_teacher_sheets" ON teacher_sheets
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "auth_insert_teacher_sheets" ON teacher_sheets
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "auth_update_teacher_sheets" ON teacher_sheets
  FOR UPDATE TO authenticated
  USING (true);

CREATE POLICY "auth_delete_teacher_sheets" ON teacher_sheets
  FOR DELETE TO authenticated
  USING (true);
