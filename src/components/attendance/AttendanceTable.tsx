"use client";

import { useState, useMemo, useCallback } from "react";
import type { Student, SalaryConfig } from "@/types";
import { DAY_LABELS } from "@/types";
import { formatDateKey, formatDateDisplay, getDaysInMonth } from "@/lib/date";
import StudentRow from "./StudentRow";
import GroupHeader from "./GroupHeader";
import ContextMenu from "./ContextMenu";

type SortMode = "class" | "name" | "day";

interface Props {
  students: Student[];
  year: number;
  month: number;
  salaryConfig: SalaryConfig;
  highlightWeekends: boolean;
  showExpectedBilling: boolean;
  showSettlement: boolean;
  sortMode: SortMode;
  cellWidthPx: number;
  cellHeightPx: number;
  hiddenDateSet: Set<string>;
  hiddenStudentSet: Set<string>;
  onHideDate: (dateKey: string) => void;
  onHideStudent: (studentId: string) => void;
  onAttendanceChange: (studentId: string, dateKey: string, value: number | null) => void;
  onMemoChange: (studentId: string, dateKey: string, memo: string) => void;
  onCellColorChange: (studentId: string, dateKey: string, color: string | null) => void;
  onHomeworkChange: (studentId: string, dateKey: string, done: boolean) => void;
}

export default function AttendanceTable({
  students,
  year,
  month,
  salaryConfig,
  highlightWeekends,
  showExpectedBilling,
  showSettlement,
  sortMode,
  cellWidthPx,
  cellHeightPx,
  hiddenDateSet,
  hiddenStudentSet,
  onHideDate,
  onHideStudent,
  onAttendanceChange,
  onMemoChange,
  onCellColorChange,
  onHomeworkChange,
}: Props) {
  const allDates = useMemo(() => getDaysInMonth(year, month), [year, month]);
  const dates = useMemo(
    () => allDates.filter((d) => !hiddenDateSet.has(formatDateKey(d))),
    [allDates, hiddenDateSet]
  );
  const dateInfos = useMemo(() => dates.map(formatDateDisplay), [dates]);

  // 숨긴 학생 필터링
  const visibleStudents = useMemo(
    () => students.filter((s) => !hiddenStudentSet.has(s.id)),
    [students, hiddenStudentSet]
  );

  // 그룹 접기 상태
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // 그룹 순서
  const [groupOrder, setGroupOrder] = useState<string[]>([]);
  // 컨텍스트 메뉴
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    studentId: string;
    dateKey: string;
  } | null>(null);

  // 그룹별 학생 정렬
  const { rows, groups } = useMemo(() => {
    if (sortMode === "name") {
      const sorted = [...visibleStudents].sort((a, b) => a.name.localeCompare(b.name, "ko"));
      return { rows: sorted, groups: [] as string[] };
    }

    // 수업별 그룹
    const groupMap = new Map<string, Student[]>();
    for (const s of visibleStudents) {
      const group = s.group || "미분류";
      if (!groupMap.has(group)) groupMap.set(group, []);
      groupMap.get(group)!.push(s);
    }

    // 그룹 순서 결정
    const allGroups = Array.from(groupMap.keys());
    const orderedGroups = [
      ...groupOrder.filter((g) => allGroups.includes(g)),
      ...allGroups.filter((g) => !groupOrder.includes(g)),
    ];

    return { rows: visibleStudents, groups: orderedGroups };
  }, [visibleStudents, sortMode, groupOrder]);

  const toggleCollapse = useCallback((group: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }, []);

  const moveGroup = useCallback(
    (group: string, direction: "up" | "down") => {
      setGroupOrder((prev) => {
        const allGroups = groups.length > 0 ? groups : Array.from(new Set(students.map((s) => s.group || "미분류")));
        const order = prev.length > 0 ? [...prev] : [...allGroups];
        const idx = order.indexOf(group);
        if (idx < 0) return prev;
        const swapIdx = direction === "up" ? idx - 1 : idx + 1;
        if (swapIdx < 0 || swapIdx >= order.length) return prev;
        [order[idx], order[swapIdx]] = [order[swapIdx], order[idx]];
        return order;
      });
    },
    [groups, students]
  );

  // 셀 클릭: 토글 (미체크 → 1 → 0 → 초기화)
  const handleCellClick = useCallback(
    (studentId: string, dateKey: string) => {
      const student = students.find((s) => s.id === studentId);
      const currentValue = student?.attendance?.[dateKey];

      if (currentValue === undefined || currentValue === null) {
        onAttendanceChange(studentId, dateKey, 1);
      } else if (currentValue > 0) {
        onAttendanceChange(studentId, dateKey, 0);
      } else {
        onAttendanceChange(studentId, dateKey, null);
      }
    },
    [students, onAttendanceChange]
  );

  // 우클릭: 컨텍스트 메뉴
  const handleCellRightClick = useCallback(
    (e: React.MouseEvent, studentId: string, dateKey: string) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, studentId, dateKey });
    },
    []
  );

  // 고정 컬럼 수 계산
  const fixedColCount = 4 + (showExpectedBilling ? 1 : 0) + (showSettlement ? 1 : 0) + 1; // #, 이름, 학교, 요일, [예정액], [정산액], 출석

  if (visibleStudents.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-zinc-400 text-sm">
        표시할 학생이 없습니다.
      </div>
    );
  }

  // 렌더링 행 구성
  const renderRows = () => {
    if (sortMode === "name" || sortMode === "day") {
      const DAY_ORDER_IDX = ["월", "화", "수", "목", "금", "토", "일"];
      const getFirstDayIdx = (s: Student): number => {
        if (!s.days || s.days.length === 0) return 999;
        const sorted = [...s.days].sort(
          (a, b) => DAY_ORDER_IDX.indexOf(a) - DAY_ORDER_IDX.indexOf(b)
        );
        return DAY_ORDER_IDX.indexOf(sorted[0]);
      };
      const sorted = [...visibleStudents].sort((a, b) => {
        if (sortMode === "day") {
          const diff = getFirstDayIdx(a) - getFirstDayIdx(b);
          if (diff !== 0) return diff;
        }
        return a.name.localeCompare(b.name, "ko");
      });
      return sorted.map((student, idx) => (
        <StudentRow
          key={student.id}
          student={student}
          index={idx}
          dates={dates}
          year={year}
          month={month}
          salaryConfig={salaryConfig}
          highlightWeekends={highlightWeekends}
          showExpectedBilling={showExpectedBilling}
          showSettlement={showSettlement}
          cellWidthPx={cellWidthPx}
          cellHeightPx={cellHeightPx}
          onHideStudent={onHideStudent}
          onCellClick={handleCellClick}
          onCellRightClick={handleCellRightClick}
        />
      ));
    }

    // 수업별 그룹
    const groupMap = new Map<string, Student[]>();
    for (const s of visibleStudents) {
      const group = s.group || "미분류";
      if (!groupMap.has(group)) groupMap.set(group, []);
      groupMap.get(group)!.push(s);
    }

    const allGroups = Array.from(groupMap.keys());
    const orderedGroups = [
      ...groupOrder.filter((g) => allGroups.includes(g)),
      ...allGroups.filter((g) => !groupOrder.includes(g)),
    ];

    const elements: React.ReactNode[] = [];
    let globalIdx = 0;

    for (const group of orderedGroups) {
      const groupStudents = groupMap.get(group) || [];
      const isCollapsed = collapsedGroups.has(group);

      elements.push(
        <GroupHeader
          key={`group-${group}`}
          groupName={group}
          studentCount={groupStudents.length}
          isCollapsed={isCollapsed}
          onToggleCollapse={() => toggleCollapse(group)}
          onMoveUp={() => moveGroup(group, "up")}
          onMoveDown={() => moveGroup(group, "down")}
          colSpan={fixedColCount + dates.length}
        />
      );

      if (!isCollapsed) {
        const sorted = [...groupStudents].sort((a, b) => a.name.localeCompare(b.name, "ko"));
        for (const student of sorted) {
          elements.push(
            <StudentRow
              key={student.id}
              student={student}
              index={globalIdx}
              dates={dates}
              year={year}
              month={month}
              salaryConfig={salaryConfig}
              highlightWeekends={highlightWeekends}
              showExpectedBilling={showExpectedBilling}
              showSettlement={showSettlement}
              cellWidthPx={cellWidthPx}
              cellHeightPx={cellHeightPx}
              onHideStudent={onHideStudent}
              onCellClick={handleCellClick}
              onCellRightClick={handleCellRightClick}
            />
          );
          globalIdx++;
        }
      } else {
        globalIdx += groupStudents.length;
      }
    }

    return elements;
  };

  const contextStudent = contextMenu ? students.find((s) => s.id === contextMenu.studentId) : null;

  return (
    <>
      <table className="text-sm border-collapse border-separate border-spacing-0 table-fixed">
        <thead className="sticky top-0 z-[30]">
          <tr className="bg-zinc-800 text-white shadow-md">
            <th className="sticky left-0 z-[40] bg-zinc-800 w-8 px-1 py-2 text-center text-[12px]">#</th>
            <th className="sticky left-[32px] z-[40] bg-zinc-800 w-[90px] px-2 py-2 text-left text-[12px]">이름</th>
            <th className="sticky left-[122px] z-[40] bg-zinc-800 w-[80px] px-1 py-2 text-left text-[12px]">학교</th>
            <th className="sticky left-[202px] z-[40] bg-zinc-800 w-[140px] px-1 py-2 text-center text-[12px]">요일</th>
            {showExpectedBilling && (
              <th className="sticky left-[342px] z-[40] bg-zinc-800 w-[60px] px-1 py-2 text-center text-[12px]">예정액</th>
            )}
            {showSettlement && (
              <th className={`sticky ${showExpectedBilling ? "left-[402px]" : "left-[342px]"} z-[40] bg-zinc-800 w-[60px] px-1 py-2 text-center text-[12px]`}>
                정산액
              </th>
            )}
            <th className={`sticky ${getAttendanceHeaderLeft(showExpectedBilling, showSettlement)} z-[40] bg-zinc-800 w-[36px] px-1 py-2 text-center text-[12px] border-r border-zinc-600`}>
              출석
            </th>
            {dateInfos.map((info, i) => {
              const dateKey = formatDateKey(dates[i]);
              return (
                <th
                  key={i}
                  style={{ width: cellWidthPx, minWidth: cellWidthPx }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (confirm(`${info.date}일 열을 숨기시겠습니까?`)) {
                      onHideDate(dateKey);
                    }
                  }}
                  className={`px-0 py-1 text-center cursor-context-menu border-r border-zinc-600 ${
                    info.isToday ? "bg-blue-600" : ""
                  }`}
                >
                  <div
                    className={`text-[11px] ${
                      info.isSunday
                        ? "text-red-300"
                        : info.isSaturday
                        ? "text-blue-300"
                        : "text-zinc-400"
                    }`}
                  >
                    {info.dayLabel}
                  </div>
                  <div className="text-[13px] font-bold">{info.date}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{renderRows()}</tbody>
      </table>

      {/* 컨텍스트 메뉴 */}
      {contextMenu && contextStudent && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          currentValue={contextStudent.attendance?.[contextMenu.dateKey]}
          currentMemo={contextStudent.memos?.[contextMenu.dateKey]}
          currentColor={contextStudent.cellColors?.[contextMenu.dateKey]}
          onSelectValue={(v) => onAttendanceChange(contextMenu.studentId, contextMenu.dateKey, v)}
          onSaveMemo={(m) => onMemoChange(contextMenu.studentId, contextMenu.dateKey, m)}
          onSelectColor={(c) => onCellColorChange(contextMenu.studentId, contextMenu.dateKey, c)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}

function getAttendanceHeaderLeft(showExpected: boolean, showSettlement: boolean): string {
  let base = 342;
  if (showExpected) base += 60;
  if (showSettlement) base += 60;
  return `left-[${base}px]`;
}
