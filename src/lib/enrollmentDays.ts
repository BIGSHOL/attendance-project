import type { Enrollment } from "@/types";

/**
 * enrollment의 schedule + days를 합쳐 중복 제거된 요일 배열 반환
 * schedule 예: ["월 1", "월 2", "수 1"] → ["월", "수"]
 * days 예: ["월", "수"] → 그대로
 */
export function extractDaysFromEnrollment(enrollment: Enrollment): string[] {
  const set = new Set<string>();

  // schedule: "월 1" 형식에서 첫 토큰 추출
  if (Array.isArray(enrollment.schedule)) {
    for (const slot of enrollment.schedule) {
      if (typeof slot !== "string") continue;
      const day = slot.split(/\s+/)[0]; // 공백으로 분리
      if (day) set.add(day);
    }
  }

  // days: 직접 사용
  if (Array.isArray(enrollment.days)) {
    for (const d of enrollment.days) {
      if (typeof d === "string" && d) set.add(d);
    }
  }

  return Array.from(set);
}

/**
 * 여러 enrollments의 days를 모두 합쳐 반환
 */
export function extractDaysFromEnrollments(enrollments: Enrollment[] | undefined): string[] {
  if (!enrollments || enrollments.length === 0) return [];
  const set = new Set<string>();
  for (const e of enrollments) {
    for (const day of extractDaysFromEnrollment(e)) {
      set.add(day);
    }
  }
  return Array.from(set);
}

/**
 * 특정 선생님이 담당하는 enrollments의 days만 추출
 */
export function extractDaysForTeacher(
  enrollments: Enrollment[] | undefined,
  matchFn: (e: Enrollment) => boolean
): string[] {
  if (!enrollments) return [];
  const set = new Set<string>();
  for (const e of enrollments) {
    if (!matchFn(e)) continue;
    for (const day of extractDaysFromEnrollment(e)) {
      set.add(day);
    }
  }
  return Array.from(set);
}
