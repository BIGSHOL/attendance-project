-- 실시간 변경 푸시 활성화
-- supabase_realtime 퍼블리케이션에 테이블 추가

ALTER PUBLICATION supabase_realtime ADD TABLE attendance;
ALTER PUBLICATION supabase_realtime ADD TABLE payments;
ALTER PUBLICATION supabase_realtime ADD TABLE session_periods;
ALTER PUBLICATION supabase_realtime ADD TABLE student_tier_overrides;
ALTER PUBLICATION supabase_realtime ADD TABLE teacher_settings;
ALTER PUBLICATION supabase_realtime ADD TABLE salary_configs;
