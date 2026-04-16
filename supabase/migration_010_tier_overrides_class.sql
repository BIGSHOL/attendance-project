-- 학생 분반(class)별 급여 tier 오버라이드 지원
-- 기존 스키마는 (teacher_id, student_id) 유니크라 학생당 1 tier만 저장 가능.
-- 한 학생이 같은 선생님에게 서로 다른 분반(요일/단가) 수업을 듣는 경우를 지원하기 위해
-- class_name 컬럼 추가 및 유니크 키 재정의.
--
-- class_name 은 수납명/enrollment className 기준. NULL 이면 기본(레거시) 학생 단위.

ALTER TABLE student_tier_overrides ADD COLUMN IF NOT EXISTS class_name text;

-- 기존 유니크 제약 해제 후 3필드 조합으로 재정의
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'student_tier_overrides'::regclass
    AND contype = 'u'
    AND conname LIKE 'student_tier_overrides%'
  ) THEN
    EXECUTE (
      SELECT 'ALTER TABLE student_tier_overrides DROP CONSTRAINT ' || quote_ident(conname)
      FROM pg_constraint
      WHERE conrelid = 'student_tier_overrides'::regclass
        AND contype = 'u'
        AND conname LIKE 'student_tier_overrides%'
      LIMIT 1
    );
  END IF;
END $$;

-- NULL 도 유니크에 포함시켜야 "class_name 미지정" 레코드가 선생님×학생당 하나만 존재 가능.
-- PostgreSQL 기본 UNIQUE 는 NULL 을 중복 허용하므로, COALESCE 표현식으로 처리.
CREATE UNIQUE INDEX IF NOT EXISTS idx_student_tier_overrides_triple
  ON student_tier_overrides (teacher_id, student_id, COALESCE(class_name, ''));
