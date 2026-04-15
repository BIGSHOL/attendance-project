"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useStaff } from "@/hooks/useStaff";
import { useStudents } from "@/hooks/useStudents";
import { useAttendanceData } from "@/hooks/useAttendanceData";
import { useHiddenTeachers } from "@/hooks/useHiddenTeachers";
import { useUserRole } from "@/hooks/useUserRole";
import { useAllUserRoles } from "@/hooks/useAllUserRoles";
import { useTeacherBlogPosts } from "@/hooks/useTeacherBlogPosts";
import { useTeacherSettings } from "@/hooks/useTeacherSettings";
import { useTeacherSheets } from "@/hooks/useTeacherSheets";
import { useSalaryConfig } from "@/hooks/useSalaryConfig";
import { useStudentTierOverrides } from "@/hooks/useStudentTierOverrides";
import { syncTeacherSheet, type TeacherSyncResult } from "@/lib/syncSheet";
import { INITIAL_SETTLEMENT } from "@/types";
import type { MonthlySettlement, Student, Teacher, AttendanceViewMode, SessionPeriod } from "@/types";
import { useSessionPeriods } from "@/hooks/useSessionPeriods";
import { useHolidays } from "@/hooks/useHolidays";
import { usePaymentsForMonth } from "@/hooks/usePaymentsForMonth";
import { expandSessionDatesContiguous } from "@/lib/sessionUtils";
import { calculateStats, calculateFinalSalary, matchSalarySetting } from "@/lib/salary";
import { findStudentPayments } from "@/lib/studentPaymentMatcher";
import { filterStudentsByMonth, isNewInMonth, isLeavingInMonth } from "@/lib/studentFilter";
import { extractDaysForTeacher } from "@/lib/enrollmentDays";
import { toSubjectLabel } from "@/lib/labelMap";
import { CELL_SIZE_OPTIONS, CELL_WIDTH, CELL_HEIGHT, type CellSize } from "@/lib/cellSize";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useHiddenCells } from "@/hooks/useHiddenCells";
import AttendanceTable from "./attendance/AttendanceTable";
import dynamic from "next/dynamic";

// 큰 모달들은 초기 번들에서 분리 — 열릴 때 로드
const SettlementModal = dynamic(() => import("./attendance/SettlementModal"), { ssr: false });
const SalarySettingsModal = dynamic(() => import("./attendance/SalarySettingsModal"), { ssr: false });
const SessionSettingsModal = dynamic(() => import("./attendance/SessionSettingsModal"), { ssr: false });

type SortMode = "class" | "name" | "day";

export default function AttendancePage() {
  const now = new Date();
  const [year, setYear] = useLocalStorage<number>("attendance.year", now.getFullYear());
  const [month, setMonth] = useLocalStorage<number>("attendance.month", now.getMonth() + 1);
  const [selectedSubject, setSelectedSubject] = useLocalStorage<string>("attendance.subject", "math");
  const [selectedTeacherId, setSelectedTeacherId] = useLocalStorage<string>("attendance.teacherId", "");

  // 세션 모드
  const [viewMode, setViewMode] = useLocalStorage<AttendanceViewMode>("attendance.viewMode", "monthly");
  const [selectedSessionId, setSelectedSessionId] = useLocalStorage<string | null>(
    "attendance.selectedSessionId",
    null
  );
  const { sessions: sessionPeriods } = useSessionPeriods(year, selectedSubject);
  const selectedSession = useMemo<SessionPeriod | null>(
    () => sessionPeriods.find((s) => s.id === selectedSessionId) || null,
    [sessionPeriods, selectedSessionId]
  );
  // 현재 month/category에 맞는 세션 자동 선택 (month 변경 시 자동 재선택)
  useEffect(() => {
    if (viewMode !== "session") return;
    const match = sessionPeriods.find((s) => s.month === month);
    if (match) {
      if (match.id !== selectedSessionId) setSelectedSessionId(match.id);
    } else {
      if (selectedSessionId) setSelectedSessionId(null);
    }
  }, [viewMode, sessionPeriods, month, selectedSessionId, setSelectedSessionId]);

  // 표시 옵션
  const [sortMode, setSortMode] = useState<SortMode>("class");
  const [highlightWeekends, setHighlightWeekends] = useState(false);
  const [showExpectedBilling, setShowExpectedBilling] = useState(false);
  const [showSettlement, setShowSettlement] = useState(false);
  const [hideZeroAttendance, setHideZeroAttendance] = useLocalStorage<boolean>(
    "attendance.hideZeroAttendance",
    false
  );

  // 셀 크기 (localStorage 저장)
  const [cellWidth, setCellWidth] = useLocalStorage<CellSize>("attendance.cellWidth", "md");
  const [cellHeight, setCellHeight] = useLocalStorage<CellSize>("attendance.cellHeight", "md");
  const cellWidthPx = CELL_WIDTH[cellWidth];
  const cellHeightPx = CELL_HEIGHT[cellHeight];

  // 숨김 행/열
  const {
    hiddenDateSet,
    hiddenStudentSet,
    hideDate,
    hideStudent,
    showAllDates,
    showAllStudents,
  } = useHiddenCells(selectedTeacherId, year, month);

  // 모달
  const [isSettlementOpen, setSettlementOpen] = useState(false);
  const [isSalarySettingsOpen, setSalarySettingsOpen] = useState(false);
  const [isSessionSettingsOpen, setSessionSettingsOpen] = useState(false);

  // 급여 설정 (Supabase 영속화)
  const { config: salaryConfig, save: saveSalaryConfig } = useSalaryConfig();
  const [settlement, setSettlement] = useState<MonthlySettlement>(INITIAL_SETTLEMENT);

  // 공휴일 (data.go.kr getHoliDeInfo 캐시)
  const { dateSet: holidayDateSet, nameMap: holidayNameMap } = useHolidays(year);

  // 데이터
  const { teachers, loading: staffLoading } = useStaff();
  const { students: allStudents, loading: studentsLoading } = useStudents();
  const { hiddenTeacherIds } = useHiddenTeachers();
  const { userRole, isAdmin, isTeacher } = useUserRole();
  const { users: userRoles } = useAllUserRoles();

  // 블로그 의무 + 급여 유형 (staff_id 기반 teacher_settings 우선)
  const { isBlogRequired, getSalary } = useTeacherSettings();

  // 선택된 선생님의 급여 유형
  // 우선순위: teacher_settings → user_roles fallback → 기본 commission
  const selectedTeacherSalaryInfo = useMemo(() => {
    const fromSettings = getSalary(selectedTeacherId);
    if (fromSettings) return fromSettings;
    const u = userRoles.find(
      (ur) => (ur.role === "teacher" || ur.role === "admin") && ur.staff_id === selectedTeacherId
    );
    return {
      type: u?.salary_type || ("commission" as const),
      days: u?.commission_days || [],
    };
  }, [getSalary, userRoles, selectedTeacherId]);
  const selectedBlogRequired = isBlogRequired(selectedTeacherId);

  // 선택된 선생님의 해당 월 블로그 작성 여부 → 패널티 판정
  const { hasPostForMonth, getPost } = useTeacherBlogPosts(selectedTeacherId, year, month);
  const blogPenalty =
    selectedBlogRequired && !hasPostForMonth(year, month);

  // 블로그 작성 날짜 목록 (뱃지 표시용)
  const blogDates = useMemo(() => {
    const post = getPost(year, month);
    if (!post || !Array.isArray(post.dates)) return [] as number[];
    // "2026-04-05" → 5
    return post.dates
      .map((d) => {
        const parts = d.split("-");
        return parts.length === 3 ? parseInt(parts[2], 10) : NaN;
      })
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
  }, [getPost, year, month]);

  // 과목 목록 추출
  const subjects = useMemo(() => {
    const set = new Set<string>();
    teachers.forEach((t) => t.subjects?.forEach((s) => set.add(s)));
    return Array.from(set).sort();
  }, [teachers]);

  // 선생님 매칭: staffId/이름/영어이름 매칭 + 선생님의 담당 과목에 해당하는 enrollment만
  const isTeacherMatch = useCallback(
    (
      enrollment: { staffId?: string; teacher?: string; subject?: string },
      teacher: Teacher
    ) => {
      const staffId = enrollment.staffId || "";
      const teacherName = enrollment.teacher || "";
      const nameMatch =
        staffId === teacher.id ||
        staffId === teacher.name ||
        staffId === teacher.englishName ||
        teacherName === teacher.name ||
        teacherName === teacher.englishName;
      if (!nameMatch) return false;

      // 과목 필터: 선생님의 담당 과목 내에 enrollment 과목이 있는지 확인
      // (highmath 선생님도 math enrollment를 가질 수 있으니 교차 허용)
      if (teacher.subjects && teacher.subjects.length > 0 && enrollment.subject) {
        return teacher.subjects.includes(enrollment.subject);
      }
      return true;
    },
    []
  );

  // 선생님 담당 학생 수 계산
  // 키(id/name/englishName) → teacher[] 역인덱스를 만들고 enrollment 당 한 번만 탐색
  // (student × teacher 중첩 루프 → O(students × enrollments) 로 축소)
  const teacherStudentCount = useMemo(() => {
    const keyToTeachers = new Map<string, Teacher[]>();
    const pushKey = (k: string | undefined, t: Teacher) => {
      if (!k) return;
      const arr = keyToTeachers.get(k);
      if (arr) arr.push(t);
      else keyToTeachers.set(k, [t]);
    };
    for (const t of teachers) {
      pushKey(t.id, t);
      pushKey(t.name, t);
      pushKey(t.englishName, t);
    }

    const counts = new Map<string, Set<string>>();
    for (const s of allStudents) {
      if (!s.enrollments) continue;
      const matchedTeacherIds = new Set<string>();
      for (const e of s.enrollments) {
        const candidates = [
          ...(keyToTeachers.get(e.staffId || "") || []),
          ...(keyToTeachers.get(e.teacher || "") || []),
        ];
        for (const t of candidates) {
          if (
            t.subjects &&
            t.subjects.length > 0 &&
            e.subject &&
            !t.subjects.includes(e.subject)
          ) continue;
          matchedTeacherIds.add(t.id);
        }
      }
      for (const tid of matchedTeacherIds) {
        if (!counts.has(tid)) counts.set(tid, new Set());
        counts.get(tid)!.add(s.id);
      }
    }

    const map = new Map<string, number>();
    for (const t of teachers) map.set(t.id, counts.get(t.id)?.size || 0);
    return map;
  }, [teachers, allStudents]);

  // 시트 동기화 상태 + F열 tier 오버라이드
  const { sheets: teacherSheets, markSynced } = useTeacherSheets();
  const { overrides: tierOverrides, refetch: refetchTierOverrides } =
    useStudentTierOverrides(selectedTeacherId);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<TeacherSyncResult | null>(null);
  const currentSheetUrl = useMemo(
    () => teacherSheets.find((s) => s.teacher_id === selectedTeacherId)?.sheet_url || null,
    [teacherSheets, selectedTeacherId]
  );

  // 과목별 선생님 필터
  // - 선생님 계정: 매핑된 자기 자신만
  // - 관리자/마스터: 전체 (과목/담당학생 0/숨김 제외)
  const visibleTeachers = useMemo(() => {
    if (isTeacher && userRole?.staff_id) {
      const me = teachers.find((t) => t.id === userRole.staff_id);
      return me ? [me] : [];
    }

    return teachers
      .filter((t) => {
        if (!t.subjects || t.subjects.length === 0) return false;
        if (!t.subjects.includes(selectedSubject)) return false;
        if ((teacherStudentCount.get(t.id) ?? 0) === 0) return false;
        if (hiddenTeacherIds.has(t.id)) return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [teachers, selectedSubject, teacherStudentCount, hiddenTeacherIds, isTeacher, userRole]);

  // 첫 번째 선생님 자동 선택
  useEffect(() => {
    if (visibleTeachers.length > 0 && !visibleTeachers.find((t) => t.id === selectedTeacherId)) {
      setSelectedTeacherId(visibleTeachers[0].id);
    }
  }, [visibleTeachers, selectedTeacherId]);

  // 세션 모드일 때 출석 fetch 범위 = 세션 전체 기간 (교차 월 포함)
  const attendanceRangeOverride = useMemo(() => {
    if (viewMode !== "session" || !selectedSession) return null;
    const sorted = [...selectedSession.ranges].sort((a, b) =>
      a.startDate.localeCompare(b.startDate)
    );
    if (sorted.length === 0) return null;
    return {
      startDate: sorted[0].startDate,
      endDate: sorted[sorted.length - 1].endDate,
    };
  }, [viewMode, selectedSession]);

  // Supabase 출석 데이터
  const {
    studentDataMap,
    loading: attendanceLoading,
    upsertAttendance,
    updateMemo,
    updateCellColor,
    updateHomework,
    refetch: refetchAttendance,
    editingByPeers,
    setEditingCell,
  } = useAttendanceData(selectedTeacherId, year, month, attendanceRangeOverride);

  // 선생님 기반 학생 필터링 + Supabase 출석 데이터 머지
  const selectedTeacher = useMemo(
    () => teachers.find((t) => t.id === selectedTeacherId),
    [teachers, selectedTeacherId]
  );

  const filteredStudents = useMemo(() => {
    if (!selectedTeacherId || !selectedTeacher) return [];

    // 1. 해당 선생님 담당 학생
    let filtered = allStudents.filter((s) =>
      s.enrollments?.some((e) => isTeacherMatch(e, selectedTeacher))
    );

    // 2. 해당 월에 재원 중이었던 학생만 (신입생/퇴원생 월별 처리)
    filtered = filterStudentsByMonth(filtered, year, month);

    const dataMap = studentDataMap;
    const ymPrefix = `${year}-${String(month).padStart(2, "0")}`;

    return filtered
      .map((s): Student => {
        const supaData = dataMap.get(s.id);
        // 선택된 선생님 담당 enrollment의 className 사용
        const teacherEnrollment = s.enrollments?.find((e) => isTeacherMatch(e, selectedTeacher));
        // 해당 선생님 수업의 요일만 추출 (schedule "월 1" → "월")
        const days = extractDaysForTeacher(s.enrollments, (e) => isTeacherMatch(e, selectedTeacher));

        // 반이동/첫수업/퇴원 경계 판정을 per-teacher 단위로 하기 위해
        // 해당 선생님 enrollment의 날짜로 오버라이드
        const enrollStart = teacherEnrollment?.startDate || s.startDate;
        const enrollEnd = teacherEnrollment?.endDate || s.endDate;

        return {
          ...s,
          group: teacherEnrollment?.className || s.group || "미분류",
          startDate: enrollStart,
          endDate: enrollEnd,
          days,
          attendance: supaData?.attendance ?? s.attendance ?? {},
          memos: supaData?.memos ?? s.memos ?? {},
          homework: supaData?.homework ?? s.homework ?? {},
          cellColors: supaData?.cellColors ?? s.cellColors ?? {},
        };
      })
      .filter((s) => {
        const monthAttendanceTotal = Object.entries(s.attendance || {}).reduce(
          (sum, [key, v]) => sum + (key.startsWith(ymPrefix) && v > 0 ? v : 0),
          0
        );
        // 토글: 이번 달 출석이 0이면 전부 숨김
        if (hideZeroAttendance && monthAttendanceTotal === 0) return false;
        // 토글 OFF이어도, 이번 달 신입/퇴원 뱃지 대상이면서 출석 0인 학생은 숨김
        // (수업을 1회도 하지 않은 학생은 신입도 퇴원도 아니므로 노출 제외)
        const isNew = isNewInMonth(s, year, month);
        const isLeaving = isLeavingInMonth(s, year, month);
        if (isNew || isLeaving) return monthAttendanceTotal > 0;
        return true;
      });
  }, [allStudents, selectedTeacherId, selectedTeacher, isTeacherMatch, studentDataMap, year, month, hideZeroAttendance]);

  // 수납 데이터 (등록차수 계산용)
  const { payments: monthPayments } = usePaymentsForMonth(year, month);

  // 학생별 등록차수 계산: (담당 선생님 수납 합계) / (학생 단가)
  // 사용자 정의: "학생과 담임선생님이 일치하는 행의 청구액" / "학생의 단가"
  const termCountMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!selectedTeacher || monthPayments.length === 0) return map;

    const teacherName = selectedTeacher.name;
    const teacherEnglishName = selectedTeacher.englishName;
    const teacherId = selectedTeacher.id;

    // 수학 선생님 여부: subjects에 math/highmath 포함
    const isMathTeacher = !!selectedTeacher.subjects?.some(
      (s) => s === "math" || s === "highmath"
    );
    // 수학 수납 식별: payment_name 끝에 공백+요일 조합 (예: "중등M 중1 EL2T 화금")
    const MATH_DAY_PATTERN = /\s[월화수목금토일]+\s*$/;

    for (const student of filteredStudents) {
      const studentPayments = findStudentPayments(student, monthPayments);
      // 담임 선생님 일치 필터
      // payment.teacher_name 이 "이영현(Ellen)" 형식일 수 있어 substring 매칭
      const teacherPayments = studentPayments.filter((p) => {
        if (p.teacher_staff_id && p.teacher_staff_id === teacherId) return true;
        const pt = p.teacher_name || "";
        if (!pt) return false;
        if (teacherName && pt.includes(teacherName)) return true;
        if (teacherEnglishName && pt.includes(teacherEnglishName)) return true;
        return false;
      });
      // 수학 선생님이면 수납명에 요일 패턴이 있는 행만 포함 (영어/기타 과목 수납 제외)
      const filtered = isMathTeacher
        ? teacherPayments.filter((p) => MATH_DAY_PATTERN.test(p.payment_name || ""))
        : teacherPayments;
      if (filtered.length === 0) continue;

      const totalCharge = filtered.reduce((s, p) => s + (p.charge_amount || 0), 0);
      if (totalCharge <= 0) continue;

      const setting = matchSalarySetting(
        student,
        salaryConfig,
        undefined,
        tierOverrides[student.id]
      );
      const unitPrice = setting?.unitPrice || 0;
      if (unitPrice <= 0) continue;

      // 반올림 (원 단위 잔돈이 있을 수 있으므로)
      const term = Math.round(totalCharge / unitPrice);
      if (term > 0) map.set(student.id, term);
    }
    return map;
  }, [filteredStudents, monthPayments, selectedTeacher, salaryConfig, tierOverrides, year, month]);

  const loading = staffLoading || studentsLoading || attendanceLoading;

  // 학생별 이번 달 납부액 합계 (수납 → 정산 반영용)
  const paidAmountByStudent = useMemo(() => {
    const map = new Map<string, number>();
    if (monthPayments.length === 0) return map;
    for (const student of filteredStudents) {
      const studentPayments = findStudentPayments(student, monthPayments);
      if (studentPayments.length === 0) continue;
      const total = studentPayments.reduce((s, p) => s + (p.charge_amount || 0), 0);
      if (total > 0) map.set(student.id, total);
    }
    return map;
  }, [filteredStudents, monthPayments]);

  // 통계
  const stats = useMemo(
    () => calculateStats(
      filteredStudents,
      salaryConfig,
      year,
      month,
      selectedTeacherSalaryInfo.type,
      selectedTeacherSalaryInfo.days,
      selectedSubject === "english"
        ? "english"
        : selectedSubject === "math" || selectedSubject === "highmath"
        ? "math"
        : "other",
      selectedTeacher?.name,
      blogPenalty,
      tierOverrides,
      paidAmountByStudent
    ),
    [filteredStudents, salaryConfig, year, month, selectedTeacherSalaryInfo, selectedSubject, selectedTeacher, blogPenalty, tierOverrides, paidAmountByStudent]
  );

  const finalSalary = useMemo(
    () => calculateFinalSalary(stats.totalSalary, salaryConfig.incentives, settlement),
    [stats.totalSalary, salaryConfig.incentives, settlement]
  );

  // 이번 달 신입/퇴원 수
  const { newCount, leavingCount } = useMemo(() => {
    let n = 0, l = 0;
    for (const s of filteredStudents) {
      if (isNewInMonth(s, year, month)) n++;
      if (isLeavingInMonth(s, year, month)) l++;
    }
    return { newCount: n, leavingCount: l };
  }, [filteredStudents, year, month]);

  // 지난 달 재원생 수 — 신입/퇴원 비율의 분모 (현재 월 기준이 아니라 이전 월 재원생 수 기준)
  const prevMonthStudentCount = useMemo(() => {
    if (!selectedTeacher) return 0;
    const prevYear = month === 1 ? year - 1 : year;
    const prevMon = month === 1 ? 12 : month - 1;
    const mm = String(prevMon).padStart(2, "0");
    const firstDay = `${prevYear}-${mm}-01`;
    const lastDate = new Date(prevYear, prevMon, 0).getDate();
    const lastDay = `${prevYear}-${mm}-${String(lastDate).padStart(2, "0")}`;

    return allStudents.filter((s) => {
      const e = s.enrollments?.find((en) => isTeacherMatch(en, selectedTeacher));
      if (!e) return false;
      const start = e.startDate || s.startDate || "";
      const end = e.endDate || s.endDate || "";
      // 지난 달 시작일 이후 입학 → 지난 달에는 재원 아님
      if (start && start > lastDay) return false;
      // 지난 달 시작일 이전 퇴원 → 지난 달에는 재원 아님
      if (end && end < firstDay) return false;
      return true;
    }).length;
  }, [allStudents, selectedTeacher, isTeacherMatch, year, month]);

  const newRate = prevMonthStudentCount > 0 ? (newCount / prevMonthStudentCount) * 100 : 0;
  const leavingRate = prevMonthStudentCount > 0 ? (leavingCount / prevMonthStudentCount) * 100 : 0;

  // 월 이동
  const prevMonth = () => {
    if (month === 1) { setYear(year - 1); setMonth(12); }
    else setMonth(month - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setYear(year + 1); setMonth(1); }
    else setMonth(month + 1);
  };

  // 현재 선택 월 + 선생님 기준 시트 동기화
  const handleSyncSheet = useCallback(async () => {
    if (syncing || !selectedTeacherId || !selectedTeacher || !currentSheetUrl) return;
    const exactMonth = `${year}-${String(month).padStart(2, "0")}`;
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await syncTeacherSheet(
        selectedTeacherId,
        selectedTeacher.name,
        currentSheetUrl,
        allStudents,
        "2026-03",
        exactMonth,
        salaryConfig
      );
      setSyncResult(result);
      if (result.success) {
        await markSynced(selectedTeacherId);
        // 동기화 결과 반영: 출석/메모 + tier 오버라이드 DB 재조회
        await Promise.all([refetchAttendance(), refetchTierOverrides()]);
      }
    } finally {
      setSyncing(false);
    }
  }, [syncing, selectedTeacherId, selectedTeacher, currentSheetUrl, year, month, allStudents, markSynced, refetchAttendance, salaryConfig, refetchTierOverrides]);

  // Supabase 연동 핸들러 — 편집 시 presence broadcast (다른 사용자에게 "편집 중" 표시)
  // 변경 후 2초간 본인 편집 셀로 잠가서 realtime 에코로 인한 깜빡임 방지
  const markEditing = useCallback(
    (studentId: string, dateKey: string) => {
      void setEditingCell(studentId, dateKey, true);
      setTimeout(() => {
        void setEditingCell(studentId, dateKey, false);
      }, 2000);
    },
    [setEditingCell]
  );

  const handleAttendanceChange = useCallback(
    (studentId: string, dateKey: string, value: number | null) => {
      markEditing(studentId, dateKey);
      upsertAttendance(studentId, dateKey, value);
    },
    [upsertAttendance, markEditing]
  );

  const handleMemoChange = useCallback(
    (studentId: string, dateKey: string, memo: string) => {
      markEditing(studentId, dateKey);
      updateMemo(studentId, dateKey, memo);
    },
    [updateMemo, markEditing]
  );

  const handleCellColorChange = useCallback(
    (studentId: string, dateKey: string, color: string | null) => {
      markEditing(studentId, dateKey);
      updateCellColor(studentId, dateKey, color);
    },
    [updateCellColor, markEditing]
  );

  const handleHomeworkChange = useCallback(
    (studentId: string, dateKey: string, done: boolean) => {
      markEditing(studentId, dateKey);
      updateHomework(studentId, dateKey, done);
    },
    [updateHomework, markEditing]
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* 상단 1행: 통계 + 주요 네비게이션 */}
      <div className="flex items-center gap-2 px-3 pt-2 pb-1 bg-white dark:bg-zinc-900 overflow-x-auto flex-shrink-0 [&>*]:flex-shrink-0 whitespace-nowrap">
        {/* 급여 카드 */}
        <button
          onClick={() => setSettlementOpen(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-sm bg-blue-50 text-blue-700 text-sm hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300"
        >
          <span>💰</span>
          <span className="font-semibold">이번 달 급여</span>
          <span className="font-bold">{finalSalary.toLocaleString()}원</span>
        </button>

        {/* 학생 수 */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-sm bg-zinc-100 text-zinc-700 text-sm dark:bg-zinc-800 dark:text-zinc-300">
          <span className="font-semibold">학생</span>
          <span className="font-bold">{stats.studentCount}</span>
        </div>

        {/* 출석 합계 */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-sm bg-emerald-50 text-emerald-700 text-sm dark:bg-emerald-950 dark:text-emerald-300">
          <span className="font-semibold">출석</span>
          <span className="font-bold">{stats.totalAttendance}</span>
        </div>

        {/* 신입 (지난 달 재원생 대비 비율) */}
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-sm bg-blue-50 text-blue-700 text-sm dark:bg-blue-950 dark:text-blue-300"
          title={`지난 달 재원생 ${prevMonthStudentCount}명 기준`}
        >
          <span className="font-semibold">신입</span>
          <span className="font-bold">+{newCount}</span>
          {prevMonthStudentCount > 0 && (
            <span className="text-xs opacity-70">({newRate.toFixed(1)}%)</span>
          )}
        </div>

        {/* 퇴원 (지난 달 재원생 대비 비율) */}
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-sm bg-red-50 text-red-700 text-sm dark:bg-red-950 dark:text-red-300"
          title={`지난 달 재원생 ${prevMonthStudentCount}명 기준`}
        >
          <span className="font-semibold">퇴원</span>
          <span className="font-bold">-{leavingCount}</span>
          {prevMonthStudentCount > 0 && (
            <span className="text-xs opacity-70">({leavingRate.toFixed(1)}%)</span>
          )}
        </div>

        {/* 블로그 작성 날짜 */}
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-sm bg-amber-50 text-amber-700 text-sm dark:bg-amber-950 dark:text-amber-300"
          title={
            blogDates.length > 0
              ? `${year}년 ${month}월 블로그 작성: ${blogDates.map((d) => `${d}일`).join(", ")}`
              : `${year}년 ${month}월 블로그 기록 없음`
          }
        >
          <span className="font-semibold">블로그</span>
          {blogDates.length > 0 ? (
            <span className="font-bold">{blogDates.map((d) => `${d}일`).join(", ")}</span>
          ) : (
            <span className="text-xs opacity-70">기록 없음</span>
          )}
        </div>

        <div className="flex-1 min-w-[8px]" />

        {/* 과목 선택 */}
        <div className="flex rounded-sm bg-zinc-200 p-0.5 dark:bg-zinc-800">
          {subjects.map((subj) => (
            <button
              key={subj}
              onClick={() => setSelectedSubject(subj)}
              className={`rounded px-3 py-1.5 text-sm font-medium ${
                selectedSubject === subj
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
                  : "text-zinc-600 dark:text-zinc-400"
              }`}
            >
              {toSubjectLabel(subj)}
            </button>
          ))}
        </div>

        {/* 선생님 선택 */}
        <select
          value={selectedTeacherId}
          onChange={(e) => setSelectedTeacherId(e.target.value)}
          className="rounded-sm border border-zinc-300 bg-white px-2 py-1.5 text-sm font-medium dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
        >
          {visibleTeachers.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
          {visibleTeachers.length === 0 && (
            <option value="" disabled>선생님 없음</option>
          )}
        </select>

        {/* 시트 동기화 (관리자 이상만 + 시트 등록된 선생님만) */}
        {isAdmin && currentSheetUrl && (
          <button
            onClick={handleSyncSheet}
            disabled={syncing}
            className="rounded-sm bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:bg-zinc-300"
            title={`${year}년 ${month}월 탭에서 출석/메모 동기화 (덮어쓰기)`}
          >
            {syncing ? "동기화 중..." : `📄 ${String(year).slice(2)}.${String(month).padStart(2, "0")} 동기화`}
          </button>
        )}

        {/* 월 이동 */}
        <div className="flex items-center gap-1">
          <button onClick={prevMonth} className="rounded-sm border border-zinc-300 px-2.5 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">◀</button>
          <span className="px-3 py-1.5 text-sm font-bold text-zinc-900 dark:text-zinc-100 min-w-[90px] text-center">
            {year}년 {month}월
          </span>
          <button onClick={nextMonth} className="rounded-sm border border-zinc-300 px-2.5 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">▶</button>
        </div>
      </div>

      {/* 상단 2행: 표시 옵션 */}
      <div className="flex items-center gap-2 px-3 pb-2 pt-1 border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 overflow-x-auto flex-shrink-0 [&>*]:flex-shrink-0 whitespace-nowrap">
        {/* 토글 */}
        <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 cursor-pointer dark:text-zinc-300">
          <input type="checkbox" checked={showExpectedBilling} onChange={(e) => setShowExpectedBilling(e.target.checked)} className="rounded border-zinc-300 w-4 h-4" />
          예정액
        </label>
        <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 cursor-pointer dark:text-zinc-300">
          <input type="checkbox" checked={showSettlement} onChange={(e) => setShowSettlement(e.target.checked)} className="rounded border-zinc-300 w-4 h-4" />
          정산액
        </label>
        <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 cursor-pointer dark:text-zinc-300">
          <input type="checkbox" checked={highlightWeekends} onChange={(e) => setHighlightWeekends(e.target.checked)} className="rounded border-zinc-300 w-4 h-4" />
          주말 회색
        </label>
        <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 cursor-pointer dark:text-zinc-300">
          <input type="checkbox" checked={hideZeroAttendance} onChange={(e) => setHideZeroAttendance(e.target.checked)} className="rounded border-zinc-300 w-4 h-4" />
          0출석 숨김
        </label>

        {/* 날짜 셀 가로폭 */}
        <div className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 ml-1 dark:text-zinc-300">
          <span>가로</span>
          <select
            value={cellWidth}
            onChange={(e) => setCellWidth(e.target.value as CellSize)}
            className="rounded-sm border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          >
            {CELL_SIZE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* 날짜 셀 세로폭 */}
        <div className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          <span>세로</span>
          <select
            value={cellHeight}
            onChange={(e) => setCellHeight(e.target.value as CellSize)}
            className="rounded-sm border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          >
            {CELL_SIZE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* 숨김 해제 */}
        {(hiddenDateSet.size > 0 || hiddenStudentSet.size > 0) && (
          <button
            onClick={() => {
              if (hiddenDateSet.size > 0) showAllDates();
              if (hiddenStudentSet.size > 0) showAllStudents();
            }}
            title={`숨김: 날짜 ${hiddenDateSet.size}개 / 학생 ${hiddenStudentSet.size}명`}
            className="rounded-sm border border-amber-400 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-100"
          >
            숨김 해제 ({hiddenDateSet.size + hiddenStudentSet.size})
          </button>
        )}

        {/* 정렬 모드 */}
        <div className="flex rounded-sm bg-zinc-200 p-0.5 ml-1 dark:bg-zinc-800">
          <button
            onClick={() => setSortMode("class")}
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              sortMode === "class" ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100" : "text-zinc-600 dark:text-zinc-400"
            }`}
          >
            수업
          </button>
          <button
            onClick={() => setSortMode("name")}
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              sortMode === "name" ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100" : "text-zinc-600 dark:text-zinc-400"
            }`}
          >
            이름
          </button>
          <button
            onClick={() => setSortMode("day")}
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              sortMode === "day" ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100" : "text-zinc-600 dark:text-zinc-400"
            }`}
          >
            요일
          </button>
        </div>

        <div className="flex-1 min-w-[8px]" />

        {/* 보기 모드 (월/세션) */}
        <div className="flex rounded-sm bg-zinc-200 p-0.5 dark:bg-zinc-800">
          <button
            onClick={() => setViewMode("monthly")}
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              viewMode === "monthly"
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
                : "text-zinc-600 dark:text-zinc-400"
            }`}
          >
            월별
          </button>
          <button
            onClick={() => setViewMode("session")}
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              viewMode === "session"
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
                : "text-zinc-600 dark:text-zinc-400"
            }`}
          >
            세션별
          </button>
        </div>

        {/* 세션 없음 안내 (선택된 세션이 있으면 굳이 표시하지 않음) */}
        {viewMode === "session" && !selectedSession && (
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {toSubjectLabel(selectedSubject)} 세션 없음
          </span>
        )}

        {/* 세션 설정 (관리자만) */}
        {viewMode === "session" && isAdmin && (
          <button
            onClick={() => setSessionSettingsOpen(true)}
            className="rounded-sm border border-zinc-300 px-2 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            title="세션 설정"
          >
            ⚙ 세션
          </button>
        )}

        {/* 설정 */}
        <button
          onClick={() => setSalarySettingsOpen(true)}
          className="rounded-sm border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          ⚙ 설정
        </button>
      </div>

      {/* 동기화 결과 토스트 */}
      {syncResult && (
        <div className="absolute top-16 right-3 z-40 max-w-md rounded-sm border border-zinc-300 bg-white p-3 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <div className="flex items-center justify-between mb-1">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {syncResult.teacherName} 동기화 결과
            </span>
            <button
              onClick={() => setSyncResult(null)}
              className="text-zinc-400 hover:text-zinc-600"
            >
              ✕
            </button>
          </div>
          {syncResult.error && (
            <div className="text-red-600 mb-1">❌ {syncResult.error}</div>
          )}
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
                  {(m.tierMatched > 0 || m.tierUnmatched > 0) && (
                    <span className="text-zinc-500">
                      {" · tier "}{m.tierMatched}
                      {m.tierUnmatched > 0 && (
                        <span className="text-amber-600"> (실패 {m.tierUnmatched})</span>
                      )}
                    </span>
                  )}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 출석 테이블 */}
      <div className="flex-1 min-h-0 overflow-auto" style={{ scrollbarGutter: "stable" }}>
        {loading ? (
          <div className="flex items-center justify-center h-64 text-zinc-400 text-sm">
            불러오는 중...
          </div>
        ) : !selectedTeacherId ? (
          <div className="flex items-center justify-center h-64 text-zinc-400 text-sm">
            선생님을 선택해주세요.
          </div>
        ) : (
          <AttendanceTable
            students={filteredStudents}
            year={year}
            month={month}
            subject={selectedSubject}
            salaryConfig={salaryConfig}
            tierOverrides={tierOverrides}
            highlightWeekends={highlightWeekends}
            showExpectedBilling={showExpectedBilling}
            showSettlement={showSettlement}
            sortMode={sortMode}
            canCustomValue={isAdmin}
            overrideDates={viewMode === "session" && selectedSession ? expandSessionDatesContiguous(selectedSession) : undefined}
            cellWidthPx={cellWidthPx}
            cellHeightPx={cellHeightPx}
            hiddenDateSet={hiddenDateSet}
            hiddenStudentSet={hiddenStudentSet}
            holidayDateSet={holidayDateSet}
            holidayNameMap={holidayNameMap}
            termCountMap={termCountMap}
            onHideDate={hideDate}
            onHideStudent={hideStudent}
            onAttendanceChange={handleAttendanceChange}
            onMemoChange={handleMemoChange}
            onCellColorChange={handleCellColorChange}
            onHomeworkChange={handleHomeworkChange}
            editingByPeers={editingByPeers}
            setEditingCell={setEditingCell}
          />
        )}
      </div>

      {/* 모달 */}
      <SettlementModal
        isOpen={isSettlementOpen}
        onClose={() => setSettlementOpen(false)}
        monthStr={`${year}년 ${month}월`}
        baseSalary={stats.totalSalary}
        droppedStudentRate={0}
        incentiveConfig={salaryConfig.incentives}
        salaryConfig={salaryConfig}
        data={settlement}
        onUpdate={setSettlement}
      />
      <SalarySettingsModal
        isOpen={isSalarySettingsOpen}
        onClose={() => setSalarySettingsOpen(false)}
        config={salaryConfig}
        onSave={saveSalaryConfig}
        readOnly={!isAdmin}
      />
      <SessionSettingsModal
        isOpen={isSessionSettingsOpen}
        onClose={() => setSessionSettingsOpen(false)}
        year={year}
        subjects={subjects}
        initialSubject={selectedSubject}
      />
    </div>
  );
}
