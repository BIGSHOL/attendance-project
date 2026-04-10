"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useStudents } from "@/hooks/useStudents";
import { useStaff } from "@/hooks/useStaff";
import { findStudentPayments, type PaymentLite } from "@/lib/studentPaymentMatcher";
import { toSubjectLabel } from "@/lib/labelMap";
import type { Student } from "@/types";

interface AttendanceRow {
  id: string;
  teacher_id: string;
  student_id: string;
  date: string;
  hours: number;
}

interface Props {
  studentId: string;
}

function formatMonth(m: string) {
  return `${m.slice(0, 4)}년 ${parseInt(m.slice(4))}월`;
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(m: string, delta: number): string {
  const y = parseInt(m.slice(0, 4));
  const mo = parseInt(m.slice(4));
  const d = new Date(y, mo - 1 + delta, 1);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function StudentDetail({ studentId }: Props) {
  const { students, loading: studentsHookLoading } = useStudents();
  const { staff } = useStaff();
  const [student, setStudent] = useState<Student | null>(null);
  const [studentLoading, setStudentLoading] = useState(true);
  const [studentError, setStudentError] = useState<string | null>(null);
  const [payments, setPayments] = useState<PaymentLite[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth());
  const [loading, setLoading] = useState(true);

  // 1차: useStudents 훅에서 찾기 (이미 로드된 데이터)
  useEffect(() => {
    if (studentsHookLoading) return;

    const fromHook = students.find((s) => s.id === studentId);
    if (fromHook) {
      setStudent(fromHook);
      setStudentLoading(false);
      setStudentError(null);
      return;
    }

    // 2차: 훅에 없으면 API로 직접 로드
    const loadStudent = async () => {
      setStudentLoading(true);
      setStudentError(null);
      try {
        const res = await fetch(`/api/students/${encodeURIComponent(studentId)}`, {
          cache: "no-store",
        });
        if (res.status === 404) {
          setStudentError(`학생 문서를 찾을 수 없습니다. (id: ${studentId})`);
          setStudent(null);
        } else if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        } else {
          const data = (await res.json()) as Student;
          setStudent(data);
        }
      } catch (e) {
        console.error("[StudentDetail] Error:", e);
        setStudentError((e as Error).message);
        setStudent(null);
      } finally {
        setStudentLoading(false);
      }
    };
    loadStudent();
  }, [studentId, students, studentsHookLoading]);

  // 수납 전체 (월 필터는 클라이언트에서)
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const supabase = createClient();

      // 1. 해당 학생의 모든 수납 (studentCode 우선, 결과 없으면 이름+학교 fallback)
      if (student) {
        let pData: PaymentLite[] = [];
        if (student.studentCode) {
          const res = await supabase
            .from("payments")
            .select("*")
            .eq("student_code", student.studentCode);
          if (res.data) pData = res.data as PaymentLite[];
        }
        // 결과가 없으면 이름 + 학교로 재시도
        if (pData.length === 0) {
          let q = supabase.from("payments").select("*").eq("student_name", student.name);
          if (student.school) q = q.eq("school", student.school);
          const res = await q;
          if (res.data) pData = res.data as PaymentLite[];
        }
        setPayments(pData);
      }

      // 2. 해당 학생의 해당 월 출석
      const startDate = `${selectedMonth.slice(0, 4)}-${selectedMonth.slice(4)}-01`;
      const endMonth = parseInt(selectedMonth.slice(4));
      const endYear = parseInt(selectedMonth.slice(0, 4));
      const lastDay = new Date(endYear, endMonth, 0).getDate();
      const endDate = `${selectedMonth.slice(0, 4)}-${selectedMonth.slice(4)}-${String(lastDay).padStart(2, "0")}`;

      const { data: aData } = await supabase
        .from("attendance")
        .select("*")
        .eq("student_id", studentId)
        .gte("date", startDate)
        .lte("date", endDate);

      if (aData) setAttendance(aData as AttendanceRow[]);
      setLoading(false);
    };

    if (student) load();
  }, [student, studentId, selectedMonth]);


  // 선생님 이름 매핑
  const staffMap = useMemo(() => {
    const map = new Map<string, string>();
    staff.forEach((s) => map.set(s.id, s.name));
    return map;
  }, [staff]);

  // 해당 월 수납
  const monthPayments = useMemo(
    () => (student ? findStudentPayments(student, payments, selectedMonth) : []),
    [student, payments, selectedMonth]
  );

  // 해당 월 출석 시수 합계
  const totalHours = useMemo(
    () => attendance.reduce((s, r) => s + (r.hours || 0), 0),
    [attendance]
  );

  // 출석 선생님별 시수
  const hoursByTeacher = useMemo(() => {
    const map = new Map<string, number>();
    attendance.forEach((r) => {
      map.set(r.teacher_id, (map.get(r.teacher_id) || 0) + r.hours);
    });
    return map;
  }, [attendance]);

  // 총합
  const totalCharge = monthPayments.reduce((s, p) => s + p.charge_amount, 0);
  const totalDiscount = monthPayments.reduce((s, p) => s + p.discount_amount, 0);
  const totalPaid = monthPayments.reduce((s, p) => s + p.paid_amount, 0);

  if (studentLoading) {
    return <div className="text-sm text-zinc-400">불러오는 중...</div>;
  }

  if (!student) {
    return (
      <div className="mx-auto max-w-4xl">
        <Link href="/students" className="text-sm text-zinc-500 hover:text-zinc-700">
          ← 학생 목록
        </Link>
        <div className="mt-4 text-sm text-red-500">
          {studentError || `학생을 찾을 수 없습니다. (id: ${studentId})`}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/students" className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
        ← 학생 목록
      </Link>

      <div className="mt-4 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            {student.name}
          </h2>
          <div className="mt-1 flex items-center gap-3 text-sm text-zinc-500">
            <span>{student.school || "-"}</span>
            <span>·</span>
            <span>{student.grade || "-"}</span>
            {student.studentCode && (
              <>
                <span>·</span>
                <span className="font-mono">#{student.studentCode}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSelectedMonth(shiftMonth(selectedMonth, -1))}
            className="rounded-sm border border-zinc-300 px-2 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            aria-label="이전 달"
          >
            ◀
          </button>
          <span className="min-w-[110px] text-center text-sm font-bold text-zinc-900 dark:text-zinc-100">
            {formatMonth(selectedMonth)}
          </span>
          <button
            onClick={() => setSelectedMonth(shiftMonth(selectedMonth, 1))}
            className="rounded-sm border border-zinc-300 px-2 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            aria-label="다음 달"
          >
            ▶
          </button>
        </div>
      </div>

      {/* 요약 카드 */}
      <div className="mt-6 grid grid-cols-4 gap-4">
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs text-zinc-500">총 출석 시수</div>
          <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
            {totalHours}시간
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs text-zinc-500">총 청구액</div>
          <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
            {totalCharge.toLocaleString()}원
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs text-zinc-500">할인</div>
          <div className="text-lg font-bold text-orange-600">
            {totalDiscount.toLocaleString()}원
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs text-zinc-500">납부액</div>
          <div className="text-lg font-bold text-emerald-600">
            {totalPaid.toLocaleString()}원
          </div>
        </div>
      </div>

      {/* 담당 수업 */}
      <div className="mt-6">
        <h3 className="text-sm font-medium text-zinc-500 mb-2">담당 수업</h3>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          {student.enrollments && student.enrollments.length > 0 ? (
            <div className="space-y-2">
              {student.enrollments.map((e, i) => (
                <div key={i} className="flex items-center gap-3 text-sm">
                  <span className="inline-flex rounded px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                    {toSubjectLabel(e.subject)}
                  </span>
                  <span className="text-zinc-900 dark:text-zinc-100">{e.className || "-"}</span>
                  {e.staffId && (
                    <span className="text-zinc-500">
                      담임: {staffMap.get(e.staffId) || e.teacher || "-"}
                    </span>
                  )}
                  {hoursByTeacher.has(e.staffId || "") && (
                    <span className="ml-auto text-xs text-emerald-600">
                      출석 {hoursByTeacher.get(e.staffId || "")}시간
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-zinc-400">등록된 수업이 없습니다.</div>
          )}
        </div>
      </div>

      {/* 수납 내역 */}
      <div className="mt-6">
        <h3 className="text-sm font-medium text-zinc-500 mb-2">
          {formatMonth(selectedMonth)} 수납 내역
        </h3>
        <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 overflow-hidden">
          {loading ? (
            <div className="p-4 text-sm text-zinc-400">불러오는 중...</div>
          ) : monthPayments.length === 0 ? (
            <div className="p-4 text-sm text-zinc-400">수납 내역이 없습니다.</div>
          ) : (
            <table className="min-w-full text-sm [&_td]:border-r [&_td]:border-zinc-200 [&_th]:border-r [&_th]:border-zinc-300 [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/50">
                  <th className="px-3 py-2 text-left font-medium text-zinc-500">수납명</th>
                  <th className="px-3 py-2 text-right font-medium text-zinc-500">청구액</th>
                  <th className="px-3 py-2 text-right font-medium text-zinc-500">할인</th>
                  <th className="px-3 py-2 text-right font-medium text-zinc-500">납부액</th>
                  <th className="px-3 py-2 text-left font-medium text-zinc-500">담임강사</th>
                </tr>
              </thead>
              <tbody>
                {monthPayments.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-zinc-300 last:border-0 dark:border-zinc-800"
                  >
                    <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
                      {p.payment_name}
                    </td>
                    <td className="px-3 py-2 text-right text-zinc-700 dark:text-zinc-300">
                      {p.charge_amount.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right text-orange-600">
                      {p.discount_amount > 0 ? `-${p.discount_amount.toLocaleString()}` : "-"}
                    </td>
                    <td className="px-3 py-2 text-right text-emerald-600">
                      {p.paid_amount.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-zinc-500">
                      {p.teacher_name || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
