"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useStaff } from "@/hooks/useStaff";
import { useStudents } from "@/hooks/useStudents";
import { toSubjectLabel } from "@/lib/labelMap";
import type { PaymentLite } from "@/lib/studentPaymentMatcher";

interface AttendanceRow {
  id: string;
  teacher_id: string;
  student_id: string;
  date: string;
  hours: number;
}

interface Props {
  teacherId: string;
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

export default function TeacherDetail({ teacherId }: Props) {
  const { staff, loading: staffLoading } = useStaff();
  const { students, loading: studentsLoading } = useStudents();
  const [selectedMonth, setSelectedMonth] = useState(currentMonth());
  const [payments, setPayments] = useState<PaymentLite[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const teacher = useMemo(
    () => staff.find((s) => s.id === teacherId),
    [staff, teacherId]
  );


  // 해당 월 데이터 로드
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const supabase = createClient();

      // 해당 선생님의 해당 월 수납
      const { data: pData } = await supabase
        .from("payments")
        .select("*")
        .eq("teacher_staff_id", teacherId)
        .eq("billing_month", selectedMonth);

      if (pData) setPayments(pData as PaymentLite[]);

      // 해당 선생님의 해당 월 출석
      const startDate = `${selectedMonth.slice(0, 4)}-${selectedMonth.slice(4)}-01`;
      const endMonth = parseInt(selectedMonth.slice(4));
      const endYear = parseInt(selectedMonth.slice(0, 4));
      const lastDay = new Date(endYear, endMonth, 0).getDate();
      const endDate = `${selectedMonth.slice(0, 4)}-${selectedMonth.slice(4)}-${String(lastDay).padStart(2, "0")}`;

      const { data: aData } = await supabase
        .from("attendance")
        .select("*")
        .eq("teacher_id", teacherId)
        .gte("date", startDate)
        .lte("date", endDate);

      if (aData) setAttendance(aData as AttendanceRow[]);
      setLoading(false);
    };

    if (teacherId) load();
  }, [teacherId, selectedMonth]);

  // 학생 ID → 학생 매핑
  const studentMap = useMemo(() => {
    const map = new Map(students.map((s) => [s.id, s]));
    return map;
  }, [students]);

  // 학생별 출석 시수 집계
  const hoursByStudent = useMemo(() => {
    const map = new Map<string, number>();
    attendance.forEach((r) => {
      map.set(r.student_id, (map.get(r.student_id) || 0) + r.hours);
    });
    return map;
  }, [attendance]);

  // 출석 + 수납을 학생별로 통합
  const studentRows = useMemo(() => {
    // 출석이 있는 학생 ID
    const attendanceStudentIds = new Set(hoursByStudent.keys());

    // 수납에 등장하는 학생 (studentCode 또는 이름으로 매칭)
    const paymentStudentMap = new Map<string, PaymentLite[]>();
    for (const p of payments) {
      // studentCode로 Firebase 학생 찾기
      const student = students.find(
        (s) =>
          (s.studentCode && s.studentCode === p.student_code) ||
          (s.name === p.student_name && s.school === p.school)
      );
      const key = student?.id || `__code__${p.student_code}`;
      if (!paymentStudentMap.has(key)) paymentStudentMap.set(key, []);
      paymentStudentMap.get(key)!.push(p);
    }

    // 모든 학생 ID 집합 (출석 또는 수납에 있는)
    const allStudentIds = new Set([
      ...attendanceStudentIds,
      ...paymentStudentMap.keys(),
    ]);

    return Array.from(allStudentIds).map((id) => {
      const student = studentMap.get(id);
      const hours = hoursByStudent.get(id) || 0;
      const relatedPayments = paymentStudentMap.get(id) || [];
      const totalCharge = relatedPayments.reduce((s, p) => s + p.charge_amount, 0);
      const totalPaid = relatedPayments.reduce((s, p) => s + p.paid_amount, 0);

      return {
        id,
        student,
        studentName: student?.name || relatedPayments[0]?.student_name || "알 수 없음",
        grade: student?.grade || relatedPayments[0]?.grade || "",
        hours,
        totalCharge,
        totalPaid,
        paymentCount: relatedPayments.length,
      };
    }).sort((a, b) => a.studentName.localeCompare(b.studentName, "ko"));
  }, [hoursByStudent, payments, students, studentMap]);

  // 총합
  const totals = useMemo(() => {
    const totalHours = studentRows.reduce((s, r) => s + r.hours, 0);
    const totalCharge = studentRows.reduce((s, r) => s + r.totalCharge, 0);
    const totalPaid = studentRows.reduce((s, r) => s + r.totalPaid, 0);
    return { totalHours, totalCharge, totalPaid, studentCount: studentRows.length };
  }, [studentRows]);

  if (staffLoading || studentsLoading) {
    return <div className="text-sm text-zinc-400">불러오는 중...</div>;
  }

  if (!teacher) {
    return (
      <div className="mx-auto max-w-4xl">
        <Link href="/teachers" className="text-sm text-zinc-500 hover:text-zinc-700">
          ← 선생님 목록
        </Link>
        <div className="mt-4 text-sm text-red-500">선생님을 찾을 수 없습니다.</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/teachers" className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
        ← 선생님 목록
      </Link>

      <div className="mt-4 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            {teacher.name}
          </h2>
          <div className="mt-1 flex items-center gap-2 text-sm text-zinc-500">
            {teacher.subjects?.map((s, i) => (
              <span
                key={i}
                className="inline-flex rounded px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
              >
                {toSubjectLabel(s)}
              </span>
            ))}
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

      {/* 요약 */}
      <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs text-zinc-500">담당 학생</div>
          <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
            {totals.studentCount}명
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs text-zinc-500">총 출석 시수</div>
          <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
            {totals.totalHours}시간
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs text-zinc-500">총 청구액</div>
          <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
            {totals.totalCharge.toLocaleString()}원
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs text-zinc-500">납부액</div>
          <div className="text-lg font-bold text-emerald-600">
            {totals.totalPaid.toLocaleString()}원
          </div>
        </div>
      </div>

      {/* 학생별 통합 표 */}
      <div className="mt-6">
        <h3 className="text-sm font-medium text-zinc-500 mb-2">
          {formatMonth(selectedMonth)} 담당 학생별 출석·수납
        </h3>
        <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 overflow-hidden">
          {loading ? (
            <div className="p-4 text-sm text-zinc-400">불러오는 중...</div>
          ) : studentRows.length === 0 ? (
            <div className="p-4 text-sm text-zinc-400">데이터가 없습니다.</div>
          ) : (
            <table className="w-full text-sm [&_td]:border-r [&_td]:border-zinc-200 [&_th]:border-r [&_th]:border-zinc-300">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/50">
                  <th className="px-3 py-2 text-left font-medium text-zinc-500">#</th>
                  <th className="px-3 py-2 text-left font-medium text-zinc-500">학생</th>
                  <th className="px-3 py-2 text-left font-medium text-zinc-500">학년</th>
                  <th className="px-3 py-2 text-right font-medium text-zinc-500">출석시수</th>
                  <th className="px-3 py-2 text-right font-medium text-zinc-500">청구액</th>
                  <th className="px-3 py-2 text-right font-medium text-zinc-500">납부액</th>
                  <th className="px-3 py-2 text-right font-medium text-zinc-500">수납건수</th>
                </tr>
              </thead>
              <tbody>
                {studentRows.map((r, idx) => (
                  <tr
                    key={r.id}
                    className="border-b border-zinc-300 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/30"
                  >
                    <td className="px-3 py-2 text-zinc-400">{idx + 1}</td>
                    <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">
                      {r.student ? (
                        <Link href={`/students/${r.student.id}`} className="hover:text-blue-600 hover:underline">
                          {r.studentName}
                        </Link>
                      ) : (
                        <span className="text-zinc-500">{r.studentName}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-zinc-500">{r.grade || "-"}</td>
                    <td className="px-3 py-2 text-right text-zinc-700 dark:text-zinc-300">
                      {r.hours > 0 ? `${r.hours}시간` : "-"}
                    </td>
                    <td className="px-3 py-2 text-right text-zinc-700 dark:text-zinc-300">
                      {r.totalCharge > 0 ? r.totalCharge.toLocaleString() : "-"}
                    </td>
                    <td className="px-3 py-2 text-right text-emerald-600">
                      {r.totalPaid > 0 ? r.totalPaid.toLocaleString() : "-"}
                    </td>
                    <td className="px-3 py-2 text-right text-zinc-500">
                      {r.paymentCount > 0 ? r.paymentCount : "-"}
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
