-- teacher_month_payroll 캐시 테이블 제거.
-- SettlementPage 가 이제 computeTeacherMonthPayroll 순수 함수를 직접 호출해
-- 실시간 계산하므로 캐시 불필요. 엑셀의 "=A1" 참조처럼 동일한 입력 → 동일한 출력.

DROP TABLE IF EXISTS teacher_month_payroll;
