-- 선생님 설정 (staff_id 기반, 계정 매핑과 독립)
-- blog_required 를 user_roles에서 분리하기 위함

CREATE TABLE IF NOT EXISTS teacher_settings (
  staff_id text PRIMARY KEY,          -- Firebase staff document ID
  blog_required boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE teacher_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_select_teacher_settings" ON teacher_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_teacher_settings" ON teacher_settings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_teacher_settings" ON teacher_settings FOR UPDATE TO authenticated USING (true);

-- 기존 user_roles.blog_required 데이터를 teacher_settings로 이주 (1회성)
INSERT INTO teacher_settings (staff_id, blog_required)
SELECT staff_id, blog_required
FROM user_roles
WHERE staff_id IS NOT NULL AND blog_required = true
ON CONFLICT (staff_id) DO UPDATE SET blog_required = EXCLUDED.blog_required;
