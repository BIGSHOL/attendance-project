"use client";

import { useMemo, useState, useEffect } from "react";
import type { Student } from "@/types";
import { formatDateKey, getDaysInMonth } from "@/lib/date";

interface Props {
  students: Student[];
  year: number;
  month: number;
  /** 세션 모드용 날짜 오버라이드 */
  overrideDates?: Date[];
  holidayDateSet?: Set<string>;
  holidayNameMap?: Map<string, string>;
  onAttendanceChange: (
    studentId: string,
    dateKey: string,
    value: number | null
  ) => void;
  onMemoChange: (studentId: string, dateKey: string, memo: string) => void;
}

/**
 * 모바일 출석 입력 뷰 (audit #15).
 *
 * 가로 30컬럼 그리드는 모바일에서 비현실적.
 *   → 학생 1명 선택 → 해당 학생의 한 달 일자 리스트.
 *   → 큰 터치 버튼 (1/0/공란).
 *   → 메모는 별도 input.
 *
 * 학생 간 이동: 상단 prev/next 버튼.
 */
export default function MobileAttendanceView({
  students,
  year,
  month,
  overrideDates,
  holidayDateSet,
  holidayNameMap,
  onAttendanceChange,
  onMemoChange,
}: Props) {
  const dates = useMemo(
    () =>
      overrideDates && overrideDates.length > 0
        ? overrideDates
        : getDaysInMonth(year, month),
    [overrideDates, year, month]
  );

  const [studentIdx, setStudentIdx] = useState(0);
  const [memoEditingKey, setMemoEditingKey] = useState<string | null>(null);

  // 학생 변경 시 인덱스 보정
  useEffect(() => {
    if (studentIdx >= students.length) {
      setStudentIdx(Math.max(0, students.length - 1));
    }
  }, [students.length, studentIdx]);

  if (students.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-zinc-400">
        표시할 학생이 없습니다.
      </div>
    );
  }

  const student = students[studentIdx];
  if (!student) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-zinc-400">
        학생을 선택하세요.
      </div>
    );
  }

  const attendance = student.attendance || {};
  const memos = student.memos || {};

  const monthTotal = dates.reduce((sum, d) => {
    const v = attendance[formatDateKey(d)];
    return sum + (typeof v === "number" && v > 0 ? v : 0);
  }, 0);

  const setValue = (dateKey: string, value: number | null) => {
    onAttendanceChange(student.id, dateKey, value);
  };

  const goPrev = () => setStudentIdx(Math.max(0, studentIdx - 1));
  const goNext = () => setStudentIdx(Math.min(students.length - 1, studentIdx + 1));

  return (
    <div className="flex h-full flex-col bg-zinc-50 dark:bg-zinc-950">
      {/* 학생 선택 헤더 — sticky */}
      <div className="sticky top-0 z-10 border-b border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={goPrev}
            disabled={studentIdx === 0}
            className="rounded-sm border border-zinc-300 px-3 py-2 text-base font-bold disabled:opacity-30 dark:border-zinc-700"
          >
            ◀
          </button>
          <select
            value={studentIdx}
            onChange={(e) => setStudentIdx(Number(e.target.value))}
            className="flex-1 rounded-sm border border-zinc-300 bg-white px-2 py-2 text-base font-bold text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          >
            {students.map((s, i) => (
              <option key={s.id} value={i}>
                {i + 1}. {s.name} {s.school ? `· ${s.school}` : ""}{" "}
                {s.grade || ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={goNext}
            disabled={studentIdx >= students.length - 1}
            className="rounded-sm border border-zinc-300 px-3 py-2 text-base font-bold disabled:opacity-30 dark:border-zinc-700"
          >
            ▶
          </button>
        </div>
        <div className="mt-1.5 flex items-center justify-between text-xs">
          <span className="text-zinc-500">
            {studentIdx + 1} / {students.length}명
          </span>
          <span className="text-zinc-700 dark:text-zinc-300">
            {year}년 {month}월 출석{" "}
            <span className="font-bold text-blue-600">
              {monthTotal.toFixed(1)}회
            </span>
          </span>
        </div>
      </div>

      {/* 일자별 카드 */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <ul className="space-y-1">
          {dates.map((d) => {
            const dateKey = formatDateKey(d);
            const dayIndex = d.getDay();
            const dayLabel = ["일", "월", "화", "수", "목", "금", "토"][
              dayIndex
            ];
            const value = attendance[dateKey];
            const memo = memos[dateKey];
            const holidayName = holidayDateSet?.has(dateKey)
              ? holidayNameMap?.get(dateKey)
              : undefined;
            const isMemoEdit = memoEditingKey === dateKey;
            const dateColor =
              dayIndex === 0 || holidayName
                ? "text-red-600"
                : dayIndex === 6
                  ? "text-blue-600"
                  : "text-zinc-700 dark:text-zinc-300";
            const valueDisplayCls =
              value === undefined || value === null
                ? "text-zinc-400"
                : value === 0
                  ? "text-rose-600"
                  : "text-emerald-600";

            return (
              <li
                key={dateKey}
                className="border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
              >
                {/* 메인 행 */}
                <div className="flex items-center gap-2 px-2 py-2">
                  {/* 날짜 */}
                  <div className={`w-12 flex-shrink-0 text-center ${dateColor}`}>
                    <div className="text-[11px]">{dayLabel}</div>
                    <div className="text-base font-bold">{d.getDate()}</div>
                  </div>

                  {/* 값 표시 */}
                  <div
                    className={`w-12 flex-shrink-0 text-center text-xl font-bold ${valueDisplayCls}`}
                  >
                    {value !== undefined && value !== null
                      ? Number.isInteger(value)
                        ? value
                        : value.toFixed(1)
                      : "—"}
                  </div>

                  {/* 버튼들 */}
                  <div className="flex flex-1 gap-1">
                    {[0, 0.5, 1, 1.5, 2].map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setValue(dateKey, v)}
                        className={`flex-1 rounded-sm border px-1 py-2.5 text-sm font-bold ${
                          value === v
                            ? "bg-blue-600 text-white border-blue-700"
                            : "border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setValue(dateKey, null)}
                      className="rounded-sm border border-zinc-300 bg-white px-2 py-2.5 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800"
                      title="비우기"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* 휴일 라벨 */}
                {holidayName && (
                  <div className="border-t border-zinc-100 bg-red-50 px-2 py-1 text-[11px] text-red-700 dark:border-zinc-800 dark:bg-red-950 dark:text-red-300">
                    🎉 {holidayName}
                  </div>
                )}

                {/* 메모 — 펼침/접힘 */}
                <div className="border-t border-zinc-100 px-2 py-1.5 dark:border-zinc-800">
                  {isMemoEdit ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        defaultValue={memo || ""}
                        autoFocus
                        onBlur={(e) => {
                          if (e.target.value !== (memo || "")) {
                            onMemoChange(student.id, dateKey, e.target.value);
                          }
                          setMemoEditingKey(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.currentTarget.blur();
                          } else if (e.key === "Escape") {
                            setMemoEditingKey(null);
                          }
                        }}
                        className="flex-1 rounded-sm border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800"
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setMemoEditingKey(dateKey)}
                      className="flex w-full items-center gap-1 text-left text-[11px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                    >
                      <span>📝</span>
                      <span className="flex-1 truncate">
                        {memo || (
                          <span className="text-zinc-300">메모 추가...</span>
                        )}
                      </span>
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
