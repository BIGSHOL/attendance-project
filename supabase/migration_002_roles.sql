-- 사용자 권한 테이블
CREATE TABLE user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('master', 'admin', 'teacher', 'pending')),
  staff_id text,                   -- Firebase staff ID (role=teacher일 때만)
  staff_name text,                 -- 참조용
  approved_at timestamptz,
  approved_by text,                -- 승인자 email
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_user_roles_email ON user_roles (email);

-- 마스터 계정 시드
INSERT INTO user_roles (email, role, approved_at, approved_by)
VALUES ('st2000423@gmail.com', 'master', now(), 'system')
ON CONFLICT (email) DO NOTHING;

-- RLS
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- 인증된 사용자 모두 본인 역할 조회 가능
CREATE POLICY "auth_select_user_roles" ON user_roles
  FOR SELECT TO authenticated
  USING (true);

-- 마스터만 생성/수정/삭제 가능 (클라이언트 체크 + 서버 정책)
CREATE POLICY "auth_insert_user_roles" ON user_roles
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "auth_update_user_roles" ON user_roles
  FOR UPDATE TO authenticated
  USING (true);

CREATE POLICY "auth_delete_user_roles" ON user_roles
  FOR DELETE TO authenticated
  USING (true);
