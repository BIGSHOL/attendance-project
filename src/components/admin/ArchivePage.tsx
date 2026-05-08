"use client";

import AttendancePage from "@/components/AttendancePage";

/**
 * 보관함 — 퇴사 선생님 (status !== active) 의 과거 출석 데이터 read-only 조회.
 *
 * AttendancePage 자체에 archiveMode prop 을 추가해 그대로 재사용:
 *   - useStaff({ archived: true }) → 퇴사 staff 만 selector 에 표시
 *   - 모든 mutation 핸들러 no-op (read-only)
 *   - 시트 동기화 / sync 결과 토스트 / 분반 추가 버튼 hide
 *   - localStorage 키도 `archive.*` prefix 로 분리되어 일반 출석부와 충돌 없음
 *
 * 디자인은 기존 출석부와 100% 동일 (그룹핑 / 셀 색상 / 학생 메타 / 합계 컬럼 / 모달).
 */
export default function ArchivePage() {
  return <AttendancePage archiveMode />;
}
