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
--   - virtual_students       (PK)
--   - attendance             (student_id) — hours 합산 보존
--   - payment_shares         (student_id) — sync 가 재구성하므로 옛 row 삭제
--   - student_tier_overrides (student_id) — sync 가 재구성하므로 옛 row 삭제
--
-- 마이그레이션 후 사용자가 시트 재-sync 해야 payment_shares / tier_overrides 가
-- 새 ID 로 다시 채워짐.
--
-- ⚠ Supabase SQL Editor 의 multi-statement 호환성을 위해 일반 테이블 사용 (TEMP X).
-- ⚠ 같은 new_id 로 매핑되는 옛 row 가 여러 개 (학년 여러 번 변경) 인 케이스 안전 처리.
-- ⚠ 이미 적용된 ID 는 no-op (idempotent).

BEGIN;

-- =======================================================================
-- 0) 옛 staging 테이블 정리 (이전 실행 잔여물)
-- =======================================================================
DROP TABLE IF EXISTS _migration_025_id_remap;

-- =======================================================================
-- 1) 옛 ID → 새 ID 매핑 staging 테이블 (일반 테이블 — pgbouncer / SQL Editor 호환)
-- =======================================================================
CREATE TABLE _migration_025_id_remap AS
  SELECT id AS old_id,
         'virtual_' || teacher_staff_id || '_' || name || '_' ||
           COALESCE(NULLIF(school, ''), 'unknown') AS new_id
    FROM virtual_students
   WHERE id LIKE 'virtual_%'
     AND id <> 'virtual_' || teacher_staff_id || '_' || name || '_' ||
                COALESCE(NULLIF(school, ''), 'unknown');

CREATE INDEX ON _migration_025_id_remap (old_id);
CREATE INDEX ON _migration_025_id_remap (new_id);

DO $$
DECLARE cnt int;
BEGIN
  SELECT COUNT(*) INTO cnt FROM _migration_025_id_remap;
  RAISE NOTICE '[migration_025] virtual_students 마이그레이션 대상: % 건', cnt;
END $$;

-- =======================================================================
-- 2) attendance: hours 합산 보존하며 student_id 정규화
-- =======================================================================

-- 2-a) 같은 new_id 로 매핑될 옛 row 들 끼리 keeper 1개만 남기고 hours 합산
DELETE FROM attendance a
 USING (
   SELECT a_inner.id,
          ROW_NUMBER() OVER (
            PARTITION BY a_inner.teacher_id, r.new_id, a_inner.date, a_inner.class_name
            ORDER BY a_inner.updated_at DESC NULLS LAST, a_inner.id
          ) AS rn
     FROM attendance a_inner
     JOIN _migration_025_id_remap r ON a_inner.student_id = r.old_id
 ) ranked
 WHERE a.id = ranked.id
   AND ranked.rn > 1;

UPDATE attendance a
   SET hours = g.total_hours,
       updated_at = NOW()
  FROM (
    SELECT (ARRAY_AGG(a_inner.id ORDER BY a_inner.updated_at DESC NULLS LAST, a_inner.id))[1] AS keeper_id,
           SUM(a_inner.hours) AS total_hours
      FROM attendance a_inner
      JOIN _migration_025_id_remap r ON a_inner.student_id = r.old_id
     GROUP BY a_inner.teacher_id, r.new_id, a_inner.date, a_inner.class_name
  ) g
 WHERE a.id = g.keeper_id
   AND a.hours <> g.total_hours;

-- 2-b) 옛 keeper 와 기존 새 row 충돌 → 새 row 에 hours 합산 후 옛 keeper 삭제
WITH conflicts AS (
  SELECT a_old.id   AS old_id,
         a_old.hours AS old_hours,
         a_old.memo  AS old_memo,
         a_new.id    AS new_id
    FROM attendance a_old
    JOIN _migration_025_id_remap r ON a_old.student_id = r.old_id
    JOIN attendance a_new          ON a_new.student_id = r.new_id
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
 WHERE a.id = c.new_id;

DELETE FROM attendance a
 USING (
   SELECT a_old.id
     FROM attendance a_old
     JOIN _migration_025_id_remap r ON a_old.student_id = r.old_id
     JOIN attendance a_new          ON a_new.student_id = r.new_id
                                   AND a_new.teacher_id = a_old.teacher_id
                                   AND a_new.date       = a_old.date
                                   AND a_new.class_name = a_old.class_name
 ) dup
 WHERE a.id = dup.id;

-- 2-c) 충돌 없는 옛 row: student_id 만 update
UPDATE attendance a
   SET student_id = r.new_id,
       updated_at = NOW()
  FROM _migration_025_id_remap r
 WHERE a.student_id = r.old_id;

-- =======================================================================
-- 3) payment_shares: 옛 student_id row 모두 삭제 (sync 가 재생성)
-- =======================================================================
DELETE FROM payment_shares ps
 USING _migration_025_id_remap r
 WHERE ps.student_id = r.old_id;

-- =======================================================================
-- 4) student_tier_overrides: 옛 student_id row 모두 삭제 (sync 가 재생성)
-- =======================================================================
DELETE FROM student_tier_overrides sto
 USING _migration_025_id_remap r
 WHERE sto.student_id = r.old_id;

-- =======================================================================
-- 5) virtual_students: 같은 new_id 의 row 중 최신만 keep + id 정규화
-- =======================================================================
-- 5-a) 같은 new_id 로 매핑될 row 들 중 updated_at 최신만 keep
DELETE FROM virtual_students vs
 USING (
   SELECT vs_inner.id,
          ROW_NUMBER() OVER (
            PARTITION BY 'virtual_' || teacher_staff_id || '_' || name || '_' ||
                         COALESCE(NULLIF(school, ''), 'unknown')
            ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
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

-- =======================================================================
-- 6) staging 테이블 정리
-- =======================================================================
DROP TABLE _migration_025_id_remap;

COMMIT;

-- =======================================================================
-- 검증 쿼리 (수동 실행)
-- =======================================================================
-- 1) 옛 grade 종속 ID 가 남았는지 확인 — 0 이어야 함
-- SELECT COUNT(*) AS legacy_virtual_ids
--   FROM virtual_students
--  WHERE id <> 'virtual_' || teacher_staff_id || '_' || name || '_' ||
--                COALESCE(NULLIF(school, ''), 'unknown');
--
-- 2) attendance 에서 virtual_students 에도 없는 student_id 의 hours 통계
-- SELECT student_id, COUNT(*) AS row_count, SUM(hours) AS total_hours
--   FROM attendance
--  WHERE student_id LIKE 'virtual_%'
--    AND student_id NOT IN (SELECT id FROM virtual_students)
--  GROUP BY student_id
--  ORDER BY total_hours DESC LIMIT 20;
