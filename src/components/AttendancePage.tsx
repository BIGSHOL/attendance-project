"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useStaff } from "@/hooks/useStaff";
import { useStudents } from "@/hooks/useStudents";
import { useAttendanceData } from "@/hooks/useAttendanceData";
import { useHiddenTeachers } from "@/hooks/useHiddenTeachers";
import { useUserRole } from "@/hooks/useUserRole";
import { useAllUserRoles } from "@/hooks/useAllUserRoles";
import { INITIAL_SALARY_CONFIG, INITIAL_SETTLEMENT } from "@/types";
import type { SalaryConfig, MonthlySettlement, Student, Teacher } from "@/types";
import { calculateStats, calculateFinalSalary } from "@/lib/salary";
import { filterStudentsByMonth, isNewInMonth, isLeavingInMonth } from "@/lib/studentFilter";
import { extractDaysForTeacher } from "@/lib/enrollmentDays";
import { toSubjectLabel } from "@/lib/labelMap";
import { CELL_SIZE_OPTIONS, CELL_WIDTH, CELL_HEIGHT, type CellSize } from "@/lib/cellSize";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useHiddenCells } from "@/hooks/useHiddenCells";
import AttendanceTable from "./attendance/AttendanceTable";
import SettlementModal from "./attendance/SettlementModal";
import SalarySettingsModal from "./attendance/SalarySettingsModal";

type SortMode = "class" | "name" | "day";

export default function AttendancePage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [selectedSubject, setSelectedSubject] = useState<string>("math");
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>("");

  // 표시 옵션
  const [sortMode, setSortMode] = useState<SortMode>("class");
  const [highlightWeekends, setHighlightWeekends] = useState(false);
  const [showExpectedBilling, setShowExpectedBilling] = useState(false);
  const [showSettlement, setShowSettlement] = useState(false);

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

  // 급여 설정
  const [salaryConfig, setSalaryConfig] = useState<SalaryConfig>(INITIAL_SALARY_CONFIG);
  const [settlement, setSettlement] = useState<MonthlySettlement>(INITIAL_SETTLEMENT);

  // 데이터
  const { teachers, loading: staffLoading } = useStaff();
  const { students: allStudents, loading: studentsLoading } = useStudents();
  const { hiddenTeacherIds } = useHiddenTeachers();
  const { userRole, isAdmin, isTeacher } = useUserRole();
  const { users: userRoles } = useAllUserRoles();

  // 선택된 선생님의 급여 유형
  const selectedTeacherSalaryInfo = useMemo(() => {
    const u = userRoles.find((ur) => ur.role === "teacher" && ur.staff_id === selectedTeacherId);
    return {
      type: u?.salary_type || "commission" as const,
      days: u?.commission_days || [],
    };
  }, [userRoles, selectedTeacherId]);

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
  const teacherStudentCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of teachers) {
      const count = allStudents.filter((s) =>
        s.enrollments?.some((e) => isTeacherMatch(e, t))
      ).length;
      map.set(t.id, count);
    }
    return map;
  }, [teachers, allStudents, isTeacherMatch]);

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

  // Supabase 출석 데이터
  const {
    studentDataMap,
    loading: attendanceLoading,
    upsertAttendance,
    updateMemo,
    updateCellColor,
    updateHomework,
  } = useAttendanceData(selectedTeacherId, year, month);

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

    const dataMap = studentDataMap();

    return filtered.map((s): Student => {
      const supaData = dataMap.get(s.id);
      // 선택된 선생님 담당 enrollment의 className 사용
      const teacherEnrollment = s.enrollments?.find((e) => isTeacherMatch(e, selectedTeacher));
      // 해당 선생님 수업의 요일만 추출 (schedule "월 1" → "월")
      const days = extractDaysForTeacher(s.enrollments, (e) => isTeacherMatch(e, selectedTeacher));

      return {
        ...s,
        group: teacherEnrollment?.className || s.group || "미분류",
        days,
        attendance: supaData?.attendance ?? s.attendance ?? {},
        memos: supaData?.memos ?? s.memos ?? {},
        homework: supaData?.homework ?? s.homework ?? {},
        cellColors: supaData?.cellColors ?? s.cellColors ?? {},
      };
    });
  }, [allStudents, selectedTeacherId, selectedTeacher, isTeacherMatch, studentDataMap, year, month]);

  const loading = staffLoading || studentsLoading || attendanceLoading;

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
      selectedTeacher?.name
    ),
    [filteredStudents, salaryConfig, year, month, selectedTeacherSalaryInfo, selectedSubject, selectedTeacher]
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

  // 월 이동
  const prevMonth = () => {
    if (month === 1) { setYear(year - 1); setMonth(12); }
    else setMonth(month - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setYear(year + 1); setMonth(1); }
    else setMonth(month + 1);
  };

  // Supabase 연동 핸들러
  const handleAttendanceChange = useCallback(
    (studentId: string, dateKey: string, value: number | null) => {
      upsertAttendance(studentId, dateKey, value);
    },
    [upsertAttendance]
  );

  const handleMemoChange = useCallback(
    (studentId: string, dateKey: string, memo: string) => {
      updateMemo(studentId, dateKey, memo);
    },
    [updateMemo]
  );

  const handleCellColorChange = useCallback(
    (studentId: string, dateKey: string, color: string | null) => {
      updateCellColor(studentId, dateKey, color);
    },
    [updateCellColor]
  );

  const handleHomeworkChange = useCallback(
    (studentId: string, dateKey: string, done: boolean) => {
      updateHomework(studentId, dateKey, done);
    },
    [updateHomework]
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* 상단 통계 + 컨트롤 바 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 overflow-x-auto flex-shrink-0">
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

        {/* 신입 */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-sm bg-blue-50 text-blue-700 text-sm dark:bg-blue-950 dark:text-blue-300">
          <span className="font-semibold">신입</span>
          <span className="font-bold">+{newCount}</span>
        </div>

        {/* 퇴원 */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-sm bg-red-50 text-red-700 text-sm dark:bg-red-950 dark:text-red-300">
          <span className="font-semibold">퇴원</span>
          <span className="font-bold">-{leavingCount}</span>
        </div>

        {/* 토글 */}
        <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 cursor-pointer ml-2 dark:text-zinc-300">
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

        <div className="flex-1" />

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

        {/* 설정 */}
        <button
          onClick={() => setSalarySettingsOpen(true)}
          className="rounded-sm border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          ⚙ 설정
        </button>

        {/* 월 이동 */}
        <div className="flex items-center gap-1">
          <button onClick={prevMonth} className="rounded-sm border border-zinc-300 px-2.5 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">◀</button>
          <span className="px-3 py-1.5 text-sm font-bold text-zinc-900 dark:text-zinc-100 min-w-[90px] text-center">
            {year}년 {month}월
          </span>
          <button onClick={nextMonth} className="rounded-sm border border-zinc-300 px-2.5 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">▶</button>
        </div>
      </div>

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
            salaryConfig={salaryConfig}
            highlightWeekends={highlightWeekends}
            showExpectedBilling={showExpectedBilling}
            showSettlement={showSettlement}
            sortMode={sortMode}
            cellWidthPx={cellWidthPx}
            cellHeightPx={cellHeightPx}
            hiddenDateSet={hiddenDateSet}
            hiddenStudentSet={hiddenStudentSet}
            onHideDate={hideDate}
            onHideStudent={hideStudent}
            onAttendanceChange={handleAttendanceChange}
            onMemoChange={handleMemoChange}
            onCellColorChange={handleCellColorChange}
            onHomeworkChange={handleHomeworkChange}
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
        onSave={setSalaryConfig}
      />
    </div>
  );
}
