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
 * 학생 → 수납 매칭
 * 우선순위 1: studentCode 완벽 매칭
 * 우선순위 2: 이름 + 학교 매칭 (fallback)
 */
export function findStudentPayments<T extends PaymentLite>(
  student: Student,
  payments: T[],
  month?: string
): T[] {
  const filterByMonth = (list: T[]) =>
    month ? list.filter((p) => p.billing_month === month) : list;

  // 1. studentCode 매칭
  if (student.studentCode) {
    const matched = payments.filter((p) => p.student_code === student.studentCode);
    if (matched.length > 0) return filterByMonth(matched);
  }

  // 2. 이름 + 학교 fallback
  const byNameSchool = payments.filter(
    (p) =>
      p.student_name === student.name &&
      (!student.school || !p.school || p.school === student.school)
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

  // 2. 이름 + 학교 fallback
  return students.find(
    (s) =>
      s.name === payment.student_name &&
      (!s.school || !payment.school || s.school === payment.school)
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
