import type { Student } from "@/types";

export interface PaymentLite {
  id: string;
  student_code: string;
  student_name: string;
  school?: string;
  grade?: string;
  billing_month: string;
  payment_name: string;
  charge_amount: number;
  discount_amount: number;
  paid_amount: number;
  teacher_name?: string;
  teacher_staff_id?: string | null;
}

/**
 * 학교명 정규화 — 전체명을 축약형으로 통일.
 * 학생 DB는 "대산초", 수납 DB는 "대산초등학교" 식으로 혼재해 있어서 비교 전에 항상 이 함수로 변환.
 *
 * 규칙 (긴 접미사 먼저 치환해야 함):
 *   - "여자중학교" → "여중"
 *   - "여자고등학교" → "여고"
 *   - "초등학교" → "초"
 *   - "중학교" → "중"
 *   - "고등학교" → "고"
 */
export function normalizeSchool(name?: string): string {
  if (!name) return "";
  return name
    .trim()
    .replace(/여자중학교$/, "여중")
    .replace(/여자고등학교$/, "여고")
    .replace(/초등학교$/, "초")
    .replace(/중학교$/, "중")
    .replace(/고등학교$/, "고");
}

function schoolMatches(a: string, b: string): boolean {
  const na = normalizeSchool(a);
  const nb = normalizeSchool(b);
  if (!na || !nb) return true; // 한쪽이 비어있으면 통과
  return na === nb;
}

/**
 * 학생 → 수납 매칭
 * 우선순위 1: studentCode 완벽 매칭 (양쪽 모두 값이 있을 때만)
 * 우선순위 2: 이름 + 학교 prefix 매칭 (fallback)
 */
export function findStudentPayments<T extends PaymentLite>(
  student: Student,
  payments: T[],
  month?: string
): T[] {
  const filterByMonth = (list: T[]) =>
    month ? list.filter((p) => p.billing_month === month) : list;

  // 1. studentCode 매칭 — payment.student_code 가 빈값이면 스킵
  if (student.studentCode) {
    const matched = payments.filter(
      (p) => p.student_code && p.student_code === student.studentCode
    );
    if (matched.length > 0) return filterByMonth(matched);
  }

  // 2. 이름 + 학교 prefix 매칭 fallback
  const byNameSchool = payments.filter(
    (p) =>
      p.student_name === student.name &&
      schoolMatches(p.school || "", student.school || "")
  );

  return filterByMonth(byNameSchool);
}

/**
 * 수납 → 학생 매칭 (역방향)
 */
export function findPaymentStudent(
  payment: PaymentLite,
  students: Student[]
): Student | undefined {
  // 1. studentCode 매칭
  if (payment.student_code) {
    const byCode = students.find((s) => s.studentCode === payment.student_code);
    if (byCode) return byCode;
  }

  // 2. 이름 + 학교 fallback (학교명은 정규화 후 비교)
  return students.find(
    (s) =>
      s.name === payment.student_name &&
      schoolMatches(s.school || "", payment.school || "")
  );
}

/**
 * 선생님 → 해당 월 담당 학생들의 수납 합계
 */
export function sumTeacherPayments<T extends PaymentLite>(
  teacherStaffId: string,
  payments: T[],
  month?: string
): { count: number; totalCharge: number; totalPaid: number; items: T[] } {
  const filtered = payments.filter((p) => {
    if (p.teacher_staff_id !== teacherStaffId) return false;
    if (month && p.billing_month !== month) return false;
    return true;
  });

  return {
    count: filtered.length,
    totalCharge: filtered.reduce((s, p) => s + (p.charge_amount || 0), 0),
    totalPaid: filtered.reduce((s, p) => s + (p.paid_amount || 0), 0),
    items: filtered,
  };
}
