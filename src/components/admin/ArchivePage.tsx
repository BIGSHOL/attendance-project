"use client";

import { useEffect, useMemo, useState } from "react";
import { useStudents } from "@/hooks/useStudents";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import type { Teacher } from "@/types";

interface AttendanceRow {
  id: string;
  teacher_id: string;
  student_id: string;
  class_name: string;
  date: string;
  hours: number;
  memo: string;
  cell_color?: string;
  homework?: boolean;
  is_makeup?: boolean;
}

/**
 * 보관함 메인 페이지.
 *
 * 좌측: 퇴사 선생님 목록 (Firebase staff.status !== "active")
 * 우측: 선택된 선생님의 월별 출석 기록 (Supabase attendance — read-only)
 *
 * 학생 이름 매칭은 useStudents() 결과(active + withdrawn)에서 lookup.
 * 매칭되지 않는 student_id 는 "(이름 미상)" + ID 일부로 표시.
 */
export default function ArchivePage() {
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useLocalStorage<number>("archive.year", now.getFullYear());
  const [month, setMonth] = useLocalStorage<number>(
    "archive.month",
    now.getMonth() + 1
  );
  const [selectedTeacherId, setSelectedTeacherId] = useLocalStorage<string>(
    "archive.teacherId",
    ""
  );

  const [archived, setArchived] = useState<Teacher[]>([]);
  const [archivedLoading, setArchivedLoading] = useState(true);
  const [archivedError, setArchivedError] = useState<string | null>(null);

  const [records, setRecords] = useState<AttendanceRow[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState<string | null>(null);

  const { students } = useStudents();

  // 퇴사 선생님 목록 fetch
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setArchivedLoading(true);
      setArchivedError(null);
      try {
        const res = await fetch("/api/staff/archived", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setArchived(Array.isArray(data) ? data : []);
        }
      } catch (e) {
        if (!cancelled) {
          setArchivedError(e instanceof Error ? e.message : "조회 실패");
        }
      } finally {
        if (!cancelled) setArchivedLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 출석 기록 fetch (선생님/년/월 변경 시)
  useEffect(() => {
    if (!selectedTeacherId) {
      setRecords([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setRecordsLoading(true);
      setRecordsError(null);
      try {
        const params = new URLSearchParams({
          teacher_id: selectedTeacherId,
          year: String(year),
          month: String(month),
        });
        const res = await fetch(`/api/attendance?${params}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setRecords(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!cancelled) {
          setRecordsError(e instanceof Error ? e.message : "로딩 실패");
          setRecords([]);
        }
      } finally {
        if (!cancelled) setRecordsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedTeacherId, year, month]);

  // student_id → 이름 lookup
  const studentNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of students) m.set(s.id, s.name);
    return m;
  }, [students]);

  const selectedTeacher = useMemo(
    () => archived.find((t) => t.id === selectedTeacherId),
    [archived, selectedTeacherId]
  );

  // 월별 합계
  const stats = useMemo(() => {
    const totalHours = records.reduce((sum, r) => sum + (Number(r.hours) || 0), 0);
    const studentSet = new Set(records.map((r) => r.student_id));
    const dateSet = new Set(records.map((r) => r.date));
    return {
      rowCount: records.length,
      studentCount: studentSet.size,
      dateCount: dateSet.size,
      totalHours,
    };
  }, [records]);

  // 정렬: 날짜 → 학생명
  const sortedRecords = useMemo(() => {
    const arr = [...records];
    arr.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      const an = studentNameById.get(a.student_id) || a.student_id;
      const bn = studentNameById.get(b.student_id) || b.student_id;
      return an.localeCompare(bn, "ko");
    });
    return arr;
  }, [records, studentNameById]);

  // 연도 옵션 (현재 년도 ~ -5년)
  const yearOptions = useMemo(() => {
    const arr: number[] = [];
    const curr = now.getFullYear();
    for (let y = curr; y >= curr - 5; y--) arr.push(y);
    return arr;
  }, [now]);

  return (
    <div className="space-y-3">
      {/* 안내 */}
      <div className="rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
        🗄 <strong>보관함</strong> — 퇴사 처리된 (status ≠ active) 선생님들의
        과거 출석 기록을 <strong>읽기 전용</strong>으로 조회합니다. Firebase
        에서 staff 의 status 를 다시 active 로 되돌리면 일반 출석부에 다시
        나타납니다.
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[280px_1fr]">
        {/* 좌측: 퇴사 선생님 목록 */}
        <aside className="space-y-2">
          <h3 className="text-xs font-bold text-zinc-700 dark:text-zinc-300">
            퇴사 선생님{" "}
            <span className="text-zinc-500">({archived.length}명)</span>
          </h3>
          {archivedLoading ? (
            <p className="text-xs text-zinc-500">로딩 중...</p>
          ) : archivedError ? (
            <p className="text-xs text-red-600">{archivedError}</p>
          ) : archived.length === 0 ? (
            <p className="text-xs text-zinc-500">
              퇴사 처리된 선생님이 없습니다.
            </p>
          ) : (
            <ul className="space-y-1">
              {archived.map((t) => {
                const isSelected = selectedTeacherId === t.id;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedTeacherId(t.id)}
                      className={`w-full rounded-sm border px-2 py-1.5 text-left text-xs transition ${
                        isSelected
                          ? "border-blue-500 bg-blue-50 text-blue-900 dark:border-blue-400 dark:bg-blue-950 dark:text-blue-100"
                          : "border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{t.name}</span>
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                            isSelected
                              ? "bg-blue-200 text-blue-800 dark:bg-blue-800 dark:text-blue-100"
                              : "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300"
                          }`}
                        >
                          {t.status || "(없음)"}
                        </span>
                      </div>
                      {t.subjects && t.subjects.length > 0 && (
                        <div className="mt-0.5 text-[10px] text-zinc-500">
                          {t.subjects.join(", ")}
                        </div>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* 우측: 선택된 선생님 데이터 */}
        <section className="space-y-3">
          {!selectedTeacher ? (
            <div className="rounded-sm border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
              {archived.length === 0
                ? "퇴사 처리된 선생님이 없습니다."
                : "좌측에서 선생님을 선택하세요."}
            </div>
          ) : (
            <>
              {/* 헤더 */}
              <div className="rounded-sm border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-bold">
                    {selectedTeacher.name}
                  </span>
                  <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-[11px] text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300">
                    status: {selectedTeacher.status || "(없음)"}
                  </span>
                  {selectedTeacher.role && (
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                      {selectedTeacher.role}
                    </span>
                  )}
                  {selectedTeacher.subjects &&
                    selectedTeacher.subjects.length > 0 && (
                      <span className="text-[11px] text-zinc-500">
                        {selectedTeacher.subjects.join(", ")}
                      </span>
                    )}
                  {selectedTeacher.email && (
                    <span className="text-[11px] text-zinc-500">
                      {selectedTeacher.email}
                    </span>
                  )}
                </div>
              </div>

              {/* 월/연도 selector */}
              <div className="flex flex-wrap items-center gap-3 rounded-sm border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
                <label className="text-xs">
                  연도:
                  <select
                    value={year}
                    onChange={(e) => setYear(Number(e.target.value))}
                    className="ml-1 rounded-sm border border-zinc-300 bg-white px-1.5 py-0.5 text-xs dark:border-zinc-600 dark:bg-zinc-800"
                  >
                    {yearOptions.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs">
                  월:
                  <select
                    value={month}
                    onChange={(e) => setMonth(Number(e.target.value))}
                    className="ml-1 rounded-sm border border-zinc-300 bg-white px-1.5 py-0.5 text-xs dark:border-zinc-600 dark:bg-zinc-800"
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <option key={m} value={m}>
                        {m}월
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* 합계 */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="기록 수" value={stats.rowCount} />
                <Stat label="학생 수" value={stats.studentCount} />
                <Stat label="출석 일수" value={stats.dateCount} />
                <Stat label="총 시수" value={stats.totalHours} />
              </div>

              {/* 표 */}
              <div className="overflow-auto border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
                {recordsLoading ? (
                  <div className="p-6 text-center text-sm text-zinc-500">
                    로딩 중...
                  </div>
                ) : recordsError ? (
                  <div className="p-6 text-center text-sm text-red-600">
                    {recordsError}
                  </div>
                ) : sortedRecords.length === 0 ? (
                  <div className="p-6 text-center text-sm text-zinc-500">
                    이 월에는 출석 기록이 없습니다.
                  </div>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 z-10 bg-zinc-100 text-left dark:bg-zinc-800">
                      <tr>
                        <th className="px-2 py-1.5 font-semibold">날짜</th>
                        <th className="px-2 py-1.5 font-semibold">학생</th>
                        <th className="px-2 py-1.5 font-semibold">분반</th>
                        <th className="px-2 py-1.5 text-right font-semibold">
                          시수
                        </th>
                        <th className="px-2 py-1.5 font-semibold">메모</th>
                        <th className="px-2 py-1.5 text-center font-semibold">
                          숙제
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRecords.map((r) => {
                        const sName = studentNameById.get(r.student_id);
                        return (
                          <tr
                            key={r.id}
                            className="border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
                          >
                            <td className="whitespace-nowrap px-2 py-1 font-mono text-[11px]">
                              {r.date}
                            </td>
                            <td className="px-2 py-1">
                              {sName || (
                                <span className="text-zinc-400">
                                  (이름 미상){" "}
                                  <code className="text-[10px]">
                                    {r.student_id.slice(0, 8)}
                                  </code>
                                </span>
                              )}
                            </td>
                            <td className="px-2 py-1 text-zinc-600 dark:text-zinc-400">
                              {r.class_name || "-"}
                            </td>
                            <td className="whitespace-nowrap px-2 py-1 text-right font-mono">
                              {r.hours ?? 0}
                            </td>
                            <td className="px-2 py-1">{r.memo || ""}</td>
                            <td className="px-2 py-1 text-center">
                              {r.homework ? "✓" : ""}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-sm border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
        {value.toLocaleString()}
      </div>
    </div>
  );
}
