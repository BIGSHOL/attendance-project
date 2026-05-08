-- audit V6: virtual_students.id 안정화 마이그레이션
--
-- 배경:
--   기존 virtual_id = "virtual_{teacherId}_{name}_{school}_{grade}" — grade 가 ID 에 포함됨.
--   학년이 바뀌면 새 ID 로 신규 row 생성 → 옛 attendance / payment_shares 가 orphan.
--   시수 검증 / 정산에서 hours 누락되는 핵심 원인.
--
-- 새 포맷: "virtual_{teacherId}_{name}_{school}" — grade 제외.
--   학년 변경 / 학교 표기 동일 → 같은 ID 유지.
--   grade 는 column 에서만 갱신되어 UI 표시용으로만 사용.
--
-- 영향 테이블:
--   - virtual_students  (PK)
--   - attendance        (student_id)
--   - payment_shares    (student_id)
--   - student_tier_overrides  (student_id)
--
-- ⚠ 이 마이그레이션은 한 번만 실행. 이미 실행되었다면 id_remap 이 비어 no-op.

BEGIN;

-- 1) 옛 ID → 새 ID 매핑 테이블 (virtual_students 행 단위)
CREATE TEMP TABLE id_remap AS
  SELECT id AS old_id,
         'virtual_' || teacher_staff_id || '_' || name || '_' ||
           COALESCE(NULLIF(school, ''), 'unknown') AS new_id
    FROM virtual_students
   WHERE id LIKE 'virtual_%'
     AND id <> 'virtual_' || teacher_staff_id || '_' || name || '_' ||
                COALESCE(NULLIF(school, ''), 'unknown');

-- 마이그레이션 통계 (참고용)
DO $$
DECLARE
  cnt int;
BEGIN
  SELECT COUNT(*) INTO cnt FROM id_remap;
  RAISE NOTICE '[migration_025] virtual_students 마이그레이션 대상: % 건', cnt;
END $$;

-- ============================================================
-- 2) attendance: student_id 정규화 + 충돌 시 hours 합산
-- ============================================================
-- 같은 (teacher_id, date, class_name) 에 옛 student_id 와 새 student_id 가
-- 둘 다 row 를 가지면 hours 합산 후 옛 row 삭제 (시수 보존).

-- 2-a) 충돌 row 의 hours 를 새 row 에 합산 + memo 병합
WITH conflicts AS (
  SELECT a_old.id   AS old_row_id,
         a_old.hours AS old_hours,
         a_old.memo  AS old_memo,
         a_new.id    AS new_row_id
    FROM attendance a_old
    JOIN id_remap r        ON a_old.student_id = r.old_id
    JOIN attendance a_new  ON a_new.student_id = r.new_id
                          AND a_new.teacher_id = a_old.teacher_id
                          AND a_new.date       = a_old.date
                          AND a_new.class_name = a_old.class_name
)
UPDATE attendance a
   SET hours = a.hours + c.old_hours,
       memo  = CASE
                 WHEN a.memo = '' THEN c.old_memo
                 WHEN c.old_memo = '' THEN a.memo
                 WHEN a.memo = c.old_memo THEN a.memo
                 ELSE a.memo || ' | ' || c.old_memo
               END,
       updated_at = NOW()
  FROM conflicts c
 WHERE a.id = c.new_row_id;

-- 2-b) 충돌 row 삭제 (이미 새 row 에 hours 합산 끝)
DELETE FROM attendance a
 USING (
   SELECT a_old.id
     FROM attendance a_old
     JOIN id_remap r        ON a_old.student_id = r.old_id
     JOIN attendance a_new  ON a_new.student_id = r.new_id
                           AND a_new.teacher_id = a_old.teacher_id
                           AND a_new.date       = a_old.date
                           AND a_new.class_name = a_old.class_name
 ) dup
 WHERE a.id = dup.id;

-- 2-c) 충돌 없는 row: student_id 만 update
UPDATE attendance a
   SET student_id = r.new_id,
       updated_at = NOW()
  FROM id_remap r
 WHERE a.student_id = r.old_id;

-- ============================================================
-- 3) payment_shares: student_id 정규화 + 충돌 시 옛 row 삭제
-- ============================================================
-- UNIQUE(student_id, month, teacher_staff_id, class_name). 충돌 시 새 row keep.
DELETE FROM payment_shares ps
 USING id_remap r,
       payment_shares ps_new
 WHERE ps.student_id           = r.old_id
   AND ps_new.student_id       = r.new_id
   AND ps_new.month            = ps.month
   AND ps_new.teacher_staff_id = ps.teacher_staff_id
   AND ps_new.class_name       = ps.class_name;

UPDATE payment_shares ps
   SET student_id = r.new_id,
       updated_at = NOW()
  FROM id_remap r
 WHERE ps.student_id = r.old_id;

-- ============================================================
-- 4) student_tier_overrides: student_id 정규화 + 충돌 시 옛 row 삭제
-- ============================================================
-- UNIQUE(teacher_id, student_id, class_name) — class_name 포함 3-tuple.
-- (migration_010 의 idx_student_tier_overrides_triple = COALESCE(class_name, '')
--  형태로도 존재 가능 → 두 케이스 모두 충족하도록 class_name 을 비교에 포함.)
DELETE FROM student_tier_overrides sto
 USING id_remap r,
       student_tier_overrides sto_new
 WHERE sto.student_id      = r.old_id
   AND sto_new.student_id  = r.new_id
   AND sto_new.teacher_id  = sto.teacher_id
   AND COALESCE(sto_new.class_name, '') = COALESCE(sto.class_name, '');

UPDATE student_tier_overrides sto
   SET student_id = r.new_id,
       updated_at = NOW()
  FROM id_remap r
 WHERE sto.student_id = r.old_id;

-- ============================================================
-- 5) virtual_students.id 자체 정규화
-- ============================================================
-- 5-a) 같은 new_id 가 여러 row → 최신 (updated_at desc) 만 keep
DELETE FROM virtual_students vs
 USING (
   SELECT vs_inner.id,
          ROW_NUMBER() OVER (
            PARTITION BY 'virtual_' || teacher_staff_id || '_' || name || '_' ||
                         COALESCE(NULLIF(school, ''), 'unknown')
            ORDER BY updated_at DESC, created_at DESC
          ) AS rn
     FROM virtual_students vs_inner
    WHERE id LIKE 'virtual_%'
 ) ranked
 WHERE vs.id = ranked.id
   AND ranked.rn > 1;

-- 5-b) 남은 row 의 id 를 새 포맷으로 update
UPDATE virtual_students
   SET id = 'virtual_' || teacher_staff_id || '_' || name || '_' ||
              COALESCE(NULLIF(school, ''), 'unknown'),
       updated_at = NOW()
 WHERE id <> 'virtual_' || teacher_staff_id || '_' || name || '_' ||
              COALESCE(NULLIF(school, ''), 'unknown');

DROP TABLE id_remap;

COMMIT;

-- ============================================================
-- 검증 쿼리 (마이그레이션 후 수동 실행)
-- ============================================================
-- 1) 옛 grade 종속 ID 가 남았는지 확인 — 0 이어야 함
-- SELECT COUNT(*) AS legacy_virtual_ids
--   FROM virtual_students
--  WHERE id <> 'virtual_' || teacher_staff_id || '_' || name || '_' ||
--                COALESCE(NULLIF(school, ''), 'unknown');
--
-- 2) attendance 의 orphan 통계 — virtual_students 에도 students 에도 없는 student_id 수
--    (Firebase students 는 SQL 에서 조회 불가 — 앱 UI 에서 검증)
-- SELECT student_id, COUNT(*) AS row_count, SUM(hours) AS total_hours
--   FROM attendance
--  WHERE student_id LIKE 'virtual_%'
--    AND student_id NOT IN (SELECT id FROM virtual_students)
--  GROUP BY student_id
--  ORDER BY total_hours DESC;
