"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useNoteInspections } from "@/hooks/useNoteInspections";
import type {
  NoteInspection,
  NoteInspectionStatus,
  Student,
  Teacher,
} from "@/types";
import { NOTE_INSPECTION_STATUS_LABEL } from "@/types";
import NoteInspectionModal from "./NoteInspectionModal";

/**
 * 노트 검사 V1 — V1 상담 현황과 동일한 구조.
 *   - KPI 카드 + 담임별 요약 + 좌측 일자별 + 우측 학생 매트릭스
 *   - V2 와 달리 컴팩트 테이블 기반. 모달로 입력·편집.
 */

function formatDateKorean(date: string): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) return date;
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${String(d.getFullYear()).slice(2)}.${mm}.${dd} (${days[d.getDay()]})`;
}

function daysInMonth(yyyyMM: string): string[] {
  const [year, month] = yyyyMM.split("-").map(Number);
  const last = new Date(year, month, 0).getDate();
  const result: string[] = [];
  for (let d = 1; d <= last; d++) {
    result.push(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  return result;
}

const STATUS_BADGE: Record<NoteInspectionStatus, string> = {
  A: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  B: "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300",
  C: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  F: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300",
};

interface Props {
  month: string;
  monthLabel: string;
  teachers: Teacher[];
  studentsByHomeroom: Map<string, Student[]>;
  selectedHomeroom: string;
  loading: boolean;
  isAllView: boolean;
}

export default function NotesPageV1({
  month,
  monthLabel,
  studentsByHomeroom,
  selectedHomeroom,
  loading: outerLoading,
  isAllView,
}: Props) {
  const {
    inspections,
    loading: insLoading,
    error,
    create,
    update,
    remove,
  } = useNoteInspections(month);
  const loading = outerLoading || insLoading;

  const [modalOpen, setModalOpen] = useState<{
    student: Student;
    existing: NoteInspection | null;
  } | null>(null);

  // scoped 학생
  const scopedStudents = useMemo(() => {
    if (isAllView) {
      const seen = new Set<string>();
      const out: Student[] = [];
      for (const list of studentsByHomeroom.values()) {
        for (const s of list) {
          if (!seen.has(s.id)) {
            seen.add(s.id);
            out.push(s);
          }
        }
      }
      return out;
    }
    return studentsByHomeroom.get(selectedHomeroom) || [];
  }, [isAllView, selectedHomeroom, studentsByHomeroom]);

  // 담임별 학생 ID → 담임 목록
  const teachersByStudent = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const [name, list] of studentsByHomeroom.entries()) {
      for (const s of list) {
        if (!m.has(s.id)) m.set(s.id, []);
        m.get(s.id)!.push(name);
      }
    }
    return m;
  }, [studentsByHomeroom]);

  // scoped 상담 — 특정 선생님 뷰면 담당 학생 + 해당 선생님 본인 기록만
  const scopedInspections = useMemo(() => {
    const scopedIds = new Set(scopedStudents.map((s) => s.id));
    if (isAllView) {
      return inspections.filter((i) => scopedIds.has(i.studentId));
    }
    return inspections.filter(
      (i) => scopedIds.has(i.studentId) && i.teacherName === selectedHomeroom
    );
  }, [inspections, scopedStudents, isAllView, selectedHomeroom]);

  // 학생별 검사 집계
  const statsByStudent = useMemo(() => {
    const m = new Map<string, { dates: string[]; lastDate: string | null; total: number; latest: NoteInspection | null }>();
    for (const s of scopedStudents) {
      m.set(s.id, { dates: [], lastDate: null, total: 0, latest: null });
    }
    for (const ins of scopedInspections) {
      const b = m.get(ins.studentId);
      if (!b) continue;
      b.dates.push(ins.date);
      b.total += 1;
      if (!b.lastDate || ins.date > b.lastDate) {
        b.lastDate = ins.date;
        b.latest = ins;
      }
    }
    for (const b of m.values()) b.dates.sort();
    return m;
  }, [scopedStudents, scopedInspections]);

  // 일자별 집계
  const countByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const ins of scopedInspections) {
      m.set(ins.date, (m.get(ins.date) ?? 0) + 1);
    }
    return m;
  }, [scopedInspections]);

  // 학생 정렬: 검사됨(최근순) 먼저, 미검사(이름순) 뒤
  const sortedStudents = useMemo(() => {
    return [...scopedStudents].sort((a, b) => {
      const ba = statsByStudent.get(a.id);
      const bb = statsByStudent.get(b.id);
      const ta = ba?.total ?? 0;
      const tb = bb?.total ?? 0;
      if (ta > 0 && tb === 0) return -1;
      if (ta === 0 && tb > 0) return 1;
      if (ta > 0 && tb > 0) {
        const la = ba?.lastDate ?? "";
        const lb = bb?.lastDate ?? "";
        if (la !== lb) return lb.localeCompare(la);
      }
      return a.name.localeCompare(b.name);
    });
  }, [scopedStudents, statsByStudent]);

  const totalInspections = scopedInspections.length;
  const inspectedIds = new Set(scopedInspections.map((i) => i.studentId));
  const uninspectedCount = scopedStudents.length - inspectedIds.size;
  const cGradeCount = scopedInspections.filter((i) => i.status === "C").length;
  const fGradeCount = scopedInspections.filter((i) => i.status === "F").length;

  const monthDays = daysInMonth(month);

  // 학생 이름 검색 + 페이지네이션 (페이지 크기 = 월 일수, V1 상담과 동일)
  const [studentSearch, setStudentSearch] = useLocalStorage<string>(
    "notes.v1.studentSearch",
    ""
  );
  const searchedStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    if (!q) return sortedStudents;
    return sortedStudents.filter(
      (s) =>
        (s.name || "").toLowerCase().includes(q) ||
        (s.school || "").toLowerCase().includes(q) ||
        (s.grade || "").toLowerCase().includes(q)
    );
  }, [sortedStudents, studentSearch]);

  const pageSize = monthDays.length;
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(searchedStudents.length / pageSize));
  useEffect(() => {
    setPage(1);
  }, [selectedHomeroom, studentSearch, month]);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);
  const pagedStudents = useMemo(
    () => searchedStudents.slice((page - 1) * pageSize, page * pageSize),
    [searchedStudents, page, pageSize]
  );

  const handleSave = async (input: {
    status: NoteInspectionStatus;
    date: string;
    memo?: string;
  }) => {
    if (!modalOpen) return;
    if (modalOpen.existing) {
      await update(modalOpen.existing.id, input);
    } else {
      if (isAllView) throw new Error("전체 뷰에선 선생님을 선택하세요");
      await create({
        studentId: modalOpen.student.id,
        studentName: modalOpen.student.name,
        teacherName: selectedHomeroom,
        ...input,
      });
    }
  };

  const handleDelete = async () => {
    if (!modalOpen?.existing) return;
    await remove(modalOpen.existing.id);
  };

  return (
    <>
      {/* KPI */}
      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <KpiCard
          label={isAllView ? "총 검사 건수 (전체)" : `${selectedHomeroom} 검사 건수`}
          value={`${totalInspections}건`}
        />
        <KpiCard
          label={isAllView ? "담당 학생 총합" : `${selectedHomeroom} 담당 학생`}
          value={`${scopedStudents.length}명`}
        />
        <KpiCard
          label="미검사 학생"
          value={`${uninspectedCount}명`}
          tone={uninspectedCount > 0 ? "warn" : "neutral"}
        />
        <KpiCard
          label="C·F 등급"
          value={`${cGradeCount + fGradeCount}건`}
          tone={cGradeCount + fGradeCount > 0 ? "alert" : "neutral"}
        />
      </div>

      {error && (
        <div className="mb-3 rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {/* 좌(일자별) + 우(학생 매트릭스) */}
      <div className="grid grid-cols-[200px_1fr] items-start gap-3">
        <section className="border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex h-7 items-center border-b border-zinc-200 bg-zinc-50 px-2 text-[11px] font-bold text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
            {monthLabel} 검사 일자
          </div>
          <table className="w-full text-xs">
            <thead className="bg-zinc-100 dark:bg-zinc-800">
              <tr>
                <th className="border-b border-zinc-200 px-2 py-1 text-left font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                  날짜
                </th>
                <th className="border-b border-zinc-200 px-2 py-1 text-right font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                  검사 수
                </th>
              </tr>
            </thead>
            <tbody>
              {monthDays.map((d) => {
                const count = countByDate.get(d) ?? 0;
                const isWeekend = [0, 6].includes(new Date(d).getDay());
                return (
                  <tr
                    key={d}
                    className={`h-7 border-b border-zinc-100 dark:border-zinc-800 ${
                      isWeekend ? "bg-zinc-50/50 dark:bg-zinc-950/50" : ""
                    }`}
                  >
                    <td className="px-2 py-1 text-zinc-700 dark:text-zinc-300">
                      {formatDateKorean(d)}
                    </td>
                    <td
                      className={`px-2 py-1 text-right tabular-nums ${
                        count > 0
                          ? "font-bold text-blue-600 dark:text-blue-400"
                          : "text-zinc-400"
                      }`}
                    >
                      {count}회
                    </td>
                  </tr>
                );
              })}
              <tr className="h-7 bg-zinc-100 dark:bg-zinc-800">
                <td className="px-2 py-1 font-bold text-zinc-700 dark:text-zinc-300">
                  총합
                </td>
                <td className="px-2 py-1 text-right tabular-nums font-bold text-zinc-900 dark:text-zinc-100">
                  {totalInspections}회
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="flex flex-col overflow-hidden border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex h-7 items-center justify-between gap-2 border-b border-zinc-200 bg-zinc-50 px-3 dark:border-zinc-800 dark:bg-zinc-950">
            <span className="text-[11px] font-bold text-zinc-700 dark:text-zinc-300">
              학생별 노트 검사 현황 ({monthLabel})
              {!isAllView && (
                <span className="ml-2 font-normal text-zinc-500">· {selectedHomeroom}</span>
              )}
            </span>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                placeholder="학생 이름 검색"
                className="h-5 w-36 rounded-sm border border-zinc-300 bg-white px-1.5 text-[10px] text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
              <span className="text-[10px] text-zinc-500">행 클릭 시 입력·편집</span>
            </div>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-zinc-100 dark:bg-zinc-800">
                <tr>
                  <th className="border-b border-zinc-200 px-2 py-1 text-left font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                    학생
                  </th>
                  <th className="border-b border-zinc-200 px-2 py-1 text-left font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                    학년
                  </th>
                  {isAllView && (
                    <th className="border-b border-zinc-200 px-2 py-1 text-left font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                      담임
                    </th>
                  )}
                  <th className="border-b border-zinc-200 px-2 py-1 text-center font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                    상태
                  </th>
                  <th className="border-b border-zinc-200 px-2 py-1 text-center font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                    횟수
                  </th>
                  <th className="border-b border-zinc-200 px-2 py-1 text-left font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                    최근 검사일
                  </th>
                  <th className="border-b border-zinc-200 px-2 py-1 text-left font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                    메모
                  </th>
                </tr>
              </thead>
              <tbody>
                {pagedStudents.map((s) => {
                  const b = statsByStudent.get(s.id);
                  if (!b) return null;
                  const nothing = b.total === 0;
                  const hr = teachersByStudent.get(s.id)?.join(", ") || "—";
                  return (
                    <tr
                      key={s.id}
                      onClick={() => setModalOpen({ student: s, existing: b.latest })}
                      className={`h-7 cursor-pointer border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50 ${
                        nothing ? "bg-amber-50 dark:bg-amber-950/30" : ""
                      }`}
                    >
                      <td
                        className={`px-2 py-1 font-medium ${
                          nothing
                            ? "text-amber-800 dark:text-amber-300"
                            : "text-zinc-900 dark:text-zinc-100"
                        }`}
                      >
                        {s.name}
                      </td>
                      <td className="px-2 py-1 text-zinc-500">{s.grade || "—"}</td>
                      {isAllView && (
                        <td className="px-2 py-1 text-zinc-500 truncate max-w-[120px]" title={hr}>
                          {hr}
                        </td>
                      )}
                      <td className="px-2 py-1 text-center">
                        {nothing ? (
                          <span className="inline-block rounded-sm bg-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-900 dark:bg-amber-900/60 dark:text-amber-200">
                            미검사
                          </span>
                        ) : b.latest ? (
                          <span
                            className={`inline-block rounded-sm px-2 py-0.5 text-[10px] font-bold ${STATUS_BADGE[b.latest.status]}`}
                            title={NOTE_INSPECTION_STATUS_LABEL[b.latest.status]}
                          >
                            {b.latest.status}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-2 py-1 text-center tabular-nums">
                        {b.total > 0 ? (
                          <span className="font-bold text-blue-600 dark:text-blue-400">
                            {b.total}회
                          </span>
                        ) : (
                          <span className="text-zinc-300">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1 text-zinc-600 dark:text-zinc-400">
                        {b.lastDate ? formatDateKorean(b.lastDate) : "—"}
                      </td>
                      <td
                        className="truncate px-2 py-1 text-zinc-600 dark:text-zinc-400 max-w-[240px]"
                        title={b.latest?.memo || ""}
                      >
                        {b.latest?.memo || "—"}
                      </td>
                    </tr>
                  );
                })}
                {/* 빈 행 패딩 — 좌측 일자 총 높이와 맞춤, 페이지네이션 위치 고정 */}
                {Array.from({
                  length: Math.max(0, pageSize - pagedStudents.length),
                }).map((_, i) => (
                  <tr
                    key={`blank-${i}`}
                    aria-hidden="true"
                    className="h-7 border-b border-zinc-100 dark:border-zinc-800"
                  >
                    <td colSpan={isAllView ? 7 : 6} />
                  </tr>
                ))}
                {!loading && searchedStudents.length === 0 && (
                  <tr className="pointer-events-none">
                    <td
                      colSpan={isAllView ? 7 : 6}
                      className="px-2 py-4 text-center text-[11px] text-zinc-500"
                    >
                      {studentSearch.trim()
                        ? `"${studentSearch.trim()}" 검색 결과가 없습니다`
                        : "학생이 없습니다"}
                    </td>
                  </tr>
                )}
                {loading && searchedStudents.length === 0 && (
                  <tr className="pointer-events-none">
                    <td
                      colSpan={isAllView ? 7 : 6}
                      className="px-2 py-4 text-center text-[11px] text-zinc-400"
                    >
                      불러오는 중…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* 페이지네이션 */}
          <div className="flex h-7 items-center justify-between border-t border-zinc-200 bg-zinc-50/50 px-2 text-[11px] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
            {totalPages > 1 ? (
              <>
                <span className="tabular-nums">
                  {searchedStudents.length === 0
                    ? "0 / 0명"
                    : `${(page - 1) * pageSize + 1}–${Math.min(
                        page * pageSize,
                        searchedStudents.length
                      )} / ${searchedStudents.length}명`}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-1 hover:text-zinc-900 disabled:opacity-30 dark:hover:text-zinc-100"
                    aria-label="이전 페이지"
                  >
                    ◀
                  </button>
                  <span className="tabular-nums">
                    {page} / {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-1 hover:text-zinc-900 disabled:opacity-30 dark:hover:text-zinc-100"
                    aria-label="다음 페이지"
                  >
                    ▶
                  </button>
                </div>
              </>
            ) : (
              <span className="tabular-nums text-zinc-400">
                총 {searchedStudents.length}명
              </span>
            )}
          </div>
        </section>
      </div>

      {modalOpen && (
        <NoteInspectionModal
          student={modalOpen.student}
          teacherName={isAllView ? "" : selectedHomeroom}
          month={month}
          existing={modalOpen.existing}
          onClose={() => setModalOpen(null)}
          onSave={handleSave}
          onDelete={modalOpen.existing ? handleDelete : undefined}
        />
      )}
    </>
  );
}

function KpiCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warn" | "alert";
}) {
  const toneClass = {
    neutral:
      "border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100",
    good: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/50 dark:text-emerald-200",
    warn: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-200",
    alert:
      "border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-200",
  }[tone];
  return (
    <div className={`border ${toneClass} px-3 py-2`}>
      <div className="text-[10px] font-medium opacity-70">{label}</div>
      <div className="text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}
