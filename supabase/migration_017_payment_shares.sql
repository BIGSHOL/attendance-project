-- payment_shares: 학생 수납이 여러 강사에게 분배되는 구조 (영어 전용 모델).
--
-- 배경:
--   수학: 1학생 = 1담임 → payments 테이블로 충분.
--   영어: 1학생이 담임 + 부담임 여러 명에게 수납액이 쪼개짐 (40분 유닛 단위).
--         Apps Script 의 "26.03 E" 탭이 이 분배를 이미 계산해 놓고 있고,
--         각 강사별 출석부 YY.MM 탭에도 같은 구조로 학생 행이 기록됨.
--
-- 각 row = (학생, 월, 강사, 반) 조합. 같은 학생이 여러 강사에게 분배되면
-- 각 강사별로 별도 row.
--
-- Phase 1: 동기화 시점에 각 강사 시트의 학생 행을 읽어 upsert.
-- Phase 2: 시간표/결석/수기조정 UI 가 생기면 우리 시스템이 자체 계산해 upsert.

CREATE TABLE IF NOT EXISTS payment_shares (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 학생 (Firebase id 또는 virtual_students.id)
  student_id        text NOT NULL,
  -- 월 ("YYYY-MM")
  month             text NOT NULL,
  -- 담당 강사 (staff_id)
  teacher_staff_id  text NOT NULL,
  -- 반 / tier (예: "의치대 중등", "고등 2T", "중등E_초등 브릿지 B")
  class_name        text NOT NULL,

  -- 이 강사에게 귀속되는 청구액 (원). 담임은 보통 전체 청구 반영,
  -- 부담임은 유닛 비중만큼만.
  allocated_charge  int  NOT NULL DEFAULT 0,
  -- 이 강사에게 귀속되는 실제 납입액 (원). 미납/할인 반영.
  allocated_paid    int  NOT NULL DEFAULT 0,
  -- 이 강사가 담당한 월 총 유닛 수 (등록차수)
  allocated_units   numeric(6, 2),
  -- 유닛단가 (시트 I열)
  unit_price        int,

  -- 출처 표시 ("통합영어시간표(3월)" / "수기조정" / "sheet-import" 등)
  source            text,
  -- 시트의 [8] 디버그 열 등 계산 근거 기록
  debug_note        text,
  -- 수기 조정 여부 — true 이면 sync 가 덮어쓰지 않음
  is_manual         boolean NOT NULL DEFAULT false,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- 같은 (학생, 월, 강사, 반) 조합은 하나만 — sync 가 upsert 대상
  UNIQUE (student_id, month, teacher_staff_id, class_name)
);

CREATE INDEX IF NOT EXISTS payment_shares_teacher_month_idx
  ON payment_shares (teacher_staff_id, month);

CREATE INDEX IF NOT EXISTS payment_shares_student_month_idx
  ON payment_shares (student_id, month);

-- RLS — 인증된 사용자는 조회, 관리자만 수정
ALTER TABLE payment_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY payment_shares_select ON payment_shares
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY payment_shares_all ON payment_shares
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
