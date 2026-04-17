"use client";

import { memo } from "react";
import type { Student, SalaryConfig } from "@/types";
import { DAY_ORDER } from "@/types";
import { formatDateKey } from "@/lib/date";
import { matchSalarySetting, calculateClassRate, getBadgeStyle } from "@/lib/salary";
import {
  isDateValidForStudent,
  isNewInMonth,
  isLeavingInMonth,
  findTransferFromOnDate,
  findTransferToToday,
  type TransferInfo,
} from "@/lib/studentFilter";

interface Props {
  student: Student;
  index: number;
  dates: Date[];
  year: number;
  month: number;
  salaryConfig: SalaryConfig;
  /** 시트 F열 동기화 결과 — salary_item_id */
  tierOverrideId?: string;
  highlightWeekends: boolean;
  showExpectedBilling: boolean;
  /** 이번 달 실질 납부액 컬럼 표시 */
  showPaidAmount: boolean;
  /** 실제 계산된 급여 컬럼 표시 (상단 이번 달 급여와 동일 공식) */
  showActualSalary: boolean;
  /** 이번 달 수납 합계 (없으면 undefined) */
  paidAmount?: number;
  /** 실급여 = calculateStudentSalary 결과 (없으면 undefined) */
  actualSalary?: number;
  /**
   * 같은 원본 학생의 "연속된 분반 행" 중 2번째+ 일 때 true.
   * 번호/이름 셀을 비워 시각적으로 병합된 것처럼 표시 (rowspan 대체).
   */
  hideIdentity?: boolean;
  cellWidthPx: number;
  cellHeightPx: number;
  holidayDateSet?: Set<string>;
  holidayNameMap?: Map<string, string>;
  /** 등록차수 — 해당 월 담임 청구액 ÷ 학생 단가 */
  termCount?: number;
  /** 과목별 단위: 영어=U(유닛), 그 외=T(타임) */
  unit?: "U" | "T";
  onHideStudent?: (studentId: string) => void;
  onCellClick: (studentId: string, dateKey: string) => void;
  onCellRightClick: (e: React.MouseEvent, studentId: string, dateKey: string) => void;
  /** 다른 사용자가 편집 중인 셀 정보 */
  editingByPeers?: Map<string, { email: string; name: string }>;
}

function StudentRowImpl({
  student,
  index,
  dates,
  year,
  month,
  salaryConfig,
  tierOverrideId,
  highlightWeekends,
  showExpectedBilling,
  showPaidAmount,
  showActualSalary,
  paidAmount,
  actualSalary,
  hideIdentity,
  cellWidthPx,
  cellHeightPx,
  holidayDateSet,
  holidayNameMap,
  termCount,
  unit = "T",
  onHideStudent,
  onCellClick,
  onCellRightClick,
  editingByPeers,
}: Props) {
  const isNew = isNewInMonth(student, year, month);
  const isLeaving = isLeavingInMonth(student, year, month);
  // 퇴원 경계에서 같은 과목의 다른 활성 반이 있으면 반이동으로 간주
  const transferToInfo: TransferInfo | null = isLeaving
    ? findTransferToToday(student)
    : null;
  const attendance = student.attendance || {};
  const memos = student.memos || {};
  const homework = student.homework || {};
  const cellColors = student.cellColors || {};
  const studentDays = student.days || [];

  // 급여 설정 매칭 (시트 F열 tier 오버라이드 최우선)
  const settingItem = matchSalarySetting(student, salaryConfig, undefined, tierOverrideId);

  // 월 출석 합계. 재원 외 날짜 + hours > 0 은 자동 보강으로 간주해 합계 포함.
  // (AttendancePage.actualSalaryByStudent / salary.calculateStats 와 일관)
  const monthTotal = dates.reduce((sum, d) => {
    const key = formatDateKey(d);
    const v = attendance[key];
    return sum + (v && v > 0 ? v : 0);
  }, 0);

  // 예정액: 수업 요일 × 단가
  const scheduledCount = dates.filter((d) => {
    const dayLabel = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
    return studentDays.includes(dayLabel);
  }).length;
  const unitPrice = settingItem ? (settingItem.unitPrice || settingItem.baseTuition) : 0;
  const expectedBilling = scheduledCount * unitPrice;

  // 정산액: 출석 × 단가 — 단, 등록차수(termCount) 이상 출석해도 차수만큼만 정산
  const classRate = settingItem ? calculateClassRate(settingItem, salaryConfig.academyFee) : 0;
  const billableUnits =
    typeof termCount === "number" && termCount > 0
      ? Math.min(monthTotal, termCount)
      : monthTotal;
  const settlementAmount = billableUnits * classRate;


  // 학교+학년 포맷
  const schoolGrade = formatSchoolGrade(student.school, student.grade);

  // 수업 요일 정렬
  const sortedDays = [...studentDays].sort(
    (a, b) => DAY_ORDER.indexOf(a as typeof DAY_ORDER[number]) - DAY_ORDER.indexOf(b as typeof DAY_ORDER[number])
  );

  return (
    <tr className={`border-b border-zinc-300 ${index % 2 === 0 ? "bg-white" : "bg-zinc-50"} hover:bg-blue-50`}>
      {/* # */}
      <td
        onContextMenu={(e) => {
          if (!onHideStudent) return;
          e.preventDefault();
          if (confirm(`${student.name} 학생을 숨기시겠습니까?`)) {
            onHideStudent(student.id);
          }
        }}
        style={{ width: 32, minWidth: 32, maxWidth: 32 }}
        className={`sticky left-0 z-10 bg-inherit px-1 py-1 text-center text-[13px] cursor-context-menu border-r border-zinc-200 dark:border-zinc-700 ${
          hideIdentity ? "text-transparent" : "text-zinc-400"
        }`}
      >
        {hideIdentity ? "" : index + 1}
      </td>

      {/* 이름 (같은 원본 학생의 연속 분반 행은 빈 칸 — rowspan 시각 효과) */}
      <td style={{ width: 120, minWidth: 120, maxWidth: 120 }} className="sticky left-[32px] z-10 bg-inherit px-2 py-1 text-sm font-medium text-zinc-900 whitespace-nowrap border-r border-zinc-200 dark:border-zinc-700">
        {hideIdentity && <span className="text-zinc-300">↳</span>}
        {!hideIdentity && (
          <div className="flex items-center gap-1">
            <span>{student.name}</span>
            {isNew && (
              <span
                className="inline-flex items-center gap-0.5 rounded-sm bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-400 px-1.5 py-0.5 text-[11px] font-black text-amber-900 shadow-[0_0_8px_rgba(251,191,36,0.8)] animate-pulse ring-1 ring-amber-500"
                title={`신입 (${student.startDate})`}
              >
                신입
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
        )}
      </td>

      {/* 학교/학년 + 급여설정 뱃지 */}
      <td style={{ width: 80, minWidth: 80, maxWidth: 80 }} className="sticky left-[152px] z-10 bg-inherit px-1 py-1 border-r border-zinc-200 dark:border-zinc-700">
        <div className="text-[13px] text-zinc-500 leading-tight">{schoolGrade}</div>
        {settingItem && (
          <span
            className="mt-0.5 block max-w-full truncate rounded px-1 py-0 text-[11px] font-semibold border"
            style={getBadgeStyle(settingItem.color)}
            title={
              `${settingItem.name}\n` +
              `청구 단가: ${unitPrice.toLocaleString()}원\n` +
              `1회당 선생님 몫: ${classRate.toLocaleString()}원` +
              (settingItem.type === "percentage"
                ? ` (비율 ${settingItem.ratio}%)`
                : " (고정급)")
            }
          >
            {settingItem.name}
          </span>
        )}
      </td>

      {/* 요일 */}
      <td className="bg-[#f8f9fa] w-[140px] px-1 py-1 border-r border-zinc-200 dark:border-zinc-700">
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
        <td className="bg-[#fefce8] w-[60px] px-1 py-1 text-right text-[12px] text-zinc-600 border-r border-zinc-200 dark:border-zinc-700">
          {expectedBilling > 0 ? expectedBilling.toLocaleString() : "-"}
        </td>
      )}

      {/* 수납액 — 이번 달 실제 납부 합계 (이 선생님·해당 과목 한정) */}
      {showPaidAmount && (
        <td className="bg-[#ecfeff] w-[70px] px-1 py-1 text-right text-[12px] text-zinc-600 border-r border-zinc-200 dark:border-zinc-700">
          {typeof paidAmount === "number" && paidAmount > 0
            ? paidAmount.toLocaleString()
            : "-"}
        </td>
      )}

      {/* 실급여 — 상단 '이번 달 급여'와 동일 공식. 수납 0 → 0 인 특수 케이스만 빨강 강조. */}
      {showActualSalary && (() => {
        const hasActual = typeof actualSalary === "number";
        const actual = hasActual ? (actualSalary as number) : 0;
        // 출석 > 0 인데 수납이 없어 실급여가 0 으로 처리된 경우만 빨강.
        // 등록/출석 불일치는 각 컬럼에서 이미 표시되므로 여기선 중복 강조하지 않음.
        const isZero = hasActual && actual === 0 && monthTotal > 0;
        const cellCls = isZero
          ? "bg-red-100 text-red-800 font-bold dark:bg-red-900/50 dark:text-red-200"
          : "bg-[#fef9c3] text-zinc-800";
        const tip = isZero
          ? "수납 없음 → 실급여 0"
          : "수납 캡 · 선생님 비율 · 블로그 패널티 반영";
        return (
          <td
            className={`${cellCls} w-[70px] px-1 py-1 text-right text-[12px] font-medium border-r border-zinc-200 dark:border-zinc-700`}
            title={tip}
          >
            {hasActual ? actual.toLocaleString() : "-"}
          </td>
        );
      })()}

      {/* 등록차수 (담임 청구액 ÷ 단가) — 출석보다 먼저 */}
      <td
        className="bg-[#faf5ff] w-[52px] px-1 py-1 text-center text-[13px] font-bold text-violet-700 border-r border-zinc-300 dark:border-zinc-600"
        title={termCount ? `등록차수 ${termCount.toFixed(1)}${unit}` : undefined}
      >
        {termCount ? `${termCount.toFixed(1)}${unit}` : "-"}
      </td>

      {/* 출석 합계 — 등록 대비 비교 색상 */}
      {(() => {
        const hasTerm = typeof termCount === "number" && termCount > 0;
        const isDeficit = hasTerm && monthTotal < termCount!;
        const isExcess = hasTerm && monthTotal > termCount!;
        const stateCls = isDeficit
          ? "bg-red-500 text-white border-2 border-red-700"
          : isExcess
          ? "bg-sky-400 text-white"
          : "bg-[#f0f4f8] text-zinc-700";
        return (
          <td
            className={`w-[52px] px-1 py-1 text-center text-[13px] font-bold border-r border-zinc-300 dark:border-zinc-600 ${stateCls}`}
            title={
              hasTerm
                ? `출석 ${monthTotal.toFixed(1)}${unit} / 등록 ${termCount!.toFixed(1)}${unit}`
                : undefined
            }
          >
            {monthTotal > 0 ? `${monthTotal.toFixed(1)}${unit}` : "-"}
          </td>
        );
      })()}

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
        // 공휴일 (실제 쉬는날만 — data.go.kr getHoliDeInfo)
        const holidayName = holidayDateSet?.has(dateKey) ? holidayNameMap?.get(dateKey) : undefined;
        const prevDate = dates[dateIdx - 1];
        const nextDate = dates[dateIdx + 1];
        const prevKey = prevDate ? formatDateKey(prevDate) : "";
        const nextKey = nextDate ? formatDateKey(nextDate) : "";
        // 첫수업: 이번 달 입원 학생 / 현재 칸은 빗금(무효) / 바로 다음 칸이 startDate
        const isFirstClass = isNew && !isValid && nextKey === student.startDate;
        // 퇴원: 이번 달 퇴원 학생 / 현재 칸은 빗금(무효) / 바로 이전 칸이 endDate
        const isEndBoundary =
          isLeaving && !isValid && prevKey === student.endDate;
        // 첫수업 경계에서 이전 반이 있으면 "반이동 (from)" 으로 표시
        const transferFromInfo: TransferInfo | null = isFirstClass
          ? findTransferFromOnDate(student, nextKey)
          : null;

        // 배경색 결정
        // 우선순위: 재원 외 > 커스텀색 > 결석(빨강) > 공휴일(연한 빨강, 수업 없음) >
        //          보강(수강일 외 출석, 연한 주황) > 수업일(주황) > 주말 회색
        let bgColor = "";
        let stripePattern = false;
        if (!isValid) {
          stripePattern = true;
        } else if (cellColor) {
          bgColor = cellColor;
        } else if (value === 0) {
          bgColor = "#ef4444"; // 결석: 빨강
        } else if (holidayName) {
          bgColor = "#fecaca"; // 공휴일: 연한 빨강 (수업 없음)
        } else if (value && value > 0 && !isScheduledDay) {
          bgColor = "#fde68a"; // 보강(수강일 외 출석): 연한 노랑으로 수강일과 구분
        } else if (isScheduledDay) {
          bgColor = "#fed7aa"; // 수업일: 주황 (출석 기입 여부와 상관없이 항상 표시)
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

        const peerEditor = editingByPeers?.get(`${student.id}|${dateKey}`);
        const cellTitle = [
          holidayName ? `🎉 ${holidayName}` : "",
          memos[dateKey] || "",
          peerEditor ? `✏️ ${peerEditor.name} 편집 중` : "",
        ]
          .filter(Boolean)
          .join(" | ");

        return (
          <td
            key={dateKey}
            title={cellTitle || undefined}
            onClick={() => isValid && onCellClick(student.id, dateKey)}
            onContextMenu={(e) => isValid && onCellRightClick(e, student.id, dateKey)}
            className={`relative text-center select-none border-r border-b border-zinc-300 transition-colors ${
              isValid ? "cursor-pointer hover:brightness-95" : "cursor-not-allowed"
            } ${
              peerEditor
                ? "ring-2 ring-inset ring-fuchsia-500 animate-pulse"
                : isToday && isScheduledDay
                ? "ring-1 ring-inset ring-blue-400"
                : ""
            }`}
            style={{
              ...(stripeStyle || {}),
              width: cellWidthPx,
              minWidth: cellWidthPx,
              height: cellHeightPx,
            }}
          >
            {/* 첫수업 / 반이동(from) 뱃지 */}
            {isFirstClass && (
              <span className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none overflow-hidden">
                {transferFromInfo ? (
                  <span
                    className="rounded-sm border border-violet-500 bg-violet-100 px-0.5 text-[8px] font-black text-violet-800 whitespace-nowrap tracking-[-0.05em] leading-tight animate-pulse"
                    title={`반이동: ${transferFromInfo.teacher ? transferFromInfo.teacher + " 선생님 " : ""}${transferFromInfo.className} → ${student.group}`}
                  >
                    반이동
                  </span>
                ) : (
                  <span className="rounded-sm border border-amber-500 bg-gradient-to-r from-amber-300 via-yellow-200 to-amber-300 px-0.5 text-[8px] font-black text-amber-900 shadow-[0_0_6px_rgba(251,191,36,0.9)] animate-pulse whitespace-nowrap tracking-[-0.05em] leading-tight">
                    첫수업
                  </span>
                )}
              </span>
            )}
            {/* 퇴원 / 반이동(to) 뱃지 */}
            {isEndBoundary && (
              <span className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none overflow-hidden">
                {transferToInfo ? (
                  <span
                    className="rounded-sm border border-violet-500 bg-violet-100 px-0.5 text-[8px] font-black text-violet-800 whitespace-nowrap tracking-[-0.05em] leading-tight animate-pulse"
                    title={`반이동: ${student.group} → ${transferToInfo.teacher ? transferToInfo.teacher + " 선생님 " : ""}${transferToInfo.className}`}
                  >
                    반이동
                  </span>
                ) : (
                  <span className="rounded-sm border border-gray-400 bg-gray-100 px-0.5 text-[10px] font-black text-gray-700 whitespace-nowrap">
                    퇴원
                  </span>
                )}
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

            {/* 메모 표시 (포스트잇 모서리 접힘 스타일) */}
            {isValid && hasMemo && (() => {
              const foldSize = Math.round(Math.sqrt((cellWidthPx * cellHeightPx) / 5));
              return (
                <span
                  className="absolute top-0 right-0 pointer-events-none"
                  style={{
                    width: foldSize,
                    height: foldSize,
                    background:
                      "linear-gradient(225deg, #fbbf24 0%, #f59e0b 48%, rgba(0,0,0,0.25) 50%, transparent 51%)",
                    filter: "drop-shadow(-0.5px 0.5px 1px rgba(0,0,0,0.25))",
                  }}
                />
              );
            })()}
          </td>
        );
      })}
    </tr>
  );
}

const StudentRow = memo(StudentRowImpl);
export default StudentRow;

function formatSchoolGrade(school?: string, grade?: string): string {
  if (!school && !grade) return "-";
  if (school && grade) return `${school} ${grade}`;
  return school || grade || "-";
}

