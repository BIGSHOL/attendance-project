-- payment_splits: Firebase billing 의 단일 청구를 여러 강사에게 분배.
--
-- 배경:
--   Firebase billing 은 MakeEdu 동기화 결과로 read-only. 한 청구는 한 분반 코드만
--   포함하지만, 실제 운영에서는 같은 반 안에서 담임/부담임으로 청구액이 쪼개져야
--   할 때가 있다. (예: 류다인 "중등M 초6 MS2B 월목" 288k → 담임 김화영 216k,
--   부담임 72k)
--
-- 키 설계:
--   Firebase billing.id 는 MakeEdu sync 시 변할 가능성이 있어 직접 참조 불가능.
--   대신 (월, 학생 이름+학교, billingName) natural key 로 묶는다.
--   sync 후에도 같은 청구이면 같은 split 으로 매칭됨.
--
-- 운영 흐름:
--   1) 관리자가 수납 페이지의 청구 row 에서 [분리] 액션 실행
--   2) 모달에서 강사별 분배 금액 입력 (합계 = 원본 청구액 강제)
--   3) Supabase 에 저장
--   4) 수납 페이지: 부모 row + 강사별 breakdown 으로 표시
--   5) 정산 시수 검증: split 이 있는 청구는 강사별 분배 금액으로 대체

CREATE TABLE IF NOT EXISTS payment_splits (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 청구 식별 natural key — Firebase billing 의 자연키
  billing_month    text NOT NULL,           -- "2026-04"
  student_name     text NOT NULL,
  student_school   text NOT NULL DEFAULT '', -- 동명이인 구분 (빈 문자열 허용)
  billing_name     text NOT NULL,           -- "중등M 초6 MS2B 월목"

  -- 원본 청구액 — 검증용 (변경되면 운영자에게 알림 후 재분배)
  original_amount  integer NOT NULL,

  -- 분배 내용 — [{teacher_staff_id, teacher_name, amount, role}]
  --   role 은 optional 메모 ("담임", "부담임" 등)
  splits           jsonb NOT NULL,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       text,
  updated_by       text,

  -- 같은 (월, 학생, 학교, 청구명) 조합은 split 하나만
  UNIQUE (billing_month, student_name, student_school, billing_name)
);

CREATE INDEX IF NOT EXISTS payment_splits_month_idx
  ON payment_splits (billing_month);

CREATE INDEX IF NOT EXISTS payment_splits_student_idx
  ON payment_splits (student_name, student_school);

-- RLS — 인증된 사용자는 조회, 관리자(admin/master) 만 수정
ALTER TABLE payment_splits ENABLE ROW LEVEL SECURITY;

CREATE POLICY payment_splits_select ON payment_splits
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY payment_splits_all ON payment_splits
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.email = auth.jwt() ->> 'email'
        AND user_roles.role IN ('master', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.email = auth.jwt() ->> 'email'
        AND user_roles.role IN ('master', 'admin')
    )
  );
