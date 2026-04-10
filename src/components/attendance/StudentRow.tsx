"use client";

import type { Student, SalaryConfig } from "@/types";
import { DAY_ORDER } from "@/types";
import { formatDateKey } from "@/lib/date";
import { matchSalarySetting, calculateClassRate, getBadgeStyle } from "@/lib/salary";
import { isDateValidForStudent, isNewInMonth, isLeavingInMonth } from "@/lib/studentFilter";

interface Props {
  student: Student;
  index: number;
  dates: Date[];
  year: number;
  month: number;
  salaryConfig: SalaryConfig;
  highlightWeekends: boolean;
  showExpectedBilling: boolean;
  showSettlement: boolean;
  cellWidthPx: number;
  cellHeightPx: number;
  onHideStudent?: (studentId: string) => void;
  onCellClick: (studentId: string, dateKey: string) => void;
  onCellRightClick: (e: React.MouseEvent, studentId: string, dateKey: string) => void;
}

export default function StudentRow({
  student,
  index,
  dates,
  year,
  month,
  salaryConfig,
  highlightWeekends,
  showExpectedBilling,
  showSettlement,
  cellWidthPx,
  cellHeightPx,
  onHideStudent,
  onCellClick,
  onCellRightClick,
}: Props) {
  const isNew = isNewInMonth(student, year, month);
  const isLeaving = isLeavingInMonth(student, year, month);
  const attendance = student.attendance || {};
  const memos = student.memos || {};
  const homework = student.homework || {};
  const cellColors = student.cellColors || {};
  const studentDays = student.days || [];

  // 급여 설정 매칭
  const settingItem = matchSalarySetting(student, salaryConfig);

  // 월 출석 합계
  const monthTotal = Object.values(attendance).reduce(
    (sum, v) => sum + (v > 0 ? v : 0),
    0
  );

  // 예정액: 수업 요일 × 단가
  const scheduledCount = dates.filter((d) => {
    const dayLabel = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
    return studentDays.includes(dayLabel);
  }).length;
  const unitPrice = settingItem ? (settingItem.unitPrice || settingItem.baseTuition) : 0;
  const expectedBilling = scheduledCount * unitPrice;

  // 정산액: 출석 × 단가
  const classRate = settingItem ? calculateClassRate(settingItem, salaryConfig.academyFee) : 0;
  const settlementAmount = monthTotal * classRate;

  // 학교+학년 포맷
  const schoolGrade = formatSchoolGrade(student.school, student.grade);

  // 수업 요일 정렬
  const sortedDays = [...studentDays].sort(
    (a, b) => DAY_ORDER.indexOf(a as typeof DAY_ORDER[number]) - DAY_ORDER.indexOf(b as typeof DAY_ORDER[number])
  );

  return (
    <tr className={`border-b border-zinc-300 ${index % 2 === 0 ? "bg-white" : "bg-zinc-50/50"} hover:bg-blue-50/50`}>
      {/* # */}
      <td
        onContextMenu={(e) => {
          if (!onHideStudent) return;
          e.preventDefault();
          if (confirm(`${student.name} 학생을 숨기시겠습니까?`)) {
            onHideStudent(student.id);
          }
        }}
        className="sticky left-0 z-10 bg-inherit w-8 px-1 py-1 text-center text-[13px] text-zinc-400 cursor-context-menu"
      >
        {index + 1}
      </td>

      {/* 이름 */}
      <td className="sticky left-[32px] z-10 bg-inherit w-[90px] px-2 py-1 text-sm font-medium text-zinc-900 whitespace-nowrap">
        <div className="flex items-center gap-1">
          <span>{student.name}</span>
          {isNew && (
            <span
              className="inline-flex items-center gap-0.5 rounded-sm bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-400 px-1.5 py-0.5 text-[11px] font-black text-amber-900 shadow-[0_0_8px_rgba(251,191,36,0.8)] animate-pulse ring-1 ring-amber-500"
              title={`신입 (${student.startDate})`}
            >
              ✨신입
            </span>
          )}
          {isLeaving && (
            <span
              className="inline-flex items-center rounded-sm bg-red-100 px-1 py-0 text-[11px] font-bold text-red-700"
              title={`퇴원 (${student.endDate})`}
            >
              퇴원
            </span>
          )}
        </div>
      </td>

      {/* 학교/학년 + 급여설정 뱃지 */}
      <td className="sticky left-[122px] z-10 bg-inherit w-[80px] px-1 py-1">
        <div className="text-[13px] text-zinc-500 leading-tight">{schoolGrade}</div>
        {settingItem && (
          <span
            className="inline-block mt-0.5 rounded px-1 py-0 text-[11px] font-medium border"
            style={getBadgeStyle(settingItem.color)}
          >
            {settingItem.name}
          </span>
        )}
      </td>

      {/* 요일 */}
      <td className="sticky left-[202px] z-10 bg-[#f8f9fa] w-[140px] px-1 py-1">
        <div className="flex flex-nowrap gap-0.5">
          {sortedDays.map((day) => (
            <span
              key={day}
              className={`inline-block rounded px-1 py-0 text-[11px] font-medium ${
                day === "토"
                  ? "bg-blue-100 text-blue-600"
                  : day === "일"
                  ? "bg-red-100 text-red-600"
                  : "bg-zinc-100 text-zinc-500"
              }`}
            >
              {day}
            </span>
          ))}
        </div>
      </td>

      {/* 예정액 */}
      {showExpectedBilling && (
        <td className="sticky left-[342px] z-10 bg-[#fefce8] w-[60px] px-1 py-1 text-right text-[12px] text-zinc-600">
          {expectedBilling > 0 ? expectedBilling.toLocaleString() : "-"}
        </td>
      )}

      {/* 정산액 */}
      {showSettlement && (
        <td className={`sticky ${showExpectedBilling ? "left-[402px]" : "left-[342px]"} z-10 bg-[#eff6ff] w-[60px] px-1 py-1 text-right text-[12px] text-zinc-600`}>
          {settlementAmount > 0 ? settlementAmount.toLocaleString() : "-"}
        </td>
      )}

      {/* 출석 합계 */}
      <td className={`sticky ${getStickyLeft(showExpectedBilling, showSettlement, "attendance")} z-10 bg-[#f0f4f8] w-[36px] px-1 py-1 text-center text-[13px] font-bold text-zinc-700`}>
        {monthTotal || "-"}
      </td>

      {/* 날짜별 셀 */}
      {dates.map((date, dateIdx) => {
        const dateKey = formatDateKey(date);
        const value = attendance[dateKey];
        const hasMemo = !!memos[dateKey];
        const homeworkDone = homework[dateKey];
        const cellColor = cellColors[dateKey];
        const dayIndex = date.getDay();
        const isSunday = dayIndex === 0;
        const isSaturday = dayIndex === 6;
        const dayLabel = ["일", "월", "화", "수", "목", "금", "토"][dayIndex];
        const isScheduledDay = studentDays.includes(dayLabel);
        const isToday =
          new Date().getFullYear() === date.getFullYear() &&
          new Date().getMonth() === date.getMonth() &&
          new Date().getDate() === date.getDate();

        // 재원 기간 유효성
        const isValid = isDateValidForStudent(dateKey, student);
        const prevDate = dates[dateIdx - 1];
        const nextDate = dates[dateIdx + 1];
        const prevKey = prevDate ? formatDateKey(prevDate) : "";
        const nextKey = nextDate ? formatDateKey(nextDate) : "";
        // 첫수업: 이번 달 입원 학생 / 현재 칸은 빗금(무효) / 바로 다음 칸이 startDate
        const isFirstClass = isNew && !isValid && nextKey === student.startDate;
        // 퇴원: 이번 달 퇴원 학생 / 현재 칸은 빗금(무효) / 바로 이전 칸이 endDate
        const isEndBoundary =
          isLeaving && !isValid && prevKey === student.endDate;

        // 배경색 결정
        let bgColor = "";
        let stripePattern = false;
        if (!isValid) {
          stripePattern = true;
        } else if (cellColor) {
          bgColor = cellColor;
        } else if (value === 0) {
          bgColor = "#ef4444"; // 결석: 빨강
        } else if (isScheduledDay && value === undefined) {
          bgColor = "#fed7aa"; // 수업일인데 미체크: 주황
        } else if (highlightWeekends && (isSunday || isSaturday)) {
          bgColor = "#d1d5db"; // 주말 회색
        }

        const stripeStyle = stripePattern
          ? {
              backgroundColor: "#e2e8f0",
              backgroundImage:
                "linear-gradient(45deg,#cbd5e1 25%,transparent 25%,transparent 50%,#cbd5e1 50%,#cbd5e1 75%,transparent 75%,transparent)",
              backgroundSize: "8px 8px",
            }
          : bgColor
          ? { backgroundColor: bgColor }
          : undefined;

        return (
          <td
            key={dateKey}
            onClick={() => isValid && onCellClick(student.id, dateKey)}
            onContextMenu={(e) => isValid && onCellRightClick(e, student.id, dateKey)}
            className={`relative text-center select-none border-r border-b border-zinc-300 transition-colors ${
              isValid ? "cursor-pointer hover:brightness-95" : "cursor-not-allowed"
            } ${isToday && isScheduledDay ? "ring-1 ring-inset ring-blue-400" : ""}`}
            style={{
              ...(stripeStyle || {}),
              width: cellWidthPx,
              minWidth: cellWidthPx,
              height: cellHeightPx,
            }}
          >
            {/* 첫수업 뱃지 */}
            {isFirstClass && (
              <span className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none overflow-hidden">
                <span className="rounded-sm border border-amber-500 bg-gradient-to-r from-amber-300 via-yellow-200 to-amber-300 px-0.5 text-[8px] font-black text-amber-900 shadow-[0_0_6px_rgba(251,191,36,0.9)] animate-pulse whitespace-nowrap tracking-[-0.05em] leading-tight">
                  첫수업
                </span>
              </span>
            )}
            {/* 퇴원 뱃지 */}
            {isEndBoundary && (
              <span className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                <span className="rounded-sm border border-gray-400 bg-gray-100 px-0.5 text-[10px] font-black text-gray-700 whitespace-nowrap">
                  퇴원
                </span>
              </span>
            )}

            {/* 출석값 (중앙) */}
            {isValid && value !== undefined && value !== null && (
              <span
                className={`absolute inset-0 flex items-center justify-center text-[14px] font-bold ${
                  value === 0 ? "text-white" : "text-zinc-800"
                }`}
              >
                {value}
              </span>
            )}

            {/* 숙제 완료 (우상) */}
            {isValid && homeworkDone && (
              <span className="absolute top-0 right-0.5 text-[10px] text-emerald-500 font-bold">
                ✓
              </span>
            )}

            {/* 메모 표시 (우상 삼각형) */}
            {isValid && hasMemo && (
              <span
                className="absolute top-0 right-0 w-0 h-0"
                style={{
                  borderLeft: "5px solid transparent",
                  borderTop: "5px solid rgba(239,68,68,0.7)",
                }}
              />
            )}
          </td>
        );
      })}
    </tr>
  );
}

function formatSchoolGrade(school?: string, grade?: string): string {
  if (!school && !grade) return "-";
  if (school && grade) return `${school} ${grade}`;
  return school || grade || "-";
}

function getStickyLeft(showExpected: boolean, showSettlement: boolean, col: "attendance"): string {
  let base = 342;
  if (showExpected) base += 60;
  if (showSettlement) base += 60;
  return `left-[${base}px]`;
}
