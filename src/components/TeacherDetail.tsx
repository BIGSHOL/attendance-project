"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useStaff } from "@/hooks/useStaff";
import { useStudents } from "@/hooks/useStudents";
import { useUserRole } from "@/hooks/useUserRole";
import { useTeacherSheets } from "@/hooks/useTeacherSheets";
import { useSalaryConfig } from "@/hooks/useSalaryConfig";
import { useTeacherBlogPosts } from "@/hooks/useTeacherBlogPosts";
import { useTeacherSettings } from "@/hooks/useTeacherSettings";
import { toSubjectLabel } from "@/lib/labelMap";
import { syncTeacherSheet, type TeacherSyncResult } from "@/lib/syncSheet";
import { getEffectiveRatio } from "@/lib/salary";
import { INITIAL_SALARY_CONFIG } from "@/types";
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
  const { isMaster, isAdmin } = useUserRole();
  const { sheets, upsertSheet, deleteSheet, markSynced } = useTeacherSheets();
  const { config: salaryConfig } = useSalaryConfig();

  // 블로그 의무 설정 + 급여 비율 (staff_id 기반, 계정 매핑과 무관)
  const {
    isBlogRequired,
    setBlogRequired,
    saving: blogRequiredSaving,
    getRatios,
    setRatios,
    getAdminAllowance,
    setAdminAllowance,
  } = useTeacherSettings(teacherId);
  const blogRequired = isBlogRequired(teacherId);
  const adminAllowance = getAdminAllowance(teacherId);
  const [adminBaseInput, setAdminBaseInput] = useState<string>("");
  const [adminTierInput, setAdminTierInput] = useState<string>("");
  // 저장된 값 동기화
  useEffect(() => {
    setAdminBaseInput(adminAllowance?.baseAmount ? String(adminAllowance.baseAmount) : "");
    setAdminTierInput(adminAllowance?.tierId || "");
  }, [adminAllowance?.baseAmount, adminAllowance?.tierId]);

  const handleAdminSave = async () => {
    const amount = Math.max(0, parseInt(adminBaseInput.replace(/[^\d]/g, "")) || 0);
    const tierId = amount > 0 ? adminTierInput || null : null;
    await setAdminAllowance(teacherId, amount, tierId);
  };

  const handleToggleBlogRequired = () =>
    setBlogRequired(teacherId, !blogRequired);

  const [selectedMonth, setSelectedMonth] = useState(currentMonth());
  const [blogDatesInput, setBlogDatesInput] = useState<string>("");
  const [blogNoteInput, setBlogNoteInput] = useState<string>("");

  // 선택된 월의 연/월 파싱
  const blogYear = parseInt(selectedMonth.slice(0, 4));
  const blogMonth = parseInt(selectedMonth.slice(4));
  const { getPost, savePost } = useTeacherBlogPosts(teacherId, blogYear, blogMonth);
  const currentBlogPost = getPost(blogYear, blogMonth);

  // selectedMonth 변경 시 blog 기록 불러오기
  useEffect(() => {
    if (currentBlogPost) {
      setBlogDatesInput((currentBlogPost.dates || []).join(", "));
      setBlogNoteInput(currentBlogPost.note || "");
    } else {
      setBlogDatesInput("");
      setBlogNoteInput("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth, currentBlogPost?.id]);

  const handleBlogSave = async () => {
    const dates = blogDatesInput
      .split(/[,\s]+/)
      .map((d) => d.trim())
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    await savePost(teacherId, blogYear, blogMonth, dates, blogNoteInput);
  };
  const [payments, setPayments] = useState<PaymentLite[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  // 시트 URL 편집 상태
  const currentSheet = useMemo(
    () => sheets.find((s) => s.teacher_id === teacherId),
    [sheets, teacherId]
  );
  const [sheetUrlDraft, setSheetUrlDraft] = useState("");
  const [editingSheet, setEditingSheet] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<TeacherSyncResult | null>(null);

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
        <div className="flex items-center gap-2">
          {/* 블로그 의무 토글 (관리자 이상) */}
          {isAdmin && (
            <button
              onClick={handleToggleBlogRequired}
              disabled={blogRequiredSaving}
              className={`rounded-sm border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                blogRequired
                  ? "border-blue-500 bg-blue-500 text-white hover:bg-blue-600"
                  : "border-zinc-300 bg-white text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
              }`}
              title={
                blogRequired
                  ? "블로그 작성 의무 ON (미작성 시 -2% 차감)"
                  : "블로그 작성 의무 OFF"
              }
            >
              📝 블로그 의무 {blogRequired ? "ON" : "OFF"}
            </button>
          )}

          <div className="flex items-center gap-1">
            <button
              onClick={() => setSelectedMonth(shiftMonth(selectedMonth, -1))}
              className="rounded-sm border border-zinc-300 px-2 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              aria-label="이전 달"
            >
              ◀
            </button>
            <input
              type="month"
              value={`${selectedMonth.slice(0, 4)}-${selectedMonth.slice(4)}`}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                setSelectedMonth(v.replace("-", ""));
              }}
              className="rounded-sm border border-zinc-300 bg-white px-2 py-1.5 text-sm font-bold text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
            <button
              onClick={() => setSelectedMonth(shiftMonth(selectedMonth, 1))}
              className="rounded-sm border border-zinc-300 px-2 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              aria-label="다음 달"
            >
              ▶
            </button>
          </div>
        </div>
      </div>

      {/* Google Sheets 연동 (마스터만) */}
      {isMaster && (
        <div className="mt-6 rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              📄 Google Sheets 출석부
            </h3>
            {currentSheet?.last_synced_at && (
              <span className="text-xs text-zinc-400">
                마지막 동기화: {new Date(currentSheet.last_synced_at).toLocaleString("ko-KR")}
              </span>
            )}
          </div>

          {editingSheet || !currentSheet ? (
            <div className="flex gap-2">
              <input
                type="url"
                value={sheetUrlDraft}
                onChange={(e) => setSheetUrlDraft(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                className="flex-1 rounded-sm border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
              <button
                onClick={async () => {
                  if (!sheetUrlDraft.trim()) return;
                  await upsertSheet(teacherId, sheetUrlDraft.trim());
                  setEditingSheet(false);
                  setSheetUrlDraft("");
                }}
                disabled={!sheetUrlDraft.trim()}
                className="rounded-sm bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-zinc-300"
              >
                저장
              </button>
              {currentSheet && (
                <button
                  onClick={() => { setEditingSheet(false); setSheetUrlDraft(""); }}
                  className="rounded-sm border border-zinc-300 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  취소
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <a
                href={currentSheet.sheet_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 truncate text-sm text-blue-600 hover:underline dark:text-blue-400"
              >
                {currentSheet.sheet_url}
              </a>
              <button
                onClick={async () => {
                  if (!currentSheet || syncing) return;
                  // 선택된 월(YYYYMM) → YYYY-MM 형식으로 변환
                  const exactMonth = `${selectedMonth.slice(0, 4)}-${selectedMonth.slice(4, 6)}`;
                  setSyncing(true);
                  setSyncResult(null);
                  try {
                    const result = await syncTeacherSheet(
                      teacherId,
                      teacher.name,
                      currentSheet.sheet_url,
                      students,
                      "2026-03",
                      exactMonth,
                      salaryConfig,
                      teacher.subjects?.[0]
                    );
                    setSyncResult(result);
                    if (result.success) await markSynced(teacherId);
                  } finally {
                    setSyncing(false);
                  }
                }}
                disabled={syncing}
                className="rounded-sm bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:bg-zinc-300"
                title={`${formatMonth(selectedMonth)} 탭만 동기화`}
              >
                {syncing ? "..." : `${formatMonth(selectedMonth)} 동기화`}
              </button>
              <button
                onClick={async () => {
                  if (!currentSheet || syncing) return;
                  if (!confirm("2026-03 이후 모든 월별 탭을 동기화합니다. 계속하시겠습니까?")) return;
                  setSyncing(true);
                  setSyncResult(null);
                  try {
                    const result = await syncTeacherSheet(
                      teacherId,
                      teacher.name,
                      currentSheet.sheet_url,
                      students,
                      "2026-03",
                      undefined,
                      salaryConfig,
                      teacher.subjects?.[0]
                    );
                    setSyncResult(result);
                    if (result.success) await markSynced(teacherId);
                  } finally {
                    setSyncing(false);
                  }
                }}
                disabled={syncing}
                className="rounded-sm border border-emerald-600 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:border-zinc-300 disabled:text-zinc-300"
                title="2026-03 이후 모든 월별 탭 동기화"
              >
                전체
              </button>
              <button
                onClick={() => {
                  setSheetUrlDraft(currentSheet.sheet_url);
                  setEditingSheet(true);
                }}
                className="rounded-sm border border-zinc-300 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                수정
              </button>
              <button
                onClick={async () => {
                  if (!confirm("시트 연결을 삭제하시겠습니까?")) return;
                  await deleteSheet(teacherId);
                }}
                className="rounded-sm border border-red-200 px-3 py-2 text-sm text-red-500 hover:bg-red-50"
              >
                삭제
              </button>
            </div>
          )}

          {/* 동기화 결과 */}
          {syncResult && (
            <div className="mt-3 rounded-sm border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-700 dark:bg-zinc-800">
              {syncResult.error && (
                <div className="text-red-600 mb-1">❌ {syncResult.error}</div>
              )}
              {syncResult.months.length > 0 && (
                <div className="space-y-1">
                  <div className="font-medium text-zinc-700 dark:text-zinc-300">
                    처리 결과 ({syncResult.months.length}개 월)
                  </div>
                  {syncResult.months.map((m, i) => (
                    <div key={i} className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
                      <span className="font-mono">{m.year}.{String(m.month).padStart(2, "0")}</span>
                      {m.error ? (
                        <span className="text-red-600">❌ {m.error}</span>
                      ) : (
                        <span>
                          ✓ 매칭 {m.matched}/{m.total}
                          {m.unmatched > 0 && <span className="text-amber-600"> (실패 {m.unmatched})</span>}
                          {m.memoCount > 0 && <span className="text-zinc-500"> · 메모 {m.memoCount}개</span>}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 블로그 작성 기록 (blog_required 선생님만) */}
      {blogRequired && (
        <div className="mt-6 border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/30">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-300">
              📝 {formatMonth(selectedMonth)} 블로그 작성 기록
            </h3>
            {currentBlogPost && currentBlogPost.dates.length > 0 ? (
              <span className="rounded-sm bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
                작성 {currentBlogPost.dates.length}건
              </span>
            ) : (
              <span className="rounded-sm bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900 dark:text-red-300">
                미작성 (-2% 패널티)
              </span>
            )}
          </div>
          <div className="space-y-2">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                작성 날짜 (YYYY-MM-DD, 쉼표 또는 공백으로 여러 개 입력)
              </label>
              <input
                type="text"
                value={blogDatesInput}
                onChange={(e) => setBlogDatesInput(e.target.value)}
                placeholder="예: 2026-04-05, 2026-04-15"
                className="w-full rounded-sm border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                메모 (선택)
              </label>
              <input
                type="text"
                value={blogNoteInput}
                onChange={(e) => setBlogNoteInput(e.target.value)}
                placeholder="예: 4월 신입생 환영 포스팅"
                className="w-full rounded-sm border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-zinc-500">
                ※ 해당 월 블로그 미작성 시 정산 비율에서 -2% 차감됩니다.
              </p>
              <button
                onClick={handleBlogSave}
                className="rounded-sm bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 급여 비율 — 과목×그룹 오버라이드 (DB 우선, INITIAL 하드코딩값 플레이스홀더 힌트) */}
      {teacher && (
        <TeacherRatiosCard
          teacher={teacher}
          isEditable={isAdmin}
          ratios={getRatios(teacher.id)}
          defaultRatios={
            (INITIAL_SALARY_CONFIG.teacherRatios || {})[teacher.name] || {}
          }
          onSave={(next) => setRatios(teacher.id, next)}
        />
      )}

      {/* 행정급여 — 학생 수업 외 행정업무 월 고정급. 기본액 × tier 비율 × (1−수수료) */}
      {teacher && (
        <div className="mt-4 rounded-sm border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              행정급여
            </h3>
            <span className="text-xs text-zinc-500">
              실급여 = 기본액 × tier 비율 × (1 − 수수료 {salaryConfig.academyFee}%)
            </span>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col">
              <label className="text-xs text-zinc-500">월 기본액 (원)</label>
              <input
                type="text"
                inputMode="numeric"
                value={adminBaseInput}
                onChange={(e) => setAdminBaseInput(e.target.value)}
                disabled={!isAdmin}
                placeholder="예: 340000"
                className="w-32 rounded-sm border border-zinc-300 bg-white px-2 py-1.5 text-sm disabled:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:disabled:bg-zinc-700"
              />
            </div>
            <div className="flex flex-col">
              <label className="text-xs text-zinc-500">참조 tier</label>
              <select
                value={adminTierInput}
                onChange={(e) => setAdminTierInput(e.target.value)}
                disabled={!isAdmin}
                className="rounded-sm border border-zinc-300 bg-white px-2 py-1.5 text-sm disabled:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:disabled:bg-zinc-700"
              >
                <option value="">(선택 안 함)</option>
                {(salaryConfig.items || []).map((item) => {
                  const effRatio = getEffectiveRatio(item, salaryConfig, teacher?.name);
                  return (
                    <option key={item.id} value={item.id}>
                      {item.name} · {effRatio}%
                      {effRatio !== item.ratio ? ` (기본 ${item.ratio}%)` : ""}
                    </option>
                  );
                })}
              </select>
            </div>
            {isAdmin && (
              <button
                onClick={handleAdminSave}
                className="rounded-sm bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                저장
              </button>
            )}
            {adminAllowance && (() => {
              const item = (salaryConfig.items || []).find(
                (i) => i.id === adminAllowance.tierId
              );
              if (!item) return null;
              const gross = adminAllowance.baseAmount;
              const effRatio = getEffectiveRatio(item, salaryConfig, teacher?.name);
              const salary = Math.floor(
                gross * (effRatio / 100) * (1 - salaryConfig.academyFee / 100)
              );
              return (
                <div className="ml-auto text-sm text-zinc-700 dark:text-zinc-300">
                  예상 실급여 <span className="font-bold text-green-700 dark:text-green-400">{salary.toLocaleString()}원</span>
                  <span className="ml-1 text-xs text-zinc-500">
                    ({gross.toLocaleString()} × {effRatio}% × {(100 - salaryConfig.academyFee).toFixed(1)}%)
                  </span>
                </div>
              );
            })()}
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            ※ 기본액 0 또는 tier 미선택 시 행정급여 없음. 기존 가상 학생(행정1~5) 방식 대체용.
          </p>
        </div>
      )}

      {/* 요약 */}
      <div className="mt-6 grid grid-cols-4 gap-4">
        <div className="rounded-sm border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs text-zinc-500">담당 학생</div>
          <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
            {totals.studentCount}명
          </div>
        </div>
        <div className="rounded-sm border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs text-zinc-500">총 출석 시수</div>
          <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
            {totals.totalHours}시간
          </div>
        </div>
        <div className="rounded-sm border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs text-zinc-500">총 청구액</div>
          <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
            {totals.totalCharge.toLocaleString()}원
          </div>
        </div>
        <div className="rounded-sm border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
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
        <div className="rounded-sm border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 overflow-hidden">
          {loading ? (
            <div className="p-4 text-sm text-zinc-400">불러오는 중...</div>
          ) : studentRows.length === 0 ? (
            <div className="p-4 text-sm text-zinc-400">데이터가 없습니다.</div>
          ) : (
            <table className="min-w-full text-sm [&_td]:border-r [&_td]:border-zinc-200 [&_th]:border-r [&_th]:border-zinc-300 [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
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

/**
 * 선생님별 급여 비율 오버라이드 편집 카드.
 * 과목(수학/영어) × 그룹(초등·중등·고등·수능·특강) 그리드.
 * 값 0 이하면 "비활성(기본 45%)"으로 간주. 저장은 직접 "저장" 버튼 클릭 시.
 */
function TeacherRatiosCard({
  teacher,
  isEditable,
  ratios,
  defaultRatios,
  onSave,
}: {
  teacher: { id: string; name: string; subjects?: string[] };
  isEditable: boolean;
  ratios: Record<string, Record<string, number>>;
  defaultRatios: Record<string, Record<string, number>>;
  onSave: (next: Record<string, Record<string, number>>) => Promise<unknown> | unknown;
}) {
  const GROUPS = ["초등", "중등", "고등", "수능", "특강"] as const;
  // 선생님이 담당하는 과목만 표시 (subjects 필드 기반)
  const subjects = (teacher.subjects || []).filter((s) =>
    ["math", "highmath", "english"].includes(s)
  );
  // math 와 highmath 는 같은 tier 체계 공유 → math 로 통합
  const normalized: ("math" | "english")[] = [];
  if (subjects.includes("math") || subjects.includes("highmath"))
    normalized.push("math");
  if (subjects.includes("english")) normalized.push("english");
  if (normalized.length === 0) normalized.push("math"); // 폴백

  const subjectLabel = (s: string) => (s === "math" ? "수학" : "영어");

  // 하드코딩 기본값 + DB 오버라이드 머지 (DB 우선). UI 표시 및 dirty 비교의 기준.
  const merged = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    for (const s of Object.keys(defaultRatios || {})) {
      out[s] = { ...(defaultRatios[s] || {}) };
    }
    for (const s of Object.keys(ratios || {})) {
      out[s] = { ...(out[s] || {}), ...(ratios[s] || {}) };
    }
    return out;
  }, [defaultRatios, ratios]);

  const [draft, setDraft] = useState<Record<string, Record<string, number>>>(
    () => JSON.parse(JSON.stringify(merged))
  );
  const [saving, setSaving] = useState(false);
  // merged 변경 시 draft 동기화 (선생님 전환 등)
  useEffect(() => {
    setDraft(JSON.parse(JSON.stringify(merged)));
  }, [merged]);

  const handleChange = (subject: string, group: string, value: string) => {
    setDraft((d) => {
      const next = { ...d, [subject]: { ...(d[subject] || {}) } };
      const n = parseFloat(value);
      if (isNaN(n) || n <= 0) {
        delete next[subject][group];
        if (Object.keys(next[subject]).length === 0) delete next[subject];
      } else {
        next[subject][group] = n;
      }
      return next;
    });
  };

  const isDirty = JSON.stringify(draft) !== JSON.stringify(merged);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-6 rounded-sm border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          급여 비율 <span className="text-xs font-normal text-zinc-400">(값을 바꾸고 저장하면 이 선생님에게만 적용 · 비우면 45% 폴백)</span>
        </h3>
        {isEditable && isDirty && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-sm bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        )}
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800">
            <th className="w-24 px-3 py-2 text-left text-xs font-medium text-zinc-500">과목</th>
            {GROUPS.map((g) => (
              <th key={g} className="px-3 py-2 text-center text-xs font-medium text-zinc-500">
                {g}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {normalized.map((subject) => (
            <tr key={subject} className="border-b border-zinc-100 dark:border-zinc-800">
              <td className="px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {subjectLabel(subject)}
              </td>
              {GROUPS.map((g) => {
                const value = draft[subject]?.[g];
                const dbValue = ratios?.[subject]?.[g];
                const defaultValue = defaultRatios[subject]?.[g];
                // DB 저장값인지 구분 — 테두리만 강조 (DB=파랑 / 기본값=회색)
                const isFromDB = dbValue != null;
                return (
                  <td key={g} className="px-2 py-1 text-center">
                    {isEditable ? (
                      <div className="flex items-center justify-center gap-1">
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          max="100"
                          value={value ?? ""}
                          onChange={(e) => handleChange(subject, g, e.target.value)}
                          placeholder="45"
                          title={
                            dbValue != null
                              ? `DB 저장값: ${dbValue}%`
                              : defaultValue != null
                              ? `하드코딩 기본값: ${defaultValue}% (적용 중, 저장하면 DB에 기록)`
                              : "비어있으면 공용 45% 적용"
                          }
                          className={`w-16 rounded-sm border bg-white px-1 py-1 text-center text-sm text-zinc-900 placeholder:text-zinc-400 dark:bg-zinc-800 dark:text-zinc-100 ${
                            isFromDB
                              ? "border-blue-400 dark:border-blue-500"
                              : "border-zinc-300 dark:border-zinc-700"
                          }`}
                        />
                        <span className="text-xs text-zinc-400">%</span>
                      </div>
                    ) : (
                      <span className="text-sm text-zinc-700 dark:text-zinc-300">
                        {value != null ? `${value}%` : <span className="text-zinc-400">—</span>}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
