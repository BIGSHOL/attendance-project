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
import type { MonthlySettlement, Student, Teacher, AttendanceViewMode, SessionPeriod, Enrollment } from "@/types";
import { useSessionPeriods } from "@/hooks/useSessionPeriods";
import { useHolidays } from "@/hooks/useHolidays";
import { usePaymentsForMonth } from "@/hooks/usePaymentsForMonth";
import { usePaymentShares } from "@/hooks/usePaymentShares";
import { expandSessionDatesContiguous, isDateInSession } from "@/lib/sessionUtils";
import {
  calculateStats,
  calculateFinalSalary,
  matchSalarySetting,
  calculateStudentSalary,
  getEffectiveRatio,
  isAttendanceCountable,
  gradeToGroup,
  subjectToSalarySubject,
} from "@/lib/salary";
import {
  findStudentPayments,
  filterPaymentsForTeacherRow,
  extractPaymentDays,
  type PaymentLite,
} from "@/lib/studentPaymentMatcher";
import { filterStudentsByMonth, isNewInMonth, isLeavingInMonth, isDateValidForStudent } from "@/lib/studentFilter";
import { extractDaysForTeacher } from "@/lib/enrollmentDays";
import { buildFilteredStudents } from "@/lib/attendancePageData";
import { toSubjectLabel } from "@/lib/labelMap";
import HomeroomPicker from "@/components/consultation/HomeroomPicker";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { CELL_WIDTH, CELL_HEIGHT, type CellSize } from "@/lib/cellSize";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useHiddenCells } from "@/hooks/useHiddenCells";
import { useIsMobile } from "@/hooks/useIsMobile";
import AttendanceTable from "./attendance/AttendanceTable";
import ViewOptionsMenu from "./attendance/ViewOptionsMenu";
import { createWorkbook, addSheet, writeFile } from "@/lib/excelExport";
import { formatDateKey, getDaysInMonth } from "@/lib/date";
import dynamic from "next/dynamic";

// 큰 모달들은 초기 번들에서 분리 — 열릴 때 로드
const SettlementModal = dynamic(() => import("./attendance/SettlementModal"), { ssr: false });
const SessionSettingsModal = dynamic(() => import("./attendance/SessionSettingsModal"), { ssr: false });
const StudentBreakdownModal = dynamic(
  () => import("./attendance/StudentBreakdownModal"),
  { ssr: false }
);
// 모바일 뷰 — 768px 미만에서 활성화
const MobileAttendanceView = dynamic(
  () => import("./attendance/MobileAttendanceView"),
  { ssr: false }
);
// 메모 찾기/바꾸기 모달 (audit E)
const FindReplaceModal = dynamic(
  () => import("./attendance/FindReplaceModal"),
  { ssr: false }
);
// 분반 quick-add 모달 — 출석부에서 즉시 분반 추가
const TierOverrideModal = dynamic(
  () => import("./students/TierOverrideModal"),
  { ssr: false }
);

type SortMode = "class" | "name" | "day";

interface AttendancePageProps {
  /**
   * true 면 보관함 모드 — useStaff 가 퇴사 staff 만 받고, 모든 mutation
   * 핸들러 no-op + 시트 동기화/sync 결과 토스트/TierOverride 추가 버튼 hide.
   * localStorage 키도 `archive.*` prefix 로 분리되어 일반 출석부와 충돌 없음.
   * /admin/archive 페이지에서 이 컴포넌트를 재사용할 때 사용.
   */
  archiveMode?: boolean;
}

export default function AttendancePage({ archiveMode = false }: AttendancePageProps = {}) {
  // localStorage 키 prefix — archiveMode 면 일반 출석부와 분리.
  const keyPrefix = archiveMode ? "archive." : "attendance.";
  const now = new Date();
  const [year, setYear] = useLocalStorage<number>(`${keyPrefix}year`, now.getFullYear());
  const [month, setMonth] = useLocalStorage<number>(`${keyPrefix}month`, now.getMonth() + 1);
  const [selectedSubject, setSelectedSubject] = useLocalStorage<string>(`${keyPrefix}subject`, "math");
  const [selectedTeacherId, setSelectedTeacherId] = useLocalStorage<string>(`${keyPrefix}teacherId`, "");

  // 세션 모드
  const [viewMode, setViewMode] = useLocalStorage<AttendanceViewMode>(`${keyPrefix}viewMode`, "monthly");
  const [selectedSessionId, setSelectedSessionId] = useLocalStorage<string | null>(
    `${keyPrefix}selectedSessionId`,
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

  // 표시 옵션 (localStorage 영속화 — CLAUDE.md 규칙)
  const [sortMode, setSortMode] = useState<SortMode>("class");
  const [studentSearch, setStudentSearch] = useLocalStorage<string>(
    `${keyPrefix}studentSearch`,
    ""
  );
  const [highlightWeekends, setHighlightWeekends] = useLocalStorage<boolean>(
    `${keyPrefix}highlightWeekends`,
    false
  );
  const [showExpectedBilling, setShowExpectedBilling] = useLocalStorage<boolean>(
    `${keyPrefix}showExpectedBilling`,
    false
  );
  const [showPaidAmount, setShowPaidAmount] = useLocalStorage<boolean>(
    `${keyPrefix}showPaidAmount`,
    false
  );
  const [showActualSalary, setShowActualSalary] = useLocalStorage<boolean>(
    `${keyPrefix}showActualSalary`,
    false
  );
  const [hideZeroAttendance, setHideZeroAttendance] = useLocalStorage<boolean>(
    `${keyPrefix}hideZeroAttendance`,
    false
  );

  // 셀 크기 (localStorage 저장)
  const [cellWidth, setCellWidth] = useLocalStorage<CellSize>(`${keyPrefix}cellWidth`, "md");
  // 사용자 정의 폭 (px) — 드래그 리사이즈로 설정. null 이면 cellWidth 의 기본값 사용.
  //   ViewOptionsMenu 에서 S/M/L 누르면 customCellWidthPx 가 자동 reset 되도록 setter 래핑.
  const [customCellWidthPx, setCustomCellWidthPxRaw] = useLocalStorage<
    number | null
  >(`${keyPrefix}customCellWidthPx`, null);
  const [cellHeight, setCellHeight] = useLocalStorage<CellSize>(`${keyPrefix}cellHeight`, "md");
  // cellWidthPx 결정: customCellWidthPx 우선 (드래그로 설정), 없으면 S/M/L 기본값.
  const cellWidthPx =
    typeof customCellWidthPx === "number" && customCellWidthPx > 0
      ? customCellWidthPx
      : CELL_WIDTH[cellWidth];

  // S/M/L 버튼 누르면 사용자 정의 폭 reset.
  const handleCellWidthPreset = useCallback(
    (size: CellSize) => {
      setCellWidth(size);
      setCustomCellWidthPxRaw(null);
    },
    [setCellWidth, setCustomCellWidthPxRaw]
  );

  // 드래그로 폭 갱신 (음수/너무 작은 값 방어).
  const handleColumnResize = useCallback(
    (px: number) => {
      const clamped = Math.max(20, Math.min(200, Math.round(px)));
      setCustomCellWidthPxRaw(clamped);
    },
    [setCustomCellWidthPxRaw]
  );
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
  const [isSessionSettingsOpen, setSessionSettingsOpen] = useState(false);
  // 모바일 감지 — 768px 미만이면 카드형 입력 뷰로 전환 (audit #15)
  const isMobile = useIsMobile(768);
  // 정산 breakdown 모달 (audit #6) — student.id 보유 시 열림
  const [breakdownStudentId, setBreakdownStudentId] = useState<string | null>(
    null
  );
  // 메모 찾기/바꾸기 모달 (audit E) — Ctrl+H 또는 버튼으로 열기
  const [isFindReplaceOpen, setFindReplaceOpen] = useState(false);
  // 분반 quick-add 모달 — 학생 행 🔧 버튼으로 열림 (관리자만)
  const [tierAddStudentId, setTierAddStudentId] = useState<string | null>(null);
  // Ctrl+H — 메모 찾기/바꾸기 (시트 단축키와 동일).
  //   브라우저 기본 동작(history) 가로채기.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "h") {
        // input/textarea 에 포커스되어 있으면 무시 (사용자가 텍스트 편집 중일 수 있음)
        const t = e.target as HTMLElement | null;
        if (
          t &&
          (t.tagName === "INPUT" ||
            t.tagName === "TEXTAREA" ||
            t.isContentEditable)
        )
          return;
        e.preventDefault();
        setFindReplaceOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // 급여 설정 (teacher_settings.ratios 와 자동 병합됨)
  const { config: salaryConfig } = useSalaryConfig();
  const [settlement, setSettlement] = useState<MonthlySettlement>(INITIAL_SETTLEMENT);

  // 공휴일 (data.go.kr getHoliDeInfo 캐시)
  const { dateSet: holidayDateSet, nameMap: holidayNameMap } = useHolidays(year);

  // 데이터
  // archiveMode 면 퇴사 staff 만 (status !== "active") 받아 selector 에 표시.
  const { teachers, loading: staffLoading } = useStaff(
    archiveMode ? { archived: true } : undefined
  );
  const { students: allStudents, loading: studentsLoading, refetch: refetchStudents } = useStudents();
  const { hiddenTeacherIds } = useHiddenTeachers();
  const { userRole, isAdmin, isTeacher } = useUserRole();
  const { users: userRoles } = useAllUserRoles();

  // 블로그 의무 + 급여 유형 (staff_id 기반 teacher_settings 우선)
  const { isBlogRequired, getSalary, getAdminAllowance } = useTeacherSettings();

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
  // 계약 기반(급여제·파트타임) 선생님은 별도 지급이므로 본인이 볼 때는 실급여 표시를 숨김.
  //   - 관리자는 시수/실급여 참고용으로 계속 볼 수 있음 (내부 계산은 항상 진행)
  //   - 본인(급여제/파트타임)은 토글 비활성 + 실급여 숨김 → 상단/테이블에 유형 라벨로 대체
  const isContractBasedTeacher =
    selectedTeacherSalaryInfo.type === "fixed" ||
    selectedTeacherSalaryInfo.type === "part_time";
  const hideSalaryForFixed = isContractBasedTeacher && !isAdmin;
  const effectiveShowActualSalary = !hideSalaryForFixed && showActualSalary;
  // 본인 뷰의 상단 "이번 달 급여" 자리 대체 라벨
  const contractTypeLabel =
    selectedTeacherSalaryInfo.type === "fixed"
      ? "급여제"
      : selectedTeacherSalaryInfo.type === "part_time"
        ? "파트타임"
        : "";

  // 행정급여 — 기본액 × tier 비율(선생님 오버라이드 반영) × (1 − 수수료). 0 이면 미사용.
  const adminSalaryInfo = useMemo(() => {
    const aa = getAdminAllowance(selectedTeacherId);
    if (!aa) return { gross: 0, salary: 0, tierName: "", ratio: 0 };
    const item = (salaryConfig.items || []).find((i) => i.id === aa.tierId);
    if (!item) return { gross: 0, salary: 0, tierName: "", ratio: 0 };
    const teacherName = teachers.find((t) => t.id === selectedTeacherId)?.name;
    const ratio = getEffectiveRatio(item, salaryConfig, teacherName);
    const salary = Math.floor(
      aa.baseAmount * (ratio / 100) * (1 - salaryConfig.academyFee / 100)
    );
    return { gross: aa.baseAmount, salary, tierName: item.name, ratio };
  }, [getAdminAllowance, selectedTeacherId, salaryConfig, teachers]);

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

  // 선생님 담당 학생 수 계산 (선택된 연/월 기준)
  //   - 실제 출석부 표시 학생 수와 일치시키기 위해 filterStudentsByMonth 적용
  //   - 0숨김 토글 / 신입·퇴원 필터는 화면 단위라 제외 (기본 상태와 드롭다운 수 일치가 목적)
  // 키(id/name/englishName) → teacher[] 역인덱스를 만들고 enrollment 당 한 번만 탐색
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

    const monthActive = filterStudentsByMonth(allStudents, year, month);

    const counts = new Map<string, Set<string>>();
    for (const s of monthActive) {
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
  }, [teachers, allStudents, year, month]);

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
        // 담당학생 0 제외 하지 않음 — 과학/신규 선생님(hours>0 기록 이전)도 드롭다운에 노출.
        // 선택 시 학생 0 이면 "동기화 필요" UI 로 사용자가 상태를 알 수 있음.
        if (hiddenTeacherIds.has(t.id)) return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [teachers, selectedSubject, hiddenTeacherIds, isTeacher, userRole]);

  // 첫 번째 선생님 자동 선택
  useEffect(() => {
    if (visibleTeachers.length > 0 && !visibleTeachers.find((t) => t.id === selectedTeacherId)) {
      setSelectedTeacherId(visibleTeachers[0].id);
    }
  }, [visibleTeachers, selectedTeacherId]);

  // 출석 fetch 범위.
  // - 세션 뷰: 선택된 세션 범위(교차 월 포함)
  // - 월별 뷰: null (useAttendanceData 가 달력 월로 fetch)
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

  const filteredStudents = useMemo(
    () =>
      buildFilteredStudents({
        selectedTeacherId,
        selectedTeacher,
        allStudents,
        isTeacherMatch,
        studentDataMap,
        year,
        month,
        hideZeroAttendance,
        sessionPeriods,
      }),
    [allStudents, selectedTeacherId, selectedTeacher, isTeacherMatch, studentDataMap, year, month, hideZeroAttendance, sessionPeriods]
  );

  // 수납 데이터 (등록차수 계산용)
  const { payments: rawMonthPayments } = usePaymentsForMonth(year, month);
  // 영어 선생님의 경우 payment_shares (강사별 학생 수납 분배) 를 추가 로드.
  // shares 는 기존 PaymentLite 포맷으로 변환해 monthPayments 에 합쳐 사용.
  const isEnglishTeacher = !!selectedTeacher?.subjects?.includes("english");
  const { shares: teacherShares, refetch: refetchShares } = usePaymentShares(
    isEnglishTeacher ? selectedTeacherId : "",
    year,
    month
  );
  const monthPayments = useMemo<PaymentLite[]>(() => {
    if (!isEnglishTeacher || teacherShares.length === 0) return rawMonthPayments;
    // shares → PaymentLite 변환. 기존 findStudentPayments 매칭을 위해 이름/학교 채움.
    const byId = new Map<string, { name: string; school?: string; grade?: string; studentCode?: string }>();
    for (const s of allStudents) {
      byId.set(s.id, { name: s.name, school: s.school, grade: s.grade, studentCode: s.studentCode });
    }
    const billingMonth = `${year}${String(month).padStart(2, "0")}`;
    const converted: PaymentLite[] = teacherShares.map((sh) => {
      const stu = byId.get(sh.student_id);
      return {
        id: sh.id,
        student_code: stu?.studentCode || "",
        student_name: stu?.name || "",
        school: stu?.school,
        grade: stu?.grade,
        billing_month: billingMonth,
        // payment_name 에 class_name 을 넣어 inferTierForPrice 에서 학생 DB class 로 매칭
        payment_name: sh.class_name,
        charge_amount: sh.allocated_paid, // 납입 기준으로 처리 (기존 로직과 호환)
        discount_amount: Math.max(0, sh.allocated_charge - sh.allocated_paid),
        paid_amount: sh.allocated_paid,
        teacher_name: selectedTeacher?.name,
        teacher_staff_id: sh.teacher_staff_id,
      };
    });
    return converted;
  }, [isEnglishTeacher, teacherShares, rawMonthPayments, allStudents, year, month, selectedTeacher?.name]);

  /**
   * 수납명에서 끝의 요일 토큰을 제거한 prefix (분반/tier 폴백 식별자).
   */
  const paymentClassKey = (paymentName: string): string =>
    (paymentName || "").replace(/\s[월화수목금토일]+\s*$/, "").trim();

  /**
   * 단가 풀 — salaryConfig.items 의 비율제 baseTuition(+ fixed 유형의 unitPrice) 집합.
   * "수납 엔진"이 수납 금액을 이 풀의 단가로 역산 매칭하는 기준.
   */
  // deps 좁힘 (audit v5 #8) — salaryConfig 전체 reference 변경에 무감각.
  //   knownUnitPrices 는 items 만 의존하므로 salaryConfig.items 만 봄.
  const knownUnitPrices = useMemo(() => {
    const set = new Set<number>();
    for (const item of salaryConfig.items || []) {
      // baseTuition 과 unitPrice 둘 다 후보로 추가 (서로 다를 수 있음)
      if (item.baseTuition && item.baseTuition > 0) set.add(item.baseTuition);
      if (item.unitPrice && item.unitPrice > 0) set.add(item.unitPrice);
    }
    return Array.from(set).sort((a, b) => b - a);
  }, [salaryConfig.items]);

  /**
   * 수납 엔진 — charge 금액에서 단가를 역산.
   *
   * 가정: charge = 단가 × 시수(월 수업 횟수).
   * 알려진 단가 풀에서 `charge % 단가 === 0` 인 값을 탐색.
   * 여러 값이 매치하면 시수가 1~16 범위 안에 들어오는 것 중 가장 큰 단가를 선택
   * (큰 단가일수록 "특수/상위 과정"일 가능성이 높고 시수가 작아 현실적).
   *
   * 매치 실패 시 null 반환 → 폴백으로 payment_name prefix 사용.
   */
  const inferUnitPrice = (charge: number): number | null => {
    if (charge <= 0) return null;
    for (const price of knownUnitPrices) {
      if (charge % price !== 0) continue;
      const n = charge / price;
      if (n >= 1 && n <= 16) return price;
    }
    return null;
  };

  /**
   * 학생을 "수납 분반(=payment_name prefix)" 기준으로 분리한 행 목록.
   *
   * 규칙: 한 학생이 한 선생님에게 서로 다른 분반(다른 단가)의 수납이 2건 이상인 경우에만
   *       행을 분리. 같은 분반(단가 동일)의 요일 분할 수납은 1행으로 병합.
   *
   * 예) 김지홍 — "CR1C 목"(21,250) + "TP2Q 화금"(24,000) → 2행 분리
   *     김민찬 — "CR1C 월" 85,000 + "CR1C 목" 85,000 → 같은 분반 → 1행 병합 (170,000)
   *     강지원 — 수 수납 1건 → 1행 유지
   *
   * 각 분리 행은:
   *   - id: `{studentId}|{병합된 요일키}` 로 고유
   *   - days: 병합된 모든 요일의 합집합
   *   - attendance: 이 요일들의 출석만 필터
   */
  const studentRows = useMemo(() => {
    if (!selectedTeacher) return filteredStudents;

    const opts = {
      teacherId: selectedTeacher.id,
      teacherName: selectedTeacher.name,
      teacherEnglishName: selectedTeacher.englishName,
      isMathTeacher: !!selectedTeacher.subjects?.some(
        (s) => s === "math" || s === "highmath"
      ),
    };

    // 영어 교사 전용 — shares 기반 직접 구성.
    //   그룹 라벨(row.group) 은 payments 테이블에서 (학생 × 이 선생님) 수납을
    //   매칭해 payment_name 을 사용. 시트 F열 tier 와 payments.payment_name 은
    //   포맷이 달라(예: 시트 "중등 2T" vs payments "중등E_중2 심화 Jane 월수목 16:20-18:10")
    //   startsWith 매칭으로는 안 되므로 teacher_name 매칭으로 학생당 1건을 선택.
    //   attendance/메모 lookup key 는 `{student_id}|{share.class_name}` — DB 의 tier 기준.
    if (isEnglishTeacher && teacherShares.length > 0) {
      const normSchool = (s: string | undefined) =>
        (s || "")
          .trim()
          .replace(/초등학교$/, "초")
          .replace(/중학교$/, "중")
          .replace(/고등학교$/, "고");
      // 학생 id → Student 메타 lookup (이름/학교/학년 표시용)
      const studentById = new Map<string, Student>();
      for (const stu of allStudents) studentById.set(stu.id, stu);

      const teacherFullName = selectedTeacher.name;
      const teacherEng = selectedTeacher.englishName;
      // 이 선생님의 payment 만 미리 필터
      const teacherPayments = rawMonthPayments.filter((p) => {
        if (!p.payment_name) return false;
        const tn = p.teacher_name || "";
        return (
          (!!teacherFullName && tn.includes(teacherFullName)) ||
          (!!teacherEng && tn.includes(teacherEng))
        );
      });
      // share.student_id 를 키로 payment_name 매핑.
      // sh.student_id 가 Firebase / virtual 여부와 관계없이, studentById 로 메타를 얻어
      // 이름+학교 또는 studentCode 로 teacherPayments 에서 1건을 찾는다.
      const paymentNameByShareStudent = new Map<string, string>();
      for (const sh of teacherShares) {
        if (paymentNameByShareStudent.has(sh.student_id)) continue;
        const stu = studentById.get(sh.student_id);
        if (!stu) continue;
        const match = teacherPayments.find((p) => {
          if (p.student_code && stu.studentCode && stu.studentCode === p.student_code)
            return true;
          return (
            !!p.student_name &&
            p.student_name === stu.name &&
            normSchool(p.school) === normSchool(stu.school)
          );
        });
        if (match?.payment_name) {
          paymentNameByShareStudent.set(sh.student_id, match.payment_name);
        }
      }

      const engRows: Student[] = [];
      for (const sh of teacherShares) {
        const stu = studentById.get(sh.student_id);
        if (!stu) continue; // 매칭 안 되면 skip (보통 발생 안 함)
        const tierName = sh.class_name || "";
        // DB attendance/메모 key 는 tier 기반 유지 (sync 에서 그렇게 저장했으므로)
        const attendanceKey = tierName ? `${stu.id}|${tierName}` : stu.id;
        const rowData = studentDataMap.get(attendanceKey);
        // UI row id 는 DB 키 (`{student_id}|{tier}`) 와 일치시켜 단순화.
        // paymentName 은 학생 단위로 1개 (같은 선생님에게 여러 tier 수강은 드묾).
        const paymentName = paymentNameByShareStudent.get(sh.student_id);
        const rowId = attendanceKey;
        const groupLabel = paymentName || tierName || "미분류";

        // 표시 요일: 출석 날짜들에서 도출 (없으면 share.allocated_units 없을 때 빈 값)
        const attendanceDayLabels = new Set<string>();
        for (const dateKey of Object.keys(rowData?.attendance || {})) {
          const v = rowData?.attendance[dateKey] ?? 0;
          if (v <= 0) continue;
          const d = new Date(dateKey);
          if (!isNaN(d.getTime())) {
            attendanceDayLabels.add(["일","월","화","수","목","금","토"][d.getDay()]);
          }
        }

        // share 를 PaymentLite 로 변환 (termCountMap / paidAmountByStudent 가 _payments 사용 가능)
        const sharePaymentLite: PaymentLite = {
          id: sh.id,
          student_code: stu.studentCode || "",
          student_name: stu.name,
          school: stu.school,
          grade: stu.grade,
          billing_month: `${year}${String(month).padStart(2, "0")}`,
          payment_name: paymentName || tierName,
          charge_amount: sh.allocated_paid,
          discount_amount: Math.max(0, sh.allocated_charge - sh.allocated_paid),
          paid_amount: sh.allocated_paid,
          teacher_name: selectedTeacher.name,
          teacher_staff_id: sh.teacher_staff_id,
        };

        engRows.push({
          ...stu,
          id: rowId,
          group: groupLabel,
          days: Array.from(attendanceDayLabels).sort(),
          attendance: rowData?.attendance ?? {},
          memos: rowData?.memos ?? {},
          homework: rowData?.homework ?? {},
          cellColors: rowData?.cellColors ?? {},
          _payments: [sharePaymentLite],
        } as Student & { _payments: PaymentLite[] });
      }
      return engRows;
    }

    const rows: Student[] = [];
    for (const s of filteredStudents) {
      const studentPayments = findStudentPayments(s, monthPayments);
      const teacherPayments = studentPayments.filter((p) => {
        if (p.teacher_staff_id && p.teacher_staff_id === opts.teacherId) return true;
        const pt = p.teacher_name || "";
        if (!pt) return false;
        if (opts.teacherName && pt.includes(opts.teacherName)) return true;
        if (opts.teacherEnglishName && pt.includes(opts.teacherEnglishName))
          return true;
        return false;
      });

      // DB 에 저장된 이 학생의 class_name 집합 (시트 F열 tier 기반)
      const dbClassNames = new Set<string>();
      for (const key of studentDataMap.keys()) {
        if (key === s.id) dbClassNames.add("");
        else if (key.startsWith(s.id + "|")) dbClassNames.add(key.slice(s.id.length + 1));
      }
      const studentGroup = gradeToGroup(s.grade);

      // 수납의 추정 단가에 대응하는 tier(salary item name) 찾기.
      // 우선순위:
      //  0) 학생의 DB class_name 이 유일하면 무조건 그걸 사용 (시트 우선 원칙) —
      //     수납 단가와 시트 tier 단가가 다른 경우에도 시트를 따라감.
      //  1) 단가 매칭 후보 중 DB class_name 과 일치
      //  2) charge 금액을 DB tier 단가로 역산해서 시수 1~16 정수면 매칭
      //     (inferUnitPrice 가 "큰 단가 우선"이라 72000→36000 오매칭하는 문제 해결)
      //  3) 학생 group 과 일치
      //  4) 후보 첫 번째.
      const nonEmptyDbClassNames = [...dbClassNames].filter((c) => c);
      const inferTierForPrice = (
        price: number | null,
        chargeAmount?: number
      ): string | null => {
        // DB 에 이 학생 분반이 딱 1개면 모든 수납을 그리로 귀속
        if (nonEmptyDbClassNames.length === 1) return nonEmptyDbClassNames[0];

        // ★ DB 우선: 학생의 DB 분반들 중 salary item price 가 일치하는 것을 직접 탐색.
        //   salaryConfig.items 를 먼저 필터링하는 방식은 item 조회 실패 시 매칭 실패함 —
        //   dbClassName 기준으로 직접 lookup 해야 확실.
        if (nonEmptyDbClassNames.length > 0) {
          // 1) price(inferUnitPrice 결과) 와 DB tier 단가 직접 매칭
          if (price !== null) {
            for (const cn of nonEmptyDbClassNames) {
              const item = (salaryConfig.items || []).find((i) => i.name === cn);
              if (!item) continue;
              if (item.baseTuition === price || item.unitPrice === price) return cn;
            }
          }
          // 2) charge 를 DB tier 단가로 직접 역산.
          //    예) 72000원 = 24000(중등 3T) × 3 → 중등 3T.
          //    inferUnitPrice 는 단가 풀 전역에서 "큰 단가 우선"이라 36000 을
          //    먼저 고르지만, 이 학생의 DB tier 는 중등 3T 뿐이니 직접 역산으로
          //    정확히 귀속.
          if (chargeAmount !== undefined && chargeAmount > 0) {
            for (const cn of nonEmptyDbClassNames) {
              const item = (salaryConfig.items || []).find((i) => i.name === cn);
              if (!item) continue;
              for (const unit of [item.baseTuition, item.unitPrice]) {
                if (!unit || unit <= 0) continue;
                if (chargeAmount % unit !== 0) continue;
                const n = chargeAmount / unit;
                if (n >= 1 && n <= 16) return cn;
              }
            }
          }
          return null;
        }

        if (price === null) return null;
        // DB 정보 없는 경우 기존 fallback (candidates → group → first)
        const candidates = (salaryConfig.items || []).filter(
          (i) => i.baseTuition === price || i.unitPrice === price
        );
        if (candidates.length === 0) return null;
        const fromGroup = candidates.find((c) => c.group === studentGroup);
        if (fromGroup) return fromGroup.name;
        return candidates[0].name;
      };

      // 수납 엔진: tier(시트 F열) 를 그룹 키로 사용. 같은 tier 병합, 다른 tier 분리.
      // tier 추정 실패 시 price 또는 payment_name prefix 폴백.
      const byClass = new Map<
        string,
        {
          tierName: string | null;
          daySet: Set<string>;
          payments: typeof teacherPayments;
          label: string;
        }
      >();
      // DB 우선 원칙: 학생의 DB 분반이 있으면 그것만으로 byClass 를 초기화.
      // 이후 수납은 이 entry 중 하나에 배정만 함 — ghost tier(예: 중등특강2) 생성 금지.
      if (nonEmptyDbClassNames.length > 0) {
        for (const cn of nonEmptyDbClassNames) {
          byClass.set(cn, {
            tierName: cn,
            daySet: new Set<string>(),
            payments: [],
            label: cn,
          });
        }
      }

      for (const p of teacherPayments) {
        const charge = p.charge_amount || 0;
        const price = inferUnitPrice(charge);
        let classKey: string | null = null;

        if (nonEmptyDbClassNames.length > 0) {
          // DB 분반이 있으면 그 안에서만 선택 (price 매칭 → charge 역산 → 단일 분반)
          const inferred = inferTierForPrice(price, charge);
          if (inferred && byClass.has(inferred)) {
            classKey = inferred;
          } else if (nonEmptyDbClassNames.length === 1) {
            classKey = nonEmptyDbClassNames[0];
          }
          // price/charge 역산도 실패하고 분반도 여러 개면 이 수납은 drop (ghost 생성 방지)
        } else {
          // DB 분반 정보 없는 학생 — 기존 inferTier / price / payment_name 폴백 체인
          const tierName = inferTierForPrice(price, charge);
          classKey =
            tierName ||
            (price !== null ? `price:${price}` : paymentClassKey(p.payment_name || ""));
        }
        if (!classKey) continue;

        const entry = byClass.get(classKey) || {
          tierName: classKey.startsWith("price:") ? null : classKey,
          daySet: new Set<string>(),
          payments: [],
          label:
            classKey.startsWith("price:")
              ? (price !== null ? `${price.toLocaleString()}원 수업` : classKey)
              : classKey,
        };
        for (const d of extractPaymentDays(p.payment_name || "")) entry.daySet.add(d);
        entry.payments.push(p);
        byClass.set(classKey, entry);
      }

      // 분반이 없으면 수납·DB 모두 없는 학생 → 그대로 추가
      if (byClass.size === 0) {
        rows.push(s);
        continue;
      }

      // tier 기반 행 분할. class_name 이 DB 에 있는 그대로 rowKey 에 반영되어
      // 사용자가 어느 요일 셀을 클릭해도 그 행의 class_name 으로 저장됨.
      // 요일 필터 제거 — 각 분반은 DB 에서 자기 class_name 의 출석만 반환하므로
      // 다른 행에 중복 노출 없음. 수강일 외 보강도 시트 그대로 재현 가능.
      for (const [, entry] of byClass) {
        const tierName = entry.tierName || "";
        const rowKey = tierName ? `${s.id}|${tierName}` : s.id;
        const rowData = studentDataMap.get(rowKey);
        const paymentDays = Array.from(entry.daySet).sort();

        // displayDays 결정 우선순위:
        //  1) 이 행에 매핑된 수납의 요일 (entry.daySet) — 가장 정확
        //  2) 이 행의 실제 출석 기록에서 요일 도출 — 수납이 다른 행에 귀속된 경우
        //  3) 단일 분반이면 s.days fallback
        //  4) 빈 배열 (여러 분반 + 정보 없음)
        // s.days 를 병합하지 않는 이유: 분반 2+ 학생에서 subset 매칭이 수납을 다른 행으로 흡수.
        let displayDays: string[];
        if (paymentDays.length > 0) {
          displayDays = paymentDays;
        } else {
          const attendanceDayLabels = new Set<string>();
          for (const dateKey of Object.keys(rowData?.attendance || {})) {
            const v = rowData?.attendance[dateKey] ?? 0;
            if (v <= 0) continue;
            const d = new Date(dateKey);
            if (!isNaN(d.getTime())) {
              attendanceDayLabels.add(["일","월","화","수","목","금","토"][d.getDay()]);
            }
          }
          if (attendanceDayLabels.size > 0) {
            displayDays = Array.from(attendanceDayLabels).sort();
          } else if (byClass.size === 1) {
            displayDays = (s.days || []).slice().sort();
          } else {
            displayDays = [];
          }
        }
        rows.push({
          ...s,
          id: rowKey,
          group: entry.label,
          days: displayDays,
          attendance: rowData?.attendance ?? {},
          memos: rowData?.memos ?? {},
          homework: rowData?.homework ?? {},
          cellColors: rowData?.cellColors ?? {},
          // 이 행에 귀속된 수납 — inferTierForPrice 로 tier 기반 정확 매칭된 결과.
          // paidAmountByStudent / termCountMap 에서 filterPaymentsForRow 대신 이 필드를 사용.
          _payments: entry.payments,
        } as Student & { _payments: typeof entry.payments });
      }
    }
    return rows;
  }, [filteredStudents, monthPayments, selectedTeacher, knownUnitPrices, studentDataMap, salaryConfig, isEnglishTeacher, teacherShares, rawMonthPayments, allStudents, year, month]);

  /**
   * 급여 계산 범위 predicate.
   * - 월별 뷰: 달력 월(1일~말일). "3월 급여는 3월 1~31일 분만" 규칙.
   * - 세션별 뷰: 세션 정의 기간 전체(min ~ max). "26.03 세션 = 3/6~4/2" 규칙.
   * 두 뷰는 의도적으로 다른 값을 낸다 — 사용자가 명시적으로 선택한 집계 기준을 따른다.
   */
  const isDateInCurrentPeriod = useMemo(() => {
    const monthStr = `${year}-${String(month).padStart(2, "0")}`;
    // 세션 뷰: 선택된 세션 우선, 없으면 해당 월 세션, 그것도 없으면 달력 월 fallback
    if (viewMode === "session") {
      const s = selectedSession || sessionPeriods.find((sp) => sp.month === month);
      if (s) return (dateKey: string) => isDateInSession(dateKey, s);
    }
    // 월별 뷰(또는 세션 없음): 달력 월 prefix
    return (dateKey: string) => dateKey.startsWith(monthStr);
  }, [viewMode, selectedSession, sessionPeriods, year, month]);

  /**
   * 행(수강)별 수납 필터:
   *   1) 선생님 일치
   *   2) 수학이면 수납명에 요일 패턴이 있는 것만
   *   3) 수납명 요일 세트가 이 행 요일 세트의 부분집합
   * 조건 3): row.days 가 수납과 학생 enrollment 에서 병합되면 subset 이 과잉 매칭됨.
   * 이 문제는 studentRows 생성 시 displayDays 를 payment 기반으로만 구성해 해결.
   */
  const filterPaymentsForRow = (
    row: Student,
    payments: ReturnType<typeof findStudentPayments>,
    opts: {
      teacherId: string;
      teacherName?: string;
      teacherEnglishName?: string;
      isMathTeacher: boolean;
    }
  ) => filterPaymentsForTeacherRow(payments, { ...opts, rowDays: row.days });

  // 행별 등록차수: (이 수강에 해당하는 수납 합계) / (이 수강의 학생 단가)
  const termCountMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!selectedTeacher) return map;

    // 영어 강사: allocated_units 가 있으면 그대로 사용, 없으면 paid/unit_price.
    // virtual 학생이 allStudents 에 없어 findStudentPayments 매칭 실패하는 문제 회피.
    if (isEnglishTeacher && teacherShares.length > 0) {
      for (const sh of teacherShares) {
        const key = sh.class_name
          ? `${sh.student_id}|${sh.class_name}`
          : sh.student_id;
        let term = 0;
        if (typeof sh.allocated_units === "number" && sh.allocated_units > 0) {
          term = Math.round(sh.allocated_units);
        } else if (sh.unit_price && sh.unit_price > 0 && sh.allocated_paid > 0) {
          term = Math.round(sh.allocated_paid / sh.unit_price);
        }
        if (term > 0) map.set(key, (map.get(key) || 0) + term);
      }
      return map;
    }

    if (monthPayments.length === 0) return map;
    const opts = {
      teacherId: selectedTeacher.id,
      teacherName: selectedTeacher.name,
      teacherEnglishName: selectedTeacher.englishName,
      isMathTeacher: !!selectedTeacher.subjects?.some(
        (s) => s === "math" || s === "highmath"
      ),
    };

    for (const row of studentRows) {
      // tier 기반 정확 매칭된 수납 직접 사용 (studentRows 생성 시 byClass 로 이미 분류됨).
      // filterPaymentsForRow 의 요일 subset 매칭은 tier 다른 행에 같은 요일 수납을 중복 귀속시키는 버그가 있어 우회.
      const rowWithPayments = row as Student & { _payments?: PaymentLite[] };
      let filtered: PaymentLite[] | undefined = rowWithPayments._payments;
      if (!filtered) {
        // fallback: 레거시 row (분반 없는 단순 학생) — 기존 경로 유지
        const studentPayments = findStudentPayments(row, monthPayments);
        filtered = filterPaymentsForRow(row, studentPayments, opts);
      }
      if (!filtered || filtered.length === 0) continue;

      const totalCharge = filtered.reduce((s, p) => s + (p.charge_amount || 0), 0);
      if (totalCharge <= 0) continue;

      const setting = matchSalarySetting(
        row,
        salaryConfig,
        undefined,
        tierOverrides[row.id]
      );
      const unitPrice = setting?.unitPrice || 0;
      if (unitPrice <= 0) continue;

      const term = Math.round(totalCharge / unitPrice);
      if (term > 0) map.set(row.id, term);
    }
    return map;
  }, [studentRows, monthPayments, selectedTeacher, salaryConfig, tierOverrides, isEnglishTeacher, teacherShares]);

  const loading = staffLoading || studentsLoading || attendanceLoading;

  // 행(수강)별 이번 달 수납 합계 — 수강 요일 세트와 일치하는 수납만 집계
  const paidAmountByStudent = useMemo(() => {
    const map = new Map<string, number>();
    if (!selectedTeacher) return map;

    // 영어 강사: teacherShares 를 직접 row.id (`{studentId}|{className}`) 키로 매핑.
    // findStudentPayments 는 name/studentCode 매칭이라 virtual 학생 (Firebase 미등록)
    // 의 경우 allStudents 에 없어 student_name="" 로 변환되어 매칭 실패.
    // shares 는 이미 (studentId, className) 튜플을 가지고 있어 직접 키로 쓰면 정확.
    if (isEnglishTeacher && teacherShares.length > 0) {
      for (const sh of teacherShares) {
        const key = sh.class_name
          ? `${sh.student_id}|${sh.class_name}`
          : sh.student_id;
        const prev = map.get(key) || 0;
        map.set(key, prev + (sh.allocated_paid || 0));
      }
      return map;
    }

    if (monthPayments.length === 0) return map;
    const opts = {
      teacherId: selectedTeacher.id,
      teacherName: selectedTeacher.name,
      teacherEnglishName: selectedTeacher.englishName,
      isMathTeacher: !!selectedTeacher.subjects?.some(
        (s) => s === "math" || s === "highmath"
      ),
    };

    for (const row of studentRows) {
      // tier 기반 분류된 수납 직접 사용 (termCountMap 와 동일 로직)
      const rowWithPayments = row as Student & { _payments?: PaymentLite[] };
      let filtered: PaymentLite[] | undefined = rowWithPayments._payments;
      if (!filtered) {
        const studentPayments = findStudentPayments(row, monthPayments);
        filtered = filterPaymentsForRow(row, studentPayments, opts);
      }
      if (!filtered || filtered.length === 0) continue;
      const total = filtered.reduce((s, p) => s + (p.charge_amount || 0), 0);
      if (total > 0) map.set(row.id, total);
    }
    return map;
  }, [studentRows, monthPayments, selectedTeacher, isEnglishTeacher, teacherShares]);

  // 행별 유닛단가 오버라이드 (영어 payment_shares.unit_price).
  // 같은 tier 이름이어도 학년별로 단가가 다른 시트 대응 — e.g.
  // "중등브릿지" 초등=8000, 중등=12000 / "중등 2T" 중1=12000, 중2·3=12500.
  // studentRows.id = `${studentId}|${className}` 키 체계에 맞춤.
  const unitPriceByStudent = useMemo(() => {
    const map = new Map<string, number>();
    if (!isEnglishTeacher || teacherShares.length === 0) return map;
    for (const sh of teacherShares) {
      if (!sh.unit_price || sh.unit_price <= 0) continue;
      const key = sh.class_name
        ? `${sh.student_id}|${sh.class_name}`
        : sh.student_id;
      map.set(key, sh.unit_price);
    }
    return map;
  }, [isEnglishTeacher, teacherShares]);

  // 통계 — 행 단위로 집계해 합산 (학생 수는 고유 학생 기준)
  const stats = useMemo(
    () => calculateStats(
      studentRows,
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
      paidAmountByStudent,
      isDateInCurrentPeriod,
      unitPriceByStudent
    ),
    [studentRows, salaryConfig, year, month, selectedTeacherSalaryInfo, selectedSubject, selectedTeacher, blogPenalty, tierOverrides, paidAmountByStudent, isDateInCurrentPeriod, unitPriceByStudent]
  );

  /**
   * 학생별 실제 급여 계산 결과 맵.
   * 상단 "이번 달 급여"와 동일한 `calculateStudentSalary` 공식을 학생 단위로 분해한 값.
   * 합계 = stats.totalSalary (= 상단 이번 달 급여 − 인센티브).
   * 출석 셀의 "실급여" 컬럼과 합계행에 사용된다.
   */
  const actualSalaryByStudent = useMemo(() => {
    const map = new Map<string, number>();
    const subjectHint =
      selectedSubject === "english"
        ? "english"
        : selectedSubject === "math" || selectedSubject === "highmath"
        ? "math"
        : "other";

    for (const student of studentRows) {
      if (!student.attendance) continue;

      let classUnits = 0;
      for (const [dateKey, value] of Object.entries(student.attendance)) {
        // 세션 범위(없으면 달력 월) 필터
        if (!isDateInCurrentPeriod(dateKey) || value <= 0) continue;
        // 재원 외 날짜 + 출석 > 0 은 자동으로 "보강" 으로 간주해 급여 집계 포함.
        // 시트 "보강" 섹션 라벨 유무와 무관 — hours > 0 자체가 강사의 의도적 입력.
        if (
          isAttendanceCountable(
            dateKey,
            selectedTeacherSalaryInfo.type,
            selectedTeacherSalaryInfo.days
          )
        ) {
          classUnits += value;
        }
      }

      const settingItem = matchSalarySetting(
        student,
        salaryConfig,
        subjectHint,
        tierOverrides[student.id]
      );
      if (!settingItem) continue;
      const baseRatio = getEffectiveRatio(
        settingItem,
        salaryConfig,
        selectedTeacher?.name
      );
      const effective = { ...settingItem, ratio: baseRatio };
      // 수납액이 없으면 0으로 취급 — 수납 없이 급여 지급 불가
      const paid = paidAmountByStudent.get(student.id) ?? 0;
      const unitPriceOverride = unitPriceByStudent.get(student.id);
      const salary = calculateStudentSalary(
        effective,
        salaryConfig.academyFee,
        classUnits,
        paid,
        blogPenalty,
        unitPriceOverride
      );
      // 0도 맵에 기록해야 "수납 없음 → 실급여 0" 셀에 표시됨
      map.set(student.id, salary);
    }
    return map;
  }, [
    studentRows,
    salaryConfig,
    year,
    month,
    selectedTeacherSalaryInfo,
    selectedSubject,
    selectedTeacher,
    blogPenalty,
    tierOverrides,
    paidAmountByStudent,
    isDateInCurrentPeriod,
    unitPriceByStudent,
  ]);

  const finalSalary = useMemo(
    () =>
      calculateFinalSalary(stats.totalSalary, salaryConfig.incentives, settlement) +
      adminSalaryInfo.salary,
    [stats.totalSalary, salaryConfig.incentives, settlement, adminSalaryInfo.salary]
  );

  /**
   * 학생 분포 기반 비율 요약 (audit #5 — 시트 1~3행 미러링).
   *   각 학생의 매칭된 tier × 선생님 오버라이드 → effective ratio.
   *   같은 비율 학생을 모아 분포(주 비율, 범위, 툴팁) 표시.
   */
  const studentRatios = useMemo(() => {
    if (!selectedTeacher || studentRows.length === 0) return null;
    const counts = new Map<number, number>();
    const tiers = new Map<number, Set<string>>();
    for (const s of studentRows) {
      const setting = matchSalarySetting(
        s,
        salaryConfig,
        subjectToSalarySubject(selectedSubject),
        tierOverrides[s.id]
      );
      if (!setting) continue;
      const ratio = getEffectiveRatio(setting, salaryConfig, selectedTeacher.name);
      counts.set(ratio, (counts.get(ratio) || 0) + 1);
      if (!tiers.has(ratio)) tiers.set(ratio, new Set());
      tiers.get(ratio)!.add(setting.name);
    }
    if (counts.size === 0) return null;
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    const ratios = Array.from(counts.keys()).sort((a, b) => a - b);
    const tooltip = sorted
      .map(
        ([r, n]) =>
          `${r}% — ${n}명 (${Array.from(tiers.get(r) || []).join(", ")})`
      )
      .join("\n");
    return {
      dominantRatio: sorted[0][0],
      dominantCount: sorted[0][1],
      label:
        ratios.length === 1
          ? `${ratios[0]}%`
          : `${ratios[0]}~${ratios[ratios.length - 1]}%`,
      tooltip,
    };
  }, [studentRows, selectedTeacher, salaryConfig, tierOverrides, selectedSubject]);

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

  /**
   * 동기화 진행 중 페이지 이탈/리로드 방지.
   *   - beforeunload: 브라우저 새로고침/닫기/탭 이동 경고
   *   - 캡처 단계 click: 링크/네비 버튼 클릭 시 confirm 후 차단
   * 동기화 중 이동 시 비동기 fetch 가 버려져 부분 저장·tier 누락 발생하므로 방어.
   */
  useEffect(() => {
    if (!syncing) return;
    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const clickBlocker = (e: MouseEvent) => {
      const target = (e.target as HTMLElement | null)?.closest(
        'a[href], [data-nav-link]'
      ) as HTMLElement | null;
      if (!target) return;
      const href = target.getAttribute("href");
      // 현재 페이지 내 앵커/빈 링크는 통과
      if (!href || href.startsWith("#") || href === location.pathname) return;
      if (
        !confirm(
          "시트 동기화가 진행 중입니다. 지금 이동하면 일부 데이터가 저장되지 않을 수 있습니다. 계속하시겠습니까?"
        )
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", clickBlocker, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", clickBlocker, true);
    };
  }, [syncing]);

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
        salaryConfig,
        selectedTeacher.subjects?.[0]
      );
      setSyncResult(result);
      if (result.success) {
        await markSynced(selectedTeacherId);
        // 동기화 결과 반영: 출석/메모 + tier 오버라이드 + payment_shares +
        // virtual_students(=allStudents) 모두 재조회. F5 없이 UI 자동 갱신.
        await Promise.all([
          refetchAttendance(),
          refetchTierOverrides(),
          refetchShares(),
          refetchStudents(),
        ]);
      }
    } finally {
      setSyncing(false);
    }
  }, [syncing, selectedTeacherId, selectedTeacher, currentSheetUrl, year, month, allStudents, markSynced, refetchAttendance, salaryConfig, refetchTierOverrides, refetchShares, refetchStudents]);

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

  /**
   * studentRows 는 `{원본ID}|{className}` 형식의 rowKey 를 가짐 (분반 구분).
   * upsert/update 호출 시 rowKey 를 그대로 전달하여 DB 에 class_name 별 독립 저장.
   */
  const handleAttendanceChange = useCallback(
    (rowKey: string, dateKey: string, value: number | null) => {
      markEditing(rowKey, dateKey);
      upsertAttendance(rowKey, dateKey, value);
    },
    [upsertAttendance, markEditing]
  );

  const handleMemoChange = useCallback(
    (rowKey: string, dateKey: string, memo: string) => {
      markEditing(rowKey, dateKey);
      updateMemo(rowKey, dateKey, memo);
    },
    [updateMemo, markEditing]
  );

  const handleCellColorChange = useCallback(
    (rowKey: string, dateKey: string, color: string | null) => {
      markEditing(rowKey, dateKey);
      updateCellColor(rowKey, dateKey, color);
    },
    [updateCellColor, markEditing]
  );

  const handleHomeworkChange = useCallback(
    (rowKey: string, dateKey: string, done: boolean) => {
      markEditing(rowKey, dateKey);
      updateHomework(rowKey, dateKey, done);
    },
    [updateHomework, markEditing]
  );

  // archiveMode: 모든 mutation 핸들러를 no-op 으로 wrap (read-only 보장).
  // useCallback 으로 래핑해 reference 안정화 → AttendanceTable / StudentRow 의 React.memo 보호.
  const noopAttendance = useCallback(
    (_rk: string, _dk: string, _v: number | null) => {},
    []
  );
  const noopMemo = useCallback((_rk: string, _dk: string, _m: string) => {}, []);
  const noopCellColor = useCallback(
    (_rk: string, _dk: string, _c: string | null) => {},
    []
  );
  const noopHomework = useCallback(
    (_rk: string, _dk: string, _h: boolean) => {},
    []
  );
  const noopEditingCell = useCallback(
    (_rk: string, _dk: string, _e: boolean) => {},
    []
  );
  const onAttendanceChangeProp = archiveMode ? noopAttendance : handleAttendanceChange;
  const onMemoChangeProp = archiveMode ? noopMemo : handleMemoChange;
  const onCellColorChangeProp = archiveMode ? noopCellColor : handleCellColorChange;
  const onHomeworkChangeProp = archiveMode ? noopHomework : handleHomeworkChange;
  const setEditingCellProp = archiveMode ? noopEditingCell : setEditingCell;

  // ─── 출석부 엑셀 내보내기 ──────────────────────────
  //   현재 선택 선생님 + 월 의 학생별 출석 grid 를 .xlsx 로 다운로드.
  //   세션 모드면 세션 범위, 월별 모드면 월 전체 일자 사용.
  const handleExportAttendanceExcel = useCallback(async () => {
    if (!selectedTeacher || studentRows.length === 0) return;
    const exportDates =
      viewMode === "session" && selectedSession
        ? expandSessionDatesContiguous(selectedSession)
        : getDaysInMonth(year, month);

    const ym = `${year}년 ${String(month).padStart(2, "0")}월`;
    const teacherName = selectedTeacher.name;

    const dayLabels = ["일", "월", "화", "수", "목", "금", "토"];

    // 헤더: 고정 열 + 날짜 (예: 5/1(금))
    const fixedHeader = [
      "#",
      "이름",
      "학교",
      "학년",
      "반",
      "수업요일",
      "단가",
      "등록차수",
      "출석합계",
      ...exportDates.map((d) => {
        const m = d.getMonth() + 1;
        const dd = d.getDate();
        return `${m}/${dd}(${dayLabels[d.getDay()]})`;
      }),
    ];

    const rows: (string | number | null)[][] = [
      [`${teacherName} ${ym} 출석부`],
      [],
      fixedHeader,
    ];

    studentRows.forEach((s, i) => {
      const setting = matchSalarySetting(s, salaryConfig, undefined, tierOverrides[s.id]);
      const unitPrice = setting?.unitPrice || setting?.baseTuition || 0;
      const term = termCountMap?.get(s.id);
      const monthTotal = exportDates.reduce((sum, d) => {
        const v = s.attendance?.[formatDateKey(d)];
        return sum + (typeof v === "number" && v > 0 ? v : 0);
      }, 0);
      const cells = exportDates.map((d) => {
        const v = s.attendance?.[formatDateKey(d)];
        return typeof v === "number" ? v : "";
      });
      rows.push([
        i + 1,
        s.name,
        s.school || "",
        s.grade || "",
        s.group || "",
        (s.days || []).join(""),
        unitPrice,
        term ?? "",
        Math.round(monthTotal * 10) / 10,
        ...cells,
      ]);
    });

    const wb = await createWorkbook();
    await addSheet(wb, `${teacherName} ${ym}`, rows, { maxColWidth: 16 });
    await writeFile(
      wb,
      `출석부_${teacherName}_${year}-${String(month).padStart(2, "0")}.xlsx`
    );
  }, [
    selectedTeacher,
    studentRows,
    viewMode,
    selectedSession,
    year,
    month,
    salaryConfig,
    tierOverrides,
    termCountMap,
  ]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* 상단 1행: 통계 + 주요 네비게이션 */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3 pt-2 pb-1 bg-white dark:bg-zinc-900 flex-shrink-0 [&>*]:flex-shrink-0">
        {/* 급여 카드 — 급여제 선생님 본인에게는 "급여제"로 대체 표시 */}
        <button
          onClick={() => setSettlementOpen(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-sm bg-blue-50 text-blue-700 text-sm hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300"
        >
          <span>💰</span>
          <span className="font-semibold">이번 달 급여</span>
          {hideSalaryForFixed ? (
            <span className="rounded-sm bg-zinc-200 px-2 py-0.5 text-xs font-bold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
              {contractTypeLabel}
            </span>
          ) : (
            <span className="font-bold">{finalSalary.toLocaleString()}원</span>
          )}
        </button>

        {/* 행정급여 (설정 있는 선생님만) */}
        {adminSalaryInfo.salary > 0 && (
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-sm bg-amber-50 text-amber-800 text-sm dark:bg-amber-950 dark:text-amber-300"
            title={`${adminSalaryInfo.gross.toLocaleString()}원 × ${adminSalaryInfo.tierName} ${adminSalaryInfo.ratio}% × (1−${salaryConfig.academyFee}%)`}
          >
            <span>📋</span>
            <span className="font-semibold">행정급여</span>
            <span className="font-bold">+{adminSalaryInfo.salary.toLocaleString()}원</span>
          </div>
        )}

        {/* 학생 수 */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-sm bg-zinc-100 text-zinc-700 text-sm dark:bg-zinc-800 dark:text-zinc-300">
          <span className="font-semibold">학생</span>
          <span className="font-bold">{stats.studentCount}</span>
        </div>

        {/* 비율 분포 — 시트 1~3행 미러링 */}
        {studentRatios && (
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-sm bg-purple-50 text-purple-700 text-sm dark:bg-purple-950 dark:text-purple-300"
            title={studentRatios.tooltip}
          >
            <span className="font-semibold">비율</span>
            <span className="font-bold">{studentRatios.label}</span>
            <span className="text-xs opacity-70">
              (주 {studentRatios.dominantRatio}% · {studentRatios.dominantCount}명)
            </span>
          </div>
        )}

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

        {/* 선생님 선택 — 과목별 섹션 드롭다운 */}
        {visibleTeachers.length > 0 ? (
          <HomeroomPicker
            homerooms={visibleTeachers.map((t) => ({
              name: t.name,
              subject: (t.subjects ?? []).map(toSubjectLabel).join("/"),
              studentCount: teacherStudentCount.get(t.id) ?? 0,
            }))}
            selected={selectedTeacher?.name ?? ""}
            onChange={(name) => {
              const t = visibleTeachers.find((x) => x.name === name);
              if (t) setSelectedTeacherId(t.id);
            }}
            showAll={false}
            placeholder="선생님 선택"
          />
        ) : (
          <span className="rounded-sm border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800">
            선생님 없음
          </span>
        )}

        {/* 엑셀 내보내기 — 누구나 가능 */}
        <button
          onClick={handleExportAttendanceExcel}
          disabled={!selectedTeacher || studentRows.length === 0}
          className="rounded-sm border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          title="현재 보이는 출석부를 .xlsx 로 다운로드"
        >
          📥 엑셀
        </button>

        {/* 시트 동기화 (관리자 이상만 + 시트 등록된 선생님만, archiveMode 에서 hide) */}
        {!archiveMode && isAdmin && currentSheetUrl && (
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
          <input
            type="month"
            value={`${year}-${String(month).padStart(2, "0")}`}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              const [y, m] = v.split("-").map(Number);
              setYear(y);
              setMonth(m);
            }}
            className="rounded-sm border border-zinc-300 bg-white px-2 py-1.5 text-sm font-bold text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <button onClick={nextMonth} className="rounded-sm border border-zinc-300 px-2.5 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">▶</button>
        </div>
      </div>

      {/* 상단 2행: 표시 옵션 */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3 pb-2 pt-1 border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 flex-shrink-0 [&>*]:flex-shrink-0">
        {/* 보기 — 열 표시 / 화면 옵션 / 셀 크기 통합 팝오버 */}
        <ViewOptionsMenu
          showExpectedBilling={showExpectedBilling}
          setShowExpectedBilling={setShowExpectedBilling}
          showPaidAmount={showPaidAmount}
          setShowPaidAmount={setShowPaidAmount}
          showActualSalary={showActualSalary}
          setShowActualSalary={setShowActualSalary}
          actualSalaryDisabled={hideSalaryForFixed}
          actualSalaryDisabledReason={`${contractTypeLabel} — 본인에게는 실급여 표시가 숨겨집니다`}
          highlightWeekends={highlightWeekends}
          setHighlightWeekends={setHighlightWeekends}
          hideZeroAttendance={hideZeroAttendance}
          setHideZeroAttendance={setHideZeroAttendance}
          cellWidth={cellWidth}
          setCellWidth={handleCellWidthPreset}
          cellHeight={cellHeight}
          setCellHeight={setCellHeight}
        />

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

        {/* 학생 검색 — 이름/학교/학년 substring (대소문자 무시) */}
        <div className="relative ml-1">
          <input
            type="text"
            value={studentSearch}
            onChange={(e) => setStudentSearch(e.target.value)}
            placeholder="🔎 학생 검색 (이름/학교/학년)"
            className="rounded-sm border border-zinc-300 bg-white px-2.5 py-1.5 text-sm w-56 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          {studentSearch && (
            <button
              onClick={() => setStudentSearch("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm px-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
              title="검색어 지우기"
            >
              ✕
            </button>
          )}
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

        {/* 급여 비율/설정은 선생님 상세 페이지에서 편집 */}
      </div>

      {/* 동기화 결과 토스트 (archiveMode 에서 hide) */}
      {!archiveMode && syncResult && (
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
                  {m.tierProtected > 0 && (
                    <span
                      className="text-blue-600"
                      title="학생 상세 페이지에서 직접 추가한 분반 — 덮어쓰지 않음"
                    >
                      {" · 보호 "}{m.tierProtected}
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
          <div className="p-3">
            <SkeletonTable rows={15} cols={12} />
          </div>
        ) : !selectedTeacherId ? (
          <div className="flex items-center justify-center h-64 text-zinc-400 text-sm">
            선생님을 선택해주세요.
          </div>
        ) : isMobile ? (
          <MobileAttendanceView
            students={studentRows}
            year={year}
            month={month}
            overrideDates={
              viewMode === "session" && selectedSession
                ? expandSessionDatesContiguous(selectedSession)
                : undefined
            }
            holidayDateSet={holidayDateSet}
            holidayNameMap={holidayNameMap}
            onAttendanceChange={onAttendanceChangeProp}
            onMemoChange={onMemoChangeProp}
          />
        ) : (
          <AttendanceTable
            students={studentRows}
            year={year}
            month={month}
            subject={selectedSubject}
            salaryConfig={salaryConfig}
            tierOverrides={tierOverrides}
            highlightWeekends={highlightWeekends}
            showExpectedBilling={showExpectedBilling}
            showPaidAmount={showPaidAmount}
            showActualSalary={effectiveShowActualSalary}
            paidAmountByStudent={paidAmountByStudent}
            actualSalaryByStudent={actualSalaryByStudent}
            sortMode={sortMode}
            studentSearch={studentSearch}
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
            onAttendanceChange={onAttendanceChangeProp}
            onMemoChange={onMemoChangeProp}
            onCellColorChange={onCellColorChangeProp}
            onHomeworkChange={onHomeworkChangeProp}
            editingByPeers={editingByPeers}
            setEditingCell={setEditingCellProp}
            onShowBreakdown={setBreakdownStudentId}
            onAddTier={!archiveMode && isAdmin ? setTierAddStudentId : undefined}
            onColumnResize={handleColumnResize}
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
      <SessionSettingsModal
        isOpen={isSessionSettingsOpen}
        onClose={() => setSessionSettingsOpen(false)}
        year={year}
        subjects={subjects}
        initialSubject={selectedSubject}
      />
      {/* 정산 breakdown 모달 (audit #6) — 시트 N6 수식 단계별 시각화 */}
      <StudentBreakdownModal
        isOpen={!!breakdownStudentId}
        onClose={() => setBreakdownStudentId(null)}
        student={
          breakdownStudentId
            ? studentRows.find((s) => s.id === breakdownStudentId) || null
            : null
        }
        year={year}
        month={month}
        dates={
          viewMode === "session" && selectedSession
            ? expandSessionDatesContiguous(selectedSession)
            : getDaysInMonth(year, month)
        }
        subject={selectedSubject}
        salaryConfig={salaryConfig}
        tierOverrideId={
          breakdownStudentId ? tierOverrides[breakdownStudentId] : undefined
        }
        teacherName={selectedTeacher?.name}
        termCount={
          breakdownStudentId ? termCountMap.get(breakdownStudentId) : undefined
        }
        paidAmount={
          breakdownStudentId
            ? paidAmountByStudent.get(breakdownStudentId)
            : undefined
        }
        actualSalary={
          breakdownStudentId
            ? actualSalaryByStudent.get(breakdownStudentId)
            : undefined
        }
        blogPenalty={blogPenalty}
        unitPriceOverride={
          breakdownStudentId
            ? unitPriceByStudent.get(breakdownStudentId)
            : undefined
        }
      />
      {/* 메모 찾기/바꾸기 (Ctrl+H, audit E) */}
      <FindReplaceModal
        isOpen={isFindReplaceOpen}
        onClose={() => setFindReplaceOpen(false)}
        students={studentRows}
        dates={
          viewMode === "session" && selectedSession
            ? expandSessionDatesContiguous(selectedSession)
            : getDaysInMonth(year, month)
        }
        onMemoChange={onMemoChangeProp}
      />
      {/* 분반 quick-add 모달 — 출석부에서 학생 행 🔧 버튼으로 열림.
          현재 선생님(selectedTeacherId) 자동 prefill — 사용자는 분반 이름 + tier 만 선택. */}
      {tierAddStudentId && (
        <TierOverrideModal
          isOpen={true}
          onClose={() => setTierAddStudentId(null)}
          studentId={tierAddStudentId}
          studentName={
            studentRows.find((s) => (s.id || "").split("|")[0] === tierAddStudentId)
              ?.name
          }
          prefilledTeacherId={selectedTeacherId}
          onSaved={() => {
            // 출석부 화면 즉시 갱신 — student_tier_overrides 새로 로드
            refetchTierOverrides();
          }}
        />
      )}
    </div>
  );
}
