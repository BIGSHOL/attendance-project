-- teacher_settings.salary_type / user_roles.salary_type 의 CHECK 제약 확장
-- part_time (파트타임) 값 허용.
--
-- 기존 제약(migration_003, migration_007) 은 ('commission', 'fixed', 'mixed') 만 허용하므로
-- 파트타임으로 전환 시 INSERT/UPDATE 가 차단됨. 제약 이름은 Postgres 자동 생성이라
-- pg_constraint 에서 동적으로 찾아 drop 후 재생성.

-- teacher_settings
DO $$
DECLARE
  constr_name text;
BEGIN
  SELECT conname INTO constr_name
  FROM pg_constraint
  WHERE conrelid = 'teacher_settings'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%salary_type%';
  IF constr_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE teacher_settings DROP CONSTRAINT %I', constr_name);
  END IF;
END $$;

ALTER TABLE teacher_settings
  ADD CONSTRAINT teacher_settings_salary_type_check
  CHECK (salary_type IN ('commission', 'fixed', 'mixed', 'part_time'));

-- user_roles (salary_type 컬럼이 있는 환경에서만)
DO $$
DECLARE
  has_col boolean;
  constr_name text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_roles' AND column_name = 'salary_type'
  ) INTO has_col;
  IF has_col THEN
    SELECT conname INTO constr_name
    FROM pg_constraint
    WHERE conrelid = 'user_roles'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%salary_type%';
    IF constr_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE user_roles DROP CONSTRAINT %I', constr_name);
    END IF;
    ALTER TABLE user_roles
      ADD CONSTRAINT user_roles_salary_type_check
      CHECK (salary_type IN ('commission', 'fixed', 'mixed', 'part_time'));
  END IF;
END $$;
