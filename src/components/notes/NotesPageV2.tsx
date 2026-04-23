"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useNoteInspections } from "@/hooks/useNoteInspections";
import { toSubjectLabel } from "@/lib/labelMap";
import type {
  NoteInspection,
  NoteInspectionStatus,
  Student,
  Teacher,
} from "@/types";
import { NOTE_INSPECTION_STATUS_LABEL } from "@/types";
import NoteInspectionModal from "./NoteInspectionModal";

/**
 * 노트 검사 V2 — V2 상담과 동일한 레이아웃.
 *   - 좌측: 선생님 레일 (과목별 섹션)
 *   - 우측: 학생별 최근 검사 상태 테이블 + 행 클릭 시 입력·편집 모달
 */

const ALL_TEACHERS = "__all__";

// V2 상담과 동일한 과목 뱃지 팔레트
const SUBJECT_BADGE: Record<string, string> = {
  수학: "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300",
  영어: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  국어: "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
  과학: "bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300",
  고등수학: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300",
  사회: "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300",
};
const MULTI_BADGE = "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300";
const NONE_BADGE = "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";

function subjectBadgeClass(label: string): string {
  if (!label) return NONE_BADGE;
  if (label.includes("/")) return MULTI_BADGE;
  return SUBJECT_BADGE[label] ?? NONE_BADGE;
}

const STATUS_PILL: Record<NoteInspectionStatus, string> = {
  A: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  B: "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300",
  C: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  F: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300",
};

function donutColor(pct: number): string {
  if (pct >= 70) return "#16a34a";
  if (pct >= 40) return "#d97706";
  return "#dc2626";
}

function Donut({ pct, size = 32, stroke = 3.5 }: { pct: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const col = donutColor(pct);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="flex-shrink-0">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        className="text-zinc-200 dark:text-zinc-700"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={col}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${(c * pct) / 100} ${c}`}
        strokeDashoffset={c / 4}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

interface Props {
  month: string;
  teachers: Teacher[];
  studentsByHomeroom: Map<string, Student[]>;
  hiddenTeacherIds: Set<string>;
  selectedHomeroom: string;
  setSelectedHomeroom: (v: string) => void;
  loading: boolean;
  isAllView: boolean;
}

export default function NotesPageV2({
  month,
  teachers,
  studentsByHomeroom,
  hiddenTeacherIds,
  selectedHomeroom,
  setSelectedHomeroom,
  loading: outerLoading,
  isAllView,
}: Props) {
  const {
    inspections,
    loading: inspectionsLoading,
    error,
    create,
    update,
    remove,
  } = useNoteInspections(month);
  const loading = outerLoading || inspectionsLoading;

  const [statusFilter, setStatusFilter] = useLocalStorage<"all" | NoteInspectionStatus | "pending">(
    "notes.v2.statusFilter",
    "all"
  );
  const [studentSearch, setStudentSearch] = useLocalStorage<string>(
    "notes.v2.studentSearch",
    ""
  );
  const [railSearch, setRailSearch] = useState("");
  const [modalOpen, setModalOpen] = useState<{
    student: Student;
    existing: NoteInspection | null;
  } | null>(null);

  // 학생 ID → 이 월 검사 목록 (최신순)
  const inspectionsByStudent = useMemo(() => {
    const m = new Map<string, NoteInspection[]>();
    for (const ins of inspections) {
      if (!m.has(ins.studentId)) m.set(ins.studentId, []);
      m.get(ins.studentId)!.push(ins);
    }
    for (const list of m.values()) list.sort((a, b) => b.date.localeCompare(a.date));
    return m;
  }, [inspections]);

  // 선생님 통계 — 담당 학생 중 최소 1건 검사된 학생 비율
  const teacherStats = useMemo(() => {
    return teachers
      .filter((t) => t.status === "active")
      .filter((t) => !hiddenTeacherIds.has(t.id))
      .filter((t) => (t.subjects || []).length > 0)
      .map((t) => {
        const list = studentsByHomeroom.get(t.name) || [];
        const total = list.length;
        const inspected = list.filter((s) => (inspectionsByStudent.get(s.id) || []).length > 0).length;
        const pending = total - inspected;
        const pct = total > 0 ? Math.round((inspected / total) * 100) : 0;
        const subject = (t.subjects || []).map(toSubjectLabel).filter(Boolean).join("/");
        return { name: t.name, subject, total, done: inspected, pending, pct };
      });
  }, [teachers, hiddenTeacherIds, studentsByHomeroom, inspectionsByStudent]);

  const overall = useMemo(() => {
    const total = teacherStats.reduce((a, s) => a + s.total, 0);
    const done = teacherStats.reduce((a, s) => a + s.done, 0);
    const pending = total - done;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return { total, done, pending, pct };
  }, [teacherStats]);

  // 레일 검색 + 섹션 그룹핑
  const visibleTeachers = useMemo(() => {
    const q = railSearch.trim().toLowerCase();
    return q
      ? teacherStats.filter(
          (t) => t.name.toLowerCase().includes(q) || (t.subject || "").toLowerCase().includes(q)
        )
      : teacherStats;
  }, [teacherStats, railSearch]);

  const SECTION_ORDER = ["수학", "영어", "고등수학", "과학", "국어", "사회"];
  const sections = useMemo(() => {
    const groups = new Map<string, typeof teacherStats>();
    for (const t of visibleTeachers) {
      const key = !t.subject
        ? "미지정"
        : t.subject.includes("/")
          ? "복수 과목"
          : t.subject;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(t);
    }
    const keys = Array.from(groups.keys()).sort((a, b) => {
      if (a === "미지정") return 1;
      if (b === "미지정") return -1;
      if (a === "복수 과목") return 1;
      if (b === "복수 과목") return -1;
      const ai = SECTION_ORDER.indexOf(a);
      const bi = SECTION_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b, "ko");
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    return keys.map((key) => ({
      key,
      teachers: groups.get(key)!.slice().sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name, "ko")),
    }));
  }, [visibleTeachers]);

  // 선택된 선생님 (혹은 전체) 요약
  const selected = useMemo(() => {
    if (isAllView) {
      return { name: "전체 담임", subject: "", ...overall };
    }
    const hit = teacherStats.find((t) => t.name === selectedHomeroom);
    return hit ?? { name: selectedHomeroom, subject: "", total: 0, done: 0, pending: 0, pct: 0 };
  }, [isAllView, overall, teacherStats, selectedHomeroom]);

  // 우측 학생 목록 (scoped)
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

  // 행 목록 구성 — 학생당 1행 (최신 검사 또는 미검사)
  type Row = {
    student: Student;
    latest: NoteInspection | null;
    count: number;
  };
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const s of scopedStudents) {
      const list = inspectionsByStudent.get(s.id) || [];
      out.push({ student: s, latest: list[0] ?? null, count: list.length });
    }
    // 정렬: 검사됨(최근 날짜 desc) 먼저, 미검사(이름 asc) 뒤
    out.sort((a, b) => {
      if (a.latest && !b.latest) return -1;
      if (!a.latest && b.latest) return 1;
      if (a.latest && b.latest) {
        const d = b.latest.date.localeCompare(a.latest.date);
        if (d !== 0) return d;
      }
      return a.student.name.localeCompare(b.student.name, "ko");
    });
    return out;
  }, [scopedStudents, inspectionsByStudent]);

  // 필터 적용
  const filteredRows = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter === "pending" && r.latest) return false;
      if (statusFilter !== "all" && statusFilter !== "pending") {
        if (!r.latest || r.latest.status !== statusFilter) return false;
      }
      if (q) {
        const name = r.student.name.toLowerCase();
        const school = (r.student.school || "").toLowerCase();
        const grade = (r.student.grade || "").toLowerCase();
        if (!name.includes(q) && !school.includes(q) && !grade.includes(q)) return false;
      }
      return true;
    });
  }, [rows, statusFilter, studentSearch]);

  // 페이지네이션 — 25명 고정 (V2 상담과 동일)
  const PAGE_SIZE = 25;
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  useEffect(() => {
    setPage(1);
  }, [selectedHomeroom, statusFilter, studentSearch, month]);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);
  const pagedRows = useMemo(
    () => filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredRows, page]
  );
  const blankCount = Math.max(0, PAGE_SIZE - pagedRows.length);

  // 모달 저장 핸들러
  const teacherNameForCreate = isAllView ? selectedHomeroom : selectedHomeroom;
  const handleSave = async (input: {
    status: NoteInspectionStatus;
    date: string;
    memo?: string;
  }) => {
    if (!modalOpen) return;
    if (modalOpen.existing) {
      await update(modalOpen.existing.id, input);
    } else {
      if (isAllView) {
        throw new Error("전체 담임 뷰에선 특정 선생님을 선택하고 추가해주세요");
      }
      await create({
        studentId: modalOpen.student.id,
        studentName: modalOpen.student.name,
        teacherName: teacherNameForCreate,
        ...input,
      });
    }
  };

  const handleDelete = async () => {
    if (!modalOpen?.existing) return;
    await remove(modalOpen.existing.id);
  };

  return (
    <div className="grid grid-cols-[300px_1fr] gap-3" style={{ minHeight: 600 }}>
      {/* ─── 좌측 레일 ─── */}
      <aside className="flex flex-col overflow-hidden border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex h-7 flex-shrink-0 items-center justify-between border-b border-zinc-200 bg-zinc-50 px-3 dark:border-zinc-800 dark:bg-zinc-950">
          <span className="text-[11px] font-bold text-zinc-700 dark:text-zinc-300">
            선생님 · {teacherStats.length}명
          </span>
          <span className="text-[10px] text-zinc-500">노트 V2</span>
        </div>

        <div className="flex-shrink-0 border-b border-zinc-100 p-2 dark:border-zinc-800">
          <input
            type="text"
            value={railSearch}
            onChange={(e) => setRailSearch(e.target.value)}
            placeholder="선생님·과목 검색"
            className="h-6 w-full rounded-sm border border-zinc-300 bg-white px-2 text-[11px] text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>

        {/* 전체 담임 카드 */}
        <div className="flex-shrink-0 border-b border-zinc-200 p-2 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setSelectedHomeroom(ALL_TEACHERS)}
            className={`flex w-full items-center gap-2 rounded-sm border px-2 py-1.5 text-left transition-colors ${
              isAllView
                ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/50"
                : "border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            }`}
          >
            <Donut pct={overall.pct} size={32} stroke={3.5} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1">
                <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">전체 담임</span>
                <span className="text-[10px] text-zinc-500">· {overall.total}명</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-[10px]">
                <span className="text-zinc-500">검사</span>
                <span className="font-bold text-emerald-700 dark:text-emerald-400">{overall.done}</span>
                <span className="text-zinc-400">·</span>
                <span className="text-zinc-500">미검사</span>
                <span className="font-bold text-amber-700 dark:text-amber-400">{overall.pending}</span>
              </div>
            </div>
            <div className="text-xs font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
              {overall.pct}%
            </div>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {sections.map((sec) => {
            const sectionDone = sec.teachers.reduce((a, t) => a + t.done, 0);
            const sectionTotal = sec.teachers.reduce((a, t) => a + t.total, 0);
            const badge = subjectBadgeClass(sec.key);
            return (
              <div key={sec.key}>
                <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-zinc-300 bg-zinc-100 px-3 py-1.5 shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`inline-block rounded-sm px-1.5 py-0.5 text-[10px] font-bold leading-none ${badge}`}
                    >
                      {sec.key}
                    </span>
                    <span className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
                      {sec.teachers.length}명
                    </span>
                  </span>
                  <span className="text-[10px] tabular-nums text-zinc-500">
                    검사 {sectionDone} / {sectionTotal}
                  </span>
                </div>
                <div className="space-y-1 p-2">
                  {sec.teachers.map((t) => {
                    const active = selectedHomeroom === t.name;
                    return (
                      <button
                        key={t.name}
                        type="button"
                        onClick={() => setSelectedHomeroom(t.name)}
                        className={`flex w-full items-center gap-2 rounded-sm border px-2 py-1.5 text-left transition-colors ${
                          active
                            ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/50"
                            : "border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                        }`}
                      >
                        <Donut pct={t.pct} size={32} stroke={3.5} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-bold text-zinc-900 dark:text-zinc-100">
                            {t.name}
                          </div>
                          <div className="mt-0.5 flex items-center gap-1 text-[10px]">
                            <span className="text-zinc-500">{t.total}명</span>
                            <span className="text-zinc-400">·</span>
                            <span className="font-bold text-emerald-700 dark:text-emerald-400">
                              ✓{t.done}
                            </span>
                            {t.pending > 0 && (
                              <>
                                <span className="text-zinc-400">·</span>
                                <span className="font-bold text-amber-700 dark:text-amber-400">
                                  !{t.pending}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="text-xs font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                          {t.pct}%
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {sections.length === 0 && !loading && (
            <div className="px-2 py-6 text-center text-[11px] text-zinc-400">검색 결과가 없습니다</div>
          )}
        </div>
      </aside>

      {/* ─── 우측 상세 ─── */}
      <main className="flex min-w-0 flex-col overflow-hidden border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-shrink-0 items-center gap-3 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] text-zinc-500">
              노트 검사 · {month}
              {!isAllView && selected.subject && <span className="ml-1">· {selected.subject}</span>}
            </div>
            <h2 className="mt-0.5 truncate text-sm font-bold text-zinc-900 dark:text-zinc-100">
              {isAllView ? "전체 담임 집계" : `${selected.name} 선생님 담당`}
              <span className="ml-2 inline-flex items-center gap-1.5 text-[11px] font-normal text-zinc-500">
                <span>담당 <b className="text-zinc-700 dark:text-zinc-300">{selected.total}</b>명</span>
                <span className="text-zinc-300">·</span>
                <span>
                  <span className="text-emerald-700 dark:text-emerald-400">✓ {selected.done}</span>
                </span>
                <span className="text-zinc-300">·</span>
                <span>
                  <span className="text-amber-700 dark:text-amber-400">! {selected.pending}</span>
                </span>
                <span className="text-zinc-300">·</span>
                <span>
                  완료율 <b className="text-blue-700 dark:text-blue-400">{selected.pct}%</b>
                </span>
              </span>
            </h2>
          </div>
        </div>

        {/* 필터 */}
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
          <div className="inline-flex items-center rounded-sm bg-zinc-100 p-0.5 dark:bg-zinc-800">
            {(
              [
                ["all", "전체"],
                ["A", "A"],
                ["B", "B"],
                ["C", "C"],
                ["F", "F"],
                ["pending", "미검사"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setStatusFilter(k)}
                className={`rounded-sm px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  statusFilter === k
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <input
            type="text"
            value={studentSearch}
            onChange={(e) => setStudentSearch(e.target.value)}
            placeholder="학생 이름·학교 검색"
            className="h-6 w-44 rounded-sm border border-zinc-300 bg-white px-2 text-[11px] text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />

          {error && (
            <span className="text-[11px] text-red-500">오류: {error}</span>
          )}
        </div>

        {/* 테이블 */}
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full table-fixed text-xs">
            <colgroup>
              <col className="w-10" />
              <col className="w-12" />
              <col className="w-28" />
              <col className="w-28" />
              <col className="w-24" />
              <col />
              <col className="w-16" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-zinc-100 dark:bg-zinc-800">
              <tr>
                <th className="border-b border-zinc-300 px-2 py-1.5 text-center font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                  #
                </th>
                <th className="border-b border-zinc-300 px-2 py-1.5 text-center font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                  상태
                </th>
                <th className="border-b border-zinc-300 px-2 py-1.5 text-left font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                  학생
                </th>
                <th className="border-b border-zinc-300 px-2 py-1.5 text-left font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                  학교·학년
                </th>
                <th className="border-b border-zinc-300 px-2 py-1.5 text-left font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                  최근 검사
                </th>
                <th className="border-b border-zinc-300 px-2 py-1.5 text-left font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                  메모
                </th>
                <th className="border-b border-zinc-300 px-2 py-1.5 text-center font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                  횟수
                </th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((r, i) => {
                const latest = r.latest;
                const idx = (page - 1) * PAGE_SIZE + i + 1;
                return (
                  <tr
                    key={r.student.id}
                    onClick={() =>
                      setModalOpen({ student: r.student, existing: latest })
                    }
                    className={`h-8 cursor-pointer border-b border-zinc-100 transition-colors dark:border-zinc-800 ${
                      !latest
                        ? "bg-amber-50/20 hover:bg-amber-50/40 dark:bg-amber-950/10 dark:hover:bg-amber-950/20"
                        : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                    }`}
                  >
                    <td className="px-2 py-1 text-center text-[10px] tabular-nums text-zinc-400">
                      {String(idx).padStart(2, "0")}
                    </td>
                    <td className="px-2 py-1 text-center">
                      {latest ? (
                        <span
                          className={`inline-flex h-5 min-w-5 items-center justify-center rounded-sm px-1.5 text-[11px] font-bold ${STATUS_PILL[latest.status]}`}
                          title={`${latest.status} · ${NOTE_INSPECTION_STATUS_LABEL[latest.status]}`}
                        >
                          {latest.status}
                        </span>
                      ) : (
                        <span
                          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-[11px] font-bold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                          title="미검사"
                        >
                          !
                        </span>
                      )}
                    </td>
                    <td
                      className="truncate px-2 py-1 font-semibold text-zinc-900 dark:text-zinc-100"
                      title={r.student.name}
                    >
                      {r.student.name}
                    </td>
                    <td
                      className="truncate px-2 py-1 text-zinc-600 dark:text-zinc-400"
                      title={`${r.student.school || ""} ${r.student.grade || ""}`}
                    >
                      {r.student.school || "—"} {r.student.grade || ""}
                    </td>
                    <td className="px-2 py-1 tabular-nums text-zinc-700 dark:text-zinc-300">
                      {latest ? latest.date.slice(5).replace("-", "/") : (
                        <span className="text-[11px] text-amber-700 dark:text-amber-400">
                          미검사
                        </span>
                      )}
                    </td>
                    <td
                      className="truncate px-2 py-1 text-zinc-600 dark:text-zinc-400"
                      title={latest?.memo || ""}
                    >
                      {latest?.memo || "—"}
                    </td>
                    <td className="px-2 py-1 text-center tabular-nums text-[11px] text-zinc-500">
                      {r.count > 0 ? `${r.count}회` : "—"}
                    </td>
                  </tr>
                );
              })}
              {/* 빈 행 패딩 — 페이지네이션 위치 고정 */}
              {Array.from({ length: blankCount }).map((_, i) => (
                <tr
                  key={`blank-${i}`}
                  aria-hidden="true"
                  className="h-8 border-b border-zinc-100 dark:border-zinc-800"
                >
                  <td colSpan={7} />
                </tr>
              ))}
              {filteredRows.length === 0 && !loading && (
                <tr className="pointer-events-none">
                  <td colSpan={7} className="px-2 py-3 text-center text-[11px] text-zinc-500">
                    {studentSearch.trim()
                      ? `"${studentSearch.trim()}" 검색 결과가 없습니다`
                      : "학생이 없습니다"}
                  </td>
                </tr>
              )}
              {loading && filteredRows.length === 0 && (
                <tr className="pointer-events-none">
                  <td colSpan={7} className="px-2 py-3 text-center text-[11px] text-zinc-400">
                    불러오는 중…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 페이지네이션 */}
        <div className="flex h-7 flex-shrink-0 items-center justify-between border-t border-zinc-200 bg-zinc-50/50 px-2 text-[11px] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
          <span className="tabular-nums">
            {filteredRows.length === 0
              ? "0명"
              : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(
                  page * PAGE_SIZE,
                  filteredRows.length
                )} / ${filteredRows.length}명`}
          </span>
          {totalPages > 1 ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-1 text-zinc-500 hover:text-zinc-900 disabled:opacity-30 dark:hover:text-zinc-100"
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
                className="px-1 text-zinc-500 hover:text-zinc-900 disabled:opacity-30 dark:hover:text-zinc-100"
                aria-label="다음 페이지"
              >
                ▶
              </button>
            </div>
          ) : (
            <span className="text-zinc-400">한 페이지</span>
          )}
        </div>
      </main>

      {/* 모달 */}
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
    </div>
  );
}
