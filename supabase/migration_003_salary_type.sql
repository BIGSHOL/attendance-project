-- 선생님 급여 유형 컬럼 추가
ALTER TABLE user_roles
  ADD COLUMN IF NOT EXISTS salary_type text DEFAULT 'commission'
    CHECK (salary_type IN ('commission', 'fixed', 'mixed')),
  ADD COLUMN IF NOT EXISTS commission_days jsonb DEFAULT '[]'::jsonb;

-- 설명:
-- salary_type:
--   'commission' (비율제): 모든 출석이 급여에 반영
--   'fixed' (급여제): 출석이 급여에 반영되지 않음 (급여 0원)
--   'mixed' (혼합): commission_days 에 해당하는 요일 출석만 반영
-- commission_days: ["월", "화", ...] 형식의 요일 배열
