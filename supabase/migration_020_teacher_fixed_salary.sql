-- teacher_settings 에 월 고정급(급여제) 금액 필드 추가
-- salary_type = 'fixed' 인 선생님의 월 지급 금액을 별도 관리.
--
-- 정산 탭에서는 "계약에 따른 급여 지급" 문구만 표시하고 실금액은 월별 정산·지급 처리.
-- 출석부의 학생별 실급여 계산은 참고용으로 계속 수행 (관리자만 조회).
--
-- 0 이면 미설정. 실제 지급은 별도 프로세스.

ALTER TABLE teacher_settings
  ADD COLUMN IF NOT EXISTS fixed_salary_amount integer NOT NULL DEFAULT 0;
