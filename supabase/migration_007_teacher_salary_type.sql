-- teacher_settings 에 salary_type + commission_days 추가
-- 기존엔 user_roles 에 저장되었으나, 계정 미매핑 선생님도 설정할 수 있도록
-- staff_id 기반 teacher_settings 로 이관

ALTER TABLE teacher_settings
  ADD COLUMN IF NOT EXISTS salary_type text NOT NULL DEFAULT 'commission'
    CHECK (salary_type IN ('commission', 'fixed', 'mixed')),
  ADD COLUMN IF NOT EXISTS commission_days text[] NOT NULL DEFAULT ARRAY[]::text[];

-- 기존 user_roles 값이 있을 때만 teacher_settings 로 이주 (1회성)
-- user_roles.salary_type / commission_days 컬럼이 없는 환경에서도 실패하지 않도록
-- 동적 SQL + 존재 체크로 방어. commission_days 는 jsonb 이므로 text[] 로 캐스팅.
DO $$
DECLARE
  has_salary_type boolean;
  has_days boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_roles' AND column_name = 'salary_type'
  ) INTO has_salary_type;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_roles' AND column_name = 'commission_days'
  ) INTO has_days;

  IF has_salary_type AND has_days THEN
    EXECUTE $migrate$
      INSERT INTO teacher_settings (staff_id, salary_type, commission_days)
      SELECT
        staff_id,
        COALESCE(salary_type, 'commission'),
        COALESCE(
          ARRAY(SELECT jsonb_array_elements_text(commission_days)),
          ARRAY[]::text[]
        )
      FROM user_roles
      WHERE staff_id IS NOT NULL
      ON CONFLICT (staff_id) DO UPDATE SET
        salary_type = EXCLUDED.salary_type,
        commission_days = EXCLUDED.commission_days,
        updated_at = now();
    $migrate$;
  ELSIF has_salary_type THEN
    EXECUTE $migrate$
      INSERT INTO teacher_settings (staff_id, salary_type)
      SELECT staff_id, COALESCE(salary_type, 'commission')
      FROM user_roles
      WHERE staff_id IS NOT NULL
      ON CONFLICT (staff_id) DO UPDATE SET
        salary_type = EXCLUDED.salary_type,
        updated_at = now();
    $migrate$;
  END IF;
END $$;
