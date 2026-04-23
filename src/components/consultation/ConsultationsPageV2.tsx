"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { toSubjectLabel } from "@/lib/labelMap";
import { cachedFetch } from "@/lib/fetchCache";
import type { Consultation, Student, Teacher } from "@/types";

/**
 * 상담 V2 — 레이아웃 파일럿.
 *   - 좌측: 선생님 카드 레일 (완료율 도넛 + 완료/미상담 칩)
 *   - 우측: 선택 선생님 상세 (Phase 3~4)
 *   - 전체 담임(__all__) 선택 시 우측은 집계 뷰 (Phase 5)
 *
 * 스타일은 현재 Tailwind 테마(zinc)에 맞춰 번역, ijw-calander 읽기 전용 데이터 재사용.
 */

const ALL_TEACHERS = "__all__";

/**
 * 학교명 정규화
 *   "대구일중학교" → "대구일중"
 *   "경명여자중학교" → "경명여중"
 *   "서울남자고등학교" → "서울남고"
 *   "옥산초등학교" → "옥산초"
 */
function normalizeSchoolName(raw: string): string {
  let s = (raw || "").trim();
  // 학교 유형 접미사 축약 — 긴 패턴 먼저
  s = s.replace(/고등학교$/, "고");
  s = s.replace(/중학교$/, "중");
  s = s.replace(/초등학교$/, "초");
  s = s.replace(/대학교$/, "대");
  // 남녀 표기 축약
  s = s.replace(/여자/g, "여");
  s = s.replace(/남자/g, "남");
  return s;
}

/**
 * 학교·학년 포맷: "대구일중 중2" → "대구일중2", "경명여자중학교 중1" → "경명여중1"
 *   school 정규화 + 마지막 글자(중/초/고/대)가 grade 첫 글자와 같으면 중복 제거.
 */
function formatSchoolGrade(school?: string, grade?: string): string {
  const s = school ? normalizeSchoolName(school) : "";
  if (!s && !grade) return "—";
  if (!s) return grade || "—";
  if (!grade) return s;
  const last = s.slice(-1);
  if (/[중초고대]/.test(last) && grade.startsWith(last)) {
    return s + grade.slice(1);
  }
  return `${s} ${grade}`;
}

type SortKey = "rate_desc" | "name_asc";

interface Props {
  month: string;
  teachers: Teacher[];
  students: Student[];
  consultations: Consultation[];
  homerooms: { name: string; subject: string; studentCount: number }[];
  studentsByHomeroom: Map<string, Student[]>;
  hiddenTeacherIds: Set<string>;
  selectedHomeroom: string;
  setSelectedHomeroom: (v: string) => void;
  loading: boolean;
  isAllView: boolean;
}

// 과목별 뱃지 팔레트 — HomeroomPicker 와 동일 체계
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

/**
 * 이름 문자열에서 가능한 모든 표기 추출 (V1 동일 로직)
 *   "정유진(Yoojin)" → ["정유진(Yoojin)", "정유진", "Yoojin"]
 */
function extractNameAliases(raw: string | undefined): string[] {
  const s = (raw ?? "").trim();
  if (!s) return [];
  const result = new Set<string>([s]);
  const m = s.match(/^(.+?)\s*\(\s*(.+?)\s*\)$/);
  if (m) {
    result.add(m[1].trim());
    result.add(m[2].trim());
  }
  const stripped = s.replace(/\s*\([^)]*\)\s*/g, "").trim();
  if (stripped) result.add(stripped);
  return Array.from(result);
}

/**
 * 상담자 이름이 특정 선생님과 일치하는지 판정.
 *   - consultantName 의 모든 alias(본명/영어명/괄호안팎)와
 *     teacher 의 name/englishName alias 를 대소문자 무시 교집합으로 비교
 */
function matchesTeacher(
  consultantName: string | undefined,
  teacher: Teacher | undefined
): boolean {
  if (!consultantName || !teacher) return false;
  const consultantAliases = new Set(
    extractNameAliases(consultantName).map((n) => n.toLowerCase())
  );
  const teacherSources = [teacher.name, teacher.englishName].filter(Boolean) as string[];
  for (const src of teacherSources) {
    for (const alias of extractNameAliases(src)) {
      if (consultantAliases.has(alias.toLowerCase())) return true;
    }
  }
  return false;
}

// 도넛 색상 — 완료율 기준 단계적
function donutColor(pct: number): string {
  if (pct >= 70) return "#16a34a"; // green-600
  if (pct >= 40) return "#d97706"; // amber-600
  return "#dc2626"; // red-600
}

function Donut({ pct, size = 36, stroke = 4 }: { pct: number; size?: number; stroke?: number }) {
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

export default function ConsultationsPageV2({
  month,
  teachers,
  students,
  consultations,
  homerooms: _homerooms, // V1 호환 props — V2에선 teachers 기반 자체 계산 사용
  studentsByHomeroom,
  hiddenTeacherIds,
  selectedHomeroom,
  setSelectedHomeroom,
  loading,
  isAllView,
}: Props) {
  void _homerooms;
  const [statusFilter, setStatusFilter] = useLocalStorage<"all" | "done" | "pending">(
    "consultations.v2.statusFilter",
    "all"
  );
  const [classFilter, setClassFilter] = useLocalStorage<string>(
    "consultations.v2.classFilter",
    "all"
  );
  // 전체 담임 뷰 전용 — 과목(섹션 키) 필터. "all" 또는 "수학"·"복수 과목"·"미지정" 등.
  const [subjectFilter, setSubjectFilter] = useLocalStorage<string>(
    "consultations.v2.subjectFilter",
    "all"
  );
  const [studentSearch, setStudentSearch] = useLocalStorage<string>(
    "consultations.v2.studentSearch",
    ""
  );
  // 모달로 열릴 이벤트 행 (학생 + 상담 쌍). null 이면 모달 닫힘.
  const [modalRowKey, setModalRowKey] = useState<string | null>(null);

  // 레일 검색·정렬
  const [railSearch, setRailSearch] = useState<string>("");
  const [sortKey, setSortKey] = useLocalStorage<SortKey>("consultations.v2.railSort", "rate_desc");

  // 선생님별 본인 상담 목록 — consultantName 이 해당 선생님과 매칭되는 상담만.
  //   "본인이 직접 상담한 기록" 만 '완료' 로 집계 (V1 homeroomSummaries 와 동일 로직).
  const consultationsByTeacher = useMemo(() => {
    const m = new Map<string, Consultation[]>();
    for (const t of teachers) m.set(t.name, []);
    for (const c of consultations) {
      for (const t of teachers) {
        if (matchesTeacher(c.consultantName, t)) m.get(t.name)!.push(c);
      }
    }
    return m;
  }, [teachers, consultations]);

  // V2 선생님 통계 — teachers 전체(활성/과목 있음/숨김 제외)에서 직접 계산.
  //   done = "이 선생님 본인이 상담한 담당 학생 수" (consultantName 매칭 기준).
  //   단순히 "담당 학생이 누군가에게 상담받음" 이 아님 — 본인이 아닌 다른
  //   선생님(예: 수학 담임 학생을 영어 담임이 상담) 기록은 여기선 제외.
  const teacherStats = useMemo(() => {
    return teachers
      .filter((t) => t.status === "active")
      .filter((t) => !hiddenTeacherIds.has(t.id))
      .filter((t) => (t.subjects || []).length > 0)
      .map((t) => {
        const list = studentsByHomeroom.get(t.name) || [];
        const total = list.length;
        const myConsults = consultationsByTeacher.get(t.name) || [];
        const consultedIds = new Set(myConsults.map((c) => c.studentId));
        const done = list.filter((s) => consultedIds.has(s.id)).length;
        const pending = total - done;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        const subject = (t.subjects || []).map(toSubjectLabel).filter(Boolean).join("/");
        return {
          name: t.name,
          subject,
          total,
          done,
          pending,
          pct,
          studentCount: total,
        };
      });
  }, [teachers, hiddenTeacherIds, studentsByHomeroom, consultationsByTeacher]);

  const overall = useMemo(() => {
    const total = teacherStats.reduce((a, s) => a + s.total, 0);
    const done = teacherStats.reduce((a, s) => a + s.done, 0);
    const pending = total - done;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return { total, done, pending, pct };
  }, [teacherStats]);

  // 학생 → 담임 선생님 이름 배열 (studentsByHomeroom 역매핑).
  //   isAllView 테이블에서 "담임" 컬럼으로 노출, 과목 필터에도 사용.
  const teachersByStudent = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const [teacherName, list] of studentsByHomeroom.entries()) {
      for (const s of list) {
        if (!m.has(s.id)) m.set(s.id, []);
        m.get(s.id)!.push(teacherName);
      }
    }
    return m;
  }, [studentsByHomeroom]);

  // 선생님 이름 → 과목 레이블 매핑. 과목 필터 판정과 담임 뱃지 색상에 사용.
  const subjectByTeacher = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of teachers) {
      const label = (t.subjects || []).map(toSubjectLabel).filter(Boolean).join("/");
      m.set(t.name, label);
    }
    return m;
  }, [teachers]);

  // 레일 검색 적용 (정렬은 섹션 내에서)
  const visibleTeachers = useMemo(() => {
    const q = railSearch.trim().toLowerCase();
    return q
      ? teacherStats.filter(
          (t) => t.name.toLowerCase().includes(q) || (t.subject || "").toLowerCase().includes(q)
        )
      : teacherStats;
  }, [teacherStats, railSearch]);

  // 과목별 섹션 그룹핑 — 과목 순서 고정, 섹션 내에서 정렬 적용
  const SECTION_ORDER = ["수학", "영어", "고등수학", "과학", "국어", "사회"];
  const sections = useMemo(() => {
    const groups = new Map<string, typeof teacherStats>();
    for (const t of visibleTeachers) {
      // 복수 과목(수학/영어 같은)은 "복수" 섹션으로, 미지정은 "미지정" 섹션으로
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
    return keys.map((key) => {
      const list = groups.get(key)!.slice().sort((a, b) => {
        if (sortKey === "rate_desc") {
          if (b.pct !== a.pct) return b.pct - a.pct;
          return a.name.localeCompare(b.name, "ko");
        }
        return a.name.localeCompare(b.name, "ko");
      });
      return { key, teachers: list };
    });
  }, [visibleTeachers, sortKey]);

  // 섹션 헤더 스크롤 점프 — id 기반
  const scrollToSection = (key: string) => {
    const el = document.getElementById(`v2-rail-sec-${key}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // 선택 선생님 정보 (또는 전체 집계)
  const selected = useMemo(() => {
    if (isAllView) {
      return {
        name: "전체 담임",
        subject: "",
        total: overall.total,
        done: overall.done,
        pending: overall.pending,
        pct: overall.pct,
      };
    }
    const hit = teacherStats.find((t) => t.name === selectedHomeroom);
    if (hit) return hit;
    // 백업 — 레일에 없는 선생님(이름으로만 설정된 경우)
    return {
      name: selectedHomeroom,
      subject: "",
      total: 0,
      done: 0,
      pending: 0,
      pct: 0,
    };
  }, [isAllView, overall, teacherStats, selectedHomeroom]);

  // 우측 학생 목록 — 선택 선생님 담당 / 전체 집계
  const scopedStudents = useMemo(() => {
    if (isAllView) {
      // 전체 집계: studentsByHomeroom 전체 학생 union (중복 제거)
      const seen = new Set<string>();
      const out: Student[] = [];
      for (const list of studentsByHomeroom.values()) {
        for (const s of list) {
          if (seen.has(s.id)) continue;
          seen.add(s.id);
          out.push(s);
        }
      }
      return out;
    }
    return studentsByHomeroom.get(selectedHomeroom) || [];
  }, [isAllView, selectedHomeroom, studentsByHomeroom]);

  // 학생별 상담 매핑 (당월) — studentId → Consultation[] (최신순).
  //   전체 담임 뷰: 모든 상담 포함.
  //   특정 선생님 뷰: "이 선생님이 직접 상담한" 기록만 — 다른 선생님이 상담한
  //     같은 학생 기록은 여기에 포함되지 않아야 오른쪽 테이블에 안 나옴.
  const consultationsByStudent = useMemo(() => {
    let src: Consultation[];
    if (isAllView) {
      src = consultations;
    } else {
      const teacher = teachers.find((t) => t.name === selectedHomeroom);
      const nameAliases = extractNameAliases(selectedHomeroom).map((n) => n.toLowerCase());
      src = consultations.filter((c) => {
        if (matchesTeacher(c.consultantName, teacher)) return true;
        // teacher 객체에 없는 이름일 때 alias 비교 폴백
        const consAliases = extractNameAliases(c.consultantName ?? "").map((n) => n.toLowerCase());
        return nameAliases.some((n) => consAliases.includes(n));
      });
    }
    const m = new Map<string, Consultation[]>();
    for (const c of src) {
      if (!m.has(c.studentId)) m.set(c.studentId, []);
      m.get(c.studentId)!.push(c);
    }
    for (const list of m.values()) {
      list.sort((a, b) => b.date.localeCompare(a.date));
    }
    return m;
  }, [consultations, isAllView, teachers, selectedHomeroom]);

  // 각 학생의 이 선생님 담당 className 추출 헬퍼
  const selectedTeacher = useMemo(
    () => teachers.find((t) => t.name === selectedHomeroom),
    [teachers, selectedHomeroom]
  );
  const classNameOfStudent = (s: Student): string => {
    for (const e of s.enrollments || []) {
      if (!e.className) continue;
      const matches =
        (e.staffId && selectedTeacher && e.staffId === selectedTeacher.id) ||
        (e.teacher && e.teacher === selectedHomeroom) ||
        (e.teacher && selectedTeacher?.englishName && e.teacher === selectedTeacher.englishName);
      if (matches) return e.className;
    }
    return "";
  };

  // 이벤트 행 — 한 학생이 상담 여러 건이면 행도 여러 개. 상담 없는 학생은 1행(미상담).
  type EventRow = {
    key: string;
    student: Student;
    className: string;
    // 전체 담임 뷰에서 표시할 담임 선생님 이름 목록(가나다 정렬).
    homeroomNames: string[];
    status: "done" | "pending";
    consultation: Consultation | null; // null 이면 미상담
    // 같은 학생의 당월 전체 상담 — 모달에서 "지난 상담" 리스트용
    allConsultations: Consultation[];
  };
  const studentRows = useMemo<EventRow[]>(() => {
    const rows: EventRow[] = [];
    for (const s of scopedStudents) {
      const list = consultationsByStudent.get(s.id) || [];
      const className = classNameOfStudent(s);
      const homeroomNames = (teachersByStudent.get(s.id) || [])
        .slice()
        .sort((a, b) => a.localeCompare(b, "ko"));
      if (list.length === 0) {
        rows.push({
          key: `${s.id}`,
          student: s,
          className,
          homeroomNames,
          status: "pending",
          consultation: null,
          allConsultations: [],
        });
      } else {
        for (const c of list) {
          rows.push({
            key: `${s.id}|${c.id}`,
            student: s,
            className,
            homeroomNames,
            status: "done",
            consultation: c,
            allConsultations: list,
          });
        }
      }
    }
    // 정렬: 완료 건(최신 상담일 내림차순) 먼저, 미상담은 이름 가나다순 뒤
    rows.sort((a, b) => {
      if (a.status === "done" && b.status === "pending") return -1;
      if (a.status === "pending" && b.status === "done") return 1;
      if (a.status === "done" && b.status === "done") {
        const byDate = (b.consultation?.date || "").localeCompare(a.consultation?.date || "");
        if (byDate !== 0) return byDate;
      }
      return a.student.name.localeCompare(b.student.name, "ko");
    });
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedStudents, consultationsByStudent, selectedTeacher, selectedHomeroom, teachersByStudent]);

  // 필터 적용 — 이벤트 행(상담 1건 또는 미상담) 단위
  const filteredRows = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    return studentRows.filter((r) => {
      if (statusFilter === "done" && r.status !== "done") return false;
      if (statusFilter === "pending" && r.status !== "pending") return false;
      if (!isAllView && classFilter !== "all" && r.className !== classFilter) return false;
      // 전체 담임 뷰 + 과목 필터 — 담임 한 명이라도 해당 과목이면 표시
      if (isAllView && subjectFilter !== "all") {
        const hit = r.homeroomNames.some((hr) => {
          const subj = subjectByTeacher.get(hr) || "";
          if (subjectFilter === "복수 과목") return subj.includes("/");
          if (subjectFilter === "미지정") return !subj;
          return subj === subjectFilter;
        });
        if (!hit) return false;
      }
      if (q) {
        const name = r.student.name.toLowerCase();
        const school = (r.student.school || "").toLowerCase();
        const grade = (r.student.grade || "").toLowerCase();
        const title = (r.consultation?.title || "").toLowerCase();
        if (!name.includes(q) && !school.includes(q) && !grade.includes(q) && !title.includes(q))
          return false;
      }
      return true;
    });
  }, [studentRows, statusFilter, classFilter, subjectFilter, studentSearch, isAllView, subjectByTeacher]);

  // 페이지네이션 — 25명 고정. scroll 영역은 thead + 25*32 로 정확히 맞춰 하단 여백 0.
  const PAGE_SIZE = 25;
  const pageSize = PAGE_SIZE;
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = containerRef.current;
    const scroll = scrollRef.current;
    if (!container || !scroll) return;
    const main = scroll.parentElement;
    if (!main) return;
    const ROW_H = 32;
    const calc = () => {
      const theadH =
        scroll.querySelector("thead")?.getBoundingClientRect().height ?? 29;
      const exactScrollH = theadH + PAGE_SIZE * ROW_H;
      const siblings = Array.from(main.children).filter(
        (c) => c !== scroll
      ) as HTMLElement[];
      const siblingsH = siblings.reduce(
        (a, s) => a + s.getBoundingClientRect().height,
        0
      );
      container.style.height = `${siblingsH + exactScrollH}px`;
      scroll.style.height = `${exactScrollH}px`;
      scroll.style.flex = "0 0 auto";
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);

  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  useEffect(() => {
    setPage(1);
  }, [selectedHomeroom, statusFilter, classFilter, studentSearch, month]);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);
  const pagedRows = useMemo(
    () => filteredRows.slice((page - 1) * pageSize, page * pageSize),
    [filteredRows, page, pageSize]
  );
  const blankCount = Math.max(0, pageSize - pagedRows.length);

  // 전체 담임 뷰 — 과목 섹션별 요약(담임 수·총학생·완료·미상담·완료율).
  //   sections 은 이미 과목별로 그룹핑되어 있으므로 그대로 집계.
  const subjectBreakdown = useMemo(() => {
    if (!isAllView) return [];
    return sections.map((sec) => {
      const total = sec.teachers.reduce((a, t) => a + t.total, 0);
      const done = sec.teachers.reduce((a, t) => a + t.done, 0);
      const pending = total - done;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      return {
        key: sec.key,
        teacherCount: sec.teachers.length,
        total,
        done,
        pending,
        pct,
      };
    });
  }, [isAllView, sections]);

  // 반명(className) 목록 — 이 선생님이 실제로 담당하는 enrollment 만.
  //   scopedStudents 는 담임 관계로 묶였지만 학생은 여러 과목을 수강하므로,
  //   이 선생님 본인의 수업 (staffId / teacher 이름 매칭) 만 수집해야 과목 섞임 방지.
  const classOptions = useMemo(() => {
    if (isAllView) return [];
    const teacher = teachers.find((t) => t.name === selectedHomeroom);
    const set = new Set<string>();
    for (const s of scopedStudents) {
      for (const e of s.enrollments || []) {
        if (!e.className) continue;
        const matches =
          (e.staffId && teacher && e.staffId === teacher.id) ||
          (e.teacher && e.teacher === selectedHomeroom) ||
          (e.teacher && teacher?.englishName && e.teacher === teacher.englishName);
        if (matches) set.add(e.className);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ko"));
  }, [scopedStudents, teachers, selectedHomeroom, isAllView]);

  return (
    <div ref={containerRef} className="grid grid-cols-[300px_1fr] gap-3">
      {/* ─── 좌측 레일 ─── 우측 main 높이와 동일(h-full) · 내부 스크롤 */}
      <aside className="flex h-full flex-col overflow-hidden border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        {/* 헤더 */}
        <div className="flex h-7 flex-shrink-0 items-center justify-between border-b border-zinc-200 bg-zinc-50 px-3 dark:border-zinc-800 dark:bg-zinc-950">
          <span className="text-[11px] font-bold text-zinc-700 dark:text-zinc-300">
            선생님 · {teacherStats.length}명
          </span>
          <span className="text-[10px] text-zinc-500">V2 파일럿</span>
        </div>

        {/* 검색 */}
        <div className="flex-shrink-0 border-b border-zinc-100 p-2 dark:border-zinc-800">
          <div className="relative">
            <input
              type="text"
              value={railSearch}
              onChange={(e) => setRailSearch(e.target.value)}
              placeholder="선생님·과목 검색"
              className="h-6 w-full rounded-sm border border-zinc-300 bg-white pl-5 pr-5 text-[11px] text-zinc-900 placeholder-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
            <svg
              className="pointer-events-none absolute left-1 top-1/2 h-2.5 w-2.5 -translate-y-1/2 text-zinc-400"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l3.817 3.817a1 1 0 01-1.414 1.414l-3.817-3.817A6 6 0 012 8z"
                clipRule="evenodd"
              />
            </svg>
            {railSearch && (
              <button
                type="button"
                onClick={() => setRailSearch("")}
                aria-label="검색어 지우기"
                className="absolute right-0.5 top-1/2 -translate-y-1/2 px-0.5 text-[10px] leading-none text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                ✕
              </button>
            )}
          </div>
          {/* 정렬 세그먼트 + 과목 점프 */}
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <div className="inline-flex items-center rounded-sm bg-zinc-100 p-0.5 dark:bg-zinc-800">
              <button
                type="button"
                onClick={() => setSortKey("rate_desc")}
                className={`rounded-sm px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  sortKey === "rate_desc"
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400"
                }`}
                title="섹션 내 완료율 내림차순"
              >
                완료율↓
              </button>
              <button
                type="button"
                onClick={() => setSortKey("name_asc")}
                className={`rounded-sm px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  sortKey === "name_asc"
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400"
                }`}
                title="섹션 내 이름 가나다순"
              >
                이름
              </button>
            </div>
            {/* 과목 점프 칩 — 클릭 시 해당 섹션으로 스크롤 */}
            <div className="flex flex-wrap gap-1">
              {sections.map((sec) => (
                <button
                  key={sec.key}
                  type="button"
                  onClick={() => scrollToSection(sec.key)}
                  className={`rounded-sm border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${subjectBadgeClass(sec.key)} border-transparent hover:brightness-95`}
                  title={`${sec.key} 섹션으로 이동`}
                >
                  {sec.key} {sec.teachers.length}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 전체 담임 카드 — 스크롤 영역 밖 고정 */}
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
                <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                  전체 담임
                </span>
                <span className="text-[10px] text-zinc-500">· {overall.total}명</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-[10px]">
                <span className="text-zinc-500">완료</span>
                <span className="font-bold text-emerald-700 dark:text-emerald-400">
                  {overall.done}
                </span>
                <span className="text-zinc-400">·</span>
                <span className="text-zinc-500">미상담</span>
                <span className="font-bold text-amber-700 dark:text-amber-400">
                  {overall.pending}
                </span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                {overall.pct}%
              </div>
            </div>
          </button>
        </div>

        {/* 스크롤 카드 리스트 — 과목별 섹션 */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* 과목별 섹션 */}
          {sections.map((sec) => {
            const sectionDone = sec.teachers.reduce((a, t) => a + t.done, 0);
            const sectionTotal = sec.teachers.reduce((a, t) => a + t.total, 0);
            const badge = subjectBadgeClass(sec.key);
            return (
              <div key={sec.key} id={`v2-rail-sec-${sec.key}`}>
                {/* sticky 섹션 헤더 */}
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
                    완료 {sectionDone} / {sectionTotal}
                  </span>
                </div>
                {/* 섹션 내 카드 */}
                <div className="space-y-1 p-2">
                  {sec.teachers.map((t) => {
                    const active = selectedHomeroom === t.name;
                    const cardBadge = subjectBadgeClass(t.subject);
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
                          <div className="flex items-center gap-1">
                            <span className="truncate text-xs font-bold text-zinc-900 dark:text-zinc-100">
                              {t.name}
                            </span>
                            {t.subject && t.subject.includes("/") && (
                              <span
                                className={`inline-block rounded-sm px-1 py-0 text-[9px] font-bold leading-none ${cardBadge}`}
                              >
                                {t.subject}
                              </span>
                            )}
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
                        <div className="text-right">
                          <div className="text-xs font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                            {t.pct}%
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {sections.length === 0 && !loading && (
            <div className="px-2 py-6 text-center text-[11px] text-zinc-400">
              검색 결과가 없습니다
            </div>
          )}
        </div>

        {/* 하단 전체 합계 푸터 — 3색 바 */}
        <div className="flex-shrink-0 border-t border-zinc-200 bg-zinc-50/60 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950/60">
          <div className="mb-1 flex items-baseline gap-1">
            <span className="text-[10px] font-bold text-zinc-600 dark:text-zinc-400">
              이번 달 전체
            </span>
            <span className="ml-auto text-[10px] tabular-nums text-zinc-500">
              {overall.done} / {overall.total}
            </span>
          </div>
          <div className="flex h-2 overflow-hidden rounded-sm border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-800">
            <div
              className="bg-emerald-500"
              style={{ width: `${overall.total > 0 ? (overall.done / overall.total) * 100 : 0}%` }}
              title={`완료 ${overall.done}`}
            />
            <div
              className="bg-amber-400"
              style={{
                width: `${overall.total > 0 ? (overall.pending / overall.total) * 100 : 0}%`,
              }}
              title={`미상담 ${overall.pending}`}
            />
          </div>
          <div className="mt-1 flex gap-2 text-[10px] text-zinc-500">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 border border-zinc-300 bg-emerald-500" />
              완료 {overall.done}
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 border border-zinc-300 bg-amber-400" />
              미상담 {overall.pending}
            </span>
          </div>
        </div>
      </aside>

      {/* ─── 우측 상세 ─── */}
      <main className="flex h-full min-w-0 flex-col overflow-hidden border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        {/* Header — 선택 선생님 + 월 + 요약 + 액션 (컴팩트 1라인 구성) */}
        <div className="flex flex-shrink-0 items-center gap-3 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] text-zinc-500 dark:text-zinc-500">
              학부모 상담 · {month}
              {!isAllView && selected.subject && <span className="ml-1">· {selected.subject}</span>}
            </div>
            <h2 className="mt-0.5 truncate text-sm font-bold text-zinc-900 dark:text-zinc-100">
              {isAllView ? "전체 담임 집계" : `${selected.name} 선생님 담당`}
              <span className="ml-2 inline-flex items-center gap-1.5 text-[11px] font-normal text-zinc-500">
                <span>담당 <b className="font-bold text-zinc-700 dark:text-zinc-300">{selected.total}</b>명</span>
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
                  완료율 <b className="font-bold text-blue-700 dark:text-blue-400">{selected.pct}%</b>
                </span>
              </span>
            </h2>
          </div>
        </div>

        {/* Filters — 상태 세그먼트 + 반명 칩 + 학생 검색 */}
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
          {/* 상태 세그먼트 */}
          <div className="inline-flex items-center rounded-sm bg-zinc-100 p-0.5 dark:bg-zinc-800">
            {(
              [
                ["all", "전체"],
                ["done", "완료"],
                ["pending", "미상담"],
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

          {/* 학생 검색 */}
          <div className="relative">
            <input
              type="text"
              value={studentSearch}
              onChange={(e) => setStudentSearch(e.target.value)}
              placeholder="학생 이름·학교 검색"
              className="h-6 w-44 rounded-sm border border-zinc-300 bg-white pl-5 pr-5 text-[11px] text-zinc-900 placeholder-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
            <svg
              className="pointer-events-none absolute left-1 top-1/2 h-2.5 w-2.5 -translate-y-1/2 text-zinc-400"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l3.817 3.817a1 1 0 01-1.414 1.414l-3.817-3.817A6 6 0 012 8z"
                clipRule="evenodd"
              />
            </svg>
            {studentSearch && (
              <button
                type="button"
                onClick={() => setStudentSearch("")}
                aria-label="검색어 지우기"
                className="absolute right-0.5 top-1/2 -translate-y-1/2 px-0.5 text-[10px] leading-none text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                ✕
              </button>
            )}
          </div>

          {/* 반명 드롭다운 — 특정 선생님 뷰에서만 */}
          {!isAllView && classOptions.length > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-zinc-500">반 :</span>
              <select
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
                className="h-6 max-w-[180px] rounded-sm border border-zinc-300 bg-white px-1.5 text-[11px] text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                title={`${selected.name} 선생님 담당 수업 (${classOptions.length}개)`}
              >
                <option value="all">전체 ({classOptions.length})</option>
                {classOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              {classFilter !== "all" && (
                <button
                  type="button"
                  onClick={() => setClassFilter("all")}
                  aria-label="반 필터 초기화"
                  className="text-[10px] leading-none text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                  title="반 필터 초기화"
                >
                  ✕
                </button>
              )}
            </div>
          )}

          {/* 과목 필터 칩 — 전체 담임 뷰 전용. 섹션 키 기반(수학/영어/…/복수/미지정) */}
          {isAllView && subjectBreakdown.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[10px] text-zinc-500">과목 :</span>
              <button
                type="button"
                onClick={() => setSubjectFilter("all")}
                className={`rounded-sm border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                  subjectFilter === "all"
                    ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950/50 dark:text-blue-300"
                    : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
                }`}
              >
                전체
              </button>
              {subjectBreakdown.map((sb) => {
                const active = subjectFilter === sb.key;
                const base = subjectBadgeClass(sb.key === "복수 과목" ? "수학/영어" : sb.key);
                return (
                  <button
                    key={sb.key}
                    type="button"
                    onClick={() => setSubjectFilter(sb.key)}
                    className={`rounded-sm border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                      active
                        ? `border-blue-500 ${base}`
                        : `border-transparent ${base} hover:brightness-95`
                    }`}
                    title={`${sb.key} · 담임 ${sb.teacherCount}명 · ${sb.done}/${sb.total} 완료`}
                  >
                    {sb.key} {sb.teacherCount}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 학생 테이블 */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
          <table className="w-full table-fixed text-xs">
            <colgroup>
              <col className="w-10" />
              <col className="w-12" />
              <col className="w-40" />
              <col className="w-24" />
              <col className="w-32" />
              <col className="w-24" />
              <col />
              <col className="w-8" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-zinc-100 dark:bg-zinc-800">
              <tr>
                <th className="border-b border-zinc-300 px-2 py-1.5 text-center font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                  #
                </th>
                <th className="border-b border-zinc-300 px-2 py-1.5 text-center font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                  상담
                </th>
                <th className="border-b border-zinc-300 px-2 py-1.5 text-left font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400 whitespace-nowrap">
                  {isAllView ? "담임" : "반명"}
                </th>
                <th className="border-b border-zinc-300 px-2 py-1.5 text-left font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                  학생
                </th>
                <th className="border-b border-zinc-300 px-2 py-1.5 text-left font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400 whitespace-nowrap">
                  학교·학년
                </th>
                <th className="border-b border-zinc-300 px-2 py-1.5 text-left font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400 whitespace-nowrap">
                  마지막 상담일
                </th>
                <th className="border-b border-zinc-300 px-2 py-1.5 text-left font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                  상담 제목
                </th>
                <th className="w-8 border-b border-zinc-300 px-1 py-1.5 dark:border-zinc-700"></th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((r, i) => {
                const idx = (page - 1) * pageSize + i + 1;
                const isPending = r.status === "pending";
                const c = r.consultation;
                return (
                  <tr
                    key={r.key}
                    className={`h-8 cursor-pointer border-b border-zinc-100 transition-colors dark:border-zinc-800 ${
                      isPending
                        ? "bg-amber-50/20 hover:bg-amber-50/40 dark:bg-amber-950/10 dark:hover:bg-amber-950/20"
                        : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                    }`}
                    onClick={() => setModalRowKey(r.key)}
                  >
                    <td className="px-2 py-1 text-center text-[10px] tabular-nums text-zinc-400">
                      {String(idx).padStart(2, "0")}
                    </td>
                    <td className="px-2 py-1 text-center">
                      {r.status === "done" ? (
                        <span
                          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-[11px] font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                          title="상담 완료"
                        >
                          ✓
                        </span>
                      ) : (
                        <span
                          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-[11px] font-bold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                          title="미상담"
                        >
                          !
                        </span>
                      )}
                    </td>
                    <td className="overflow-hidden px-2 py-1 whitespace-nowrap">
                      {isAllView ? (
                        r.homeroomNames.length > 0 ? (
                          <span
                            className="inline-block max-w-full truncate align-middle text-[10px] font-medium text-zinc-700 dark:text-zinc-300"
                            title={r.homeroomNames.join(", ")}
                          >
                            {r.homeroomNames.map((hr, i) => {
                              const subj = subjectByTeacher.get(hr) || "";
                              const cls = subjectBadgeClass(subj);
                              return (
                                <span
                                  key={hr}
                                  className={`mr-0.5 inline-block rounded-sm px-1 py-0.5 text-[10px] font-medium ${cls}`}
                                >
                                  {hr}
                                  {i < r.homeroomNames.length - 1 ? "" : ""}
                                </span>
                              );
                            })}
                          </span>
                        ) : (
                          <span className="text-[10px] text-zinc-400">—</span>
                        )
                      ) : r.className ? (
                        <span
                          className="inline-block max-w-full truncate rounded-sm bg-zinc-100 px-1.5 py-0.5 align-middle text-[10px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                          title={r.className}
                        >
                          {r.className}
                        </span>
                      ) : (
                        <span className="text-[10px] text-zinc-400">—</span>
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
                      title={formatSchoolGrade(r.student.school, r.student.grade)}
                    >
                      {formatSchoolGrade(r.student.school, r.student.grade)}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">
                      {c ? (
                        <span className="tabular-nums text-zinc-700 dark:text-zinc-300">
                          {c.date.slice(5).replace("-", "/")}
                        </span>
                      ) : (
                        <span className="text-[11px] text-amber-700 dark:text-amber-400">
                          이달 상담 필요
                        </span>
                      )}
                    </td>
                    <td
                      className={`truncate px-2 py-1 ${c ? "text-zinc-700 dark:text-zinc-300" : "text-zinc-400"}`}
                      title={c?.title || ""}
                    >
                      {c?.title || "—"}
                    </td>
                    <td className="px-1 py-1 text-center">
                      <span className="inline-block text-[11px] text-zinc-400" aria-hidden="true">
                        ▶
                      </span>
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
                  <td colSpan={8} />
                </tr>
              ))}
              {filteredRows.length === 0 && studentSearch.trim() && (
                <tr className="pointer-events-none">
                  <td colSpan={8} className="px-2 py-3 text-center text-[11px] text-zinc-500">
                    &quot;{studentSearch.trim()}&quot; 검색 결과가 없습니다
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
              : `${(page - 1) * pageSize + 1}–${Math.min(
                  page * pageSize,
                  filteredRows.length
                )} / ${filteredRows.length}명`}
          </span>
          {totalPages > 1 ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                aria-label="이전 페이지"
                className="px-1 text-zinc-500 hover:text-zinc-900 disabled:opacity-30 dark:hover:text-zinc-100"
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
                aria-label="다음 페이지"
                className="px-1 text-zinc-500 hover:text-zinc-900 disabled:opacity-30 dark:hover:text-zinc-100"
              >
                ▶
              </button>
            </div>
          ) : (
            <span className="text-zinc-400">한 페이지</span>
          )}
        </div>
      </main>

      {/* 상담 상세 모달 — 행 클릭 시 열림 */}
      {modalRowKey &&
        (() => {
          const r = filteredRows.find((row) => row.key === modalRowKey);
          if (!r) return null;
          return <ConsultationModal row={r} month={month} onClose={() => setModalRowKey(null)} />;
        })()}
    </div>
  );
}

// 상담 상세 모달 — 선택된 이벤트 행을 중앙 오버레이로 표시
function ConsultationModal({
  row,
  month,
  onClose,
}: {
  row: {
    student: Student;
    className: string;
    homeroomNames: string[];
    status: "done" | "pending";
    consultation: Consultation | null;
    allConsultations: Consultation[];
  };
  month: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 이전 월 이력 — 모달 열릴 때 API 호출, 월 변경되면 재조회.
  const [pastHistory, setPastHistory] = useState<Consultation[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const studentId = row.student.id;
    const url = `/api/consultations/student-history?studentId=${encodeURIComponent(
      studentId
    )}&beforeMonth=${encodeURIComponent(month)}&limit=10`;
    setHistoryLoading(true);
    setHistoryError(false);
    (async () => {
      try {
        const data = await cachedFetch<Consultation[]>(url);
        if (!cancelled) setPastHistory(data);
      } catch (e) {
        console.error("[student-history]", e);
        if (!cancelled) setHistoryError(true);
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [row.student.id, month]);

  const c = row.consultation;
  const otherHistory = c
    ? row.allConsultations.filter((x) => x.id !== c.id).slice(0, 5)
    : row.allConsultations.slice(0, 5);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/50 p-4 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-[720px] max-w-full flex-col rounded-sm border border-zinc-300 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
      >
        {/* 헤더 */}
        <div className="flex flex-shrink-0 items-start gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
              {row.className && (
                <span className="rounded-sm bg-zinc-100 px-1.5 py-0.5 font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {row.className}
                </span>
              )}
              {!row.className && row.homeroomNames.length > 0 && (
                <span className="rounded-sm bg-zinc-100 px-1.5 py-0.5 font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  담임 {row.homeroomNames.join(", ")}
                </span>
              )}
              <span>
                {formatSchoolGrade(row.student.school, row.student.grade)}
              </span>
              {row.status === "done" ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                  ✓ 완료
                </span>
              ) : (
                <span className="rounded-full bg-amber-100 px-2 py-0 text-[10px] font-bold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                  ! 미상담
                </span>
              )}
            </div>
            <h3 className="mt-0.5 text-lg font-bold text-zinc-900 dark:text-zinc-100">
              {row.student.name}
              {c && (
                <span className="ml-2 text-sm font-normal text-zinc-500">
                  · {c.title}
                </span>
              )}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="flex-shrink-0 rounded-sm border border-transparent px-2 py-1 text-base leading-none text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            ✕
          </button>
        </div>

        {/* 본문 */}
        <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
          {c ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                <span className="tabular-nums">{c.date}</span>
                {c.time && <span className="tabular-nums">· {c.time}</span>}
                <span>
                  · {c.type === "parent" ? "학부모" : "학생"}
                  {c.parentName ? ` (${c.parentName}${c.parentRelation ? " " + c.parentRelation : ""})` : ""}
                </span>
                {c.consultantName && <span>· 상담자 {c.consultantName}</span>}
              </div>
              <div className="mt-3 whitespace-pre-wrap rounded-sm bg-zinc-50 px-3 py-2 text-sm leading-relaxed text-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-200">
                {c.content || <span className="text-zinc-400">내용 없음</span>}
              </div>
            </>
          ) : (
            <div className="rounded-sm border border-dashed border-amber-300 bg-amber-50/50 px-3 py-4 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              이달에 {row.student.name} 학생 상담 기록이 없습니다. ijw-calander에서 새 상담을 입력하면 여기에 표시됩니다.
            </div>
          )}

          {/* 이 학생의 다른 상담 (당월 내) */}
          <div className="mt-5">
            <div className="mb-1.5 text-[11px] font-medium text-zinc-500">
              이 학생의 이달 다른 상담 · {otherHistory.length}건
            </div>
            {otherHistory.length === 0 ? (
              <div className="text-[11px] text-zinc-400">이달 내 다른 상담 없음</div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {otherHistory.map((h) => (
                  <div
                    key={h.id}
                    className="flex items-baseline gap-2 border-l-2 border-zinc-200 pl-2 dark:border-zinc-700"
                  >
                    <span className="w-20 flex-shrink-0 text-[11px] tabular-nums text-zinc-500">
                      {h.date.slice(5).replace("-", "/")}
                    </span>
                    <span className="truncate text-xs text-zinc-700 dark:text-zinc-300">
                      {h.title}
                    </span>
                    <span className="ml-auto flex-shrink-0 text-[10px] text-zinc-400">
                      {h.type === "parent" ? "학부모" : "학생"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 이전 월 이력 — API 조회, 최대 10건 */}
          <div className="mt-5">
            <div className="mb-1.5 flex items-baseline gap-2">
              <span className="text-[11px] font-medium text-zinc-500">
                이전 월 상담 이력
                {pastHistory && ` · ${pastHistory.length}건`}
                {pastHistory && pastHistory.length >= 10 && (
                  <span className="ml-1 text-[10px] text-zinc-400">(최근 10건)</span>
                )}
              </span>
            </div>
            {historyLoading ? (
              <div className="text-[11px] text-zinc-400">불러오는 중…</div>
            ) : historyError ? (
              <div className="text-[11px] text-red-500">이력 조회 실패</div>
            ) : !pastHistory || pastHistory.length === 0 ? (
              <div className="text-[11px] text-zinc-400">이전 월 상담 기록 없음</div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {pastHistory.map((h) => (
                  <div
                    key={h.id}
                    className="flex items-baseline gap-2 border-l-2 border-blue-200 pl-2 dark:border-blue-900"
                  >
                    <span className="w-24 flex-shrink-0 text-[11px] tabular-nums text-zinc-500">
                      {h.date}
                    </span>
                    <span className="truncate text-xs text-zinc-700 dark:text-zinc-300">
                      {h.title}
                    </span>
                    <span className="ml-auto flex-shrink-0 text-[10px] text-zinc-400">
                      {h.type === "parent" ? "학부모" : "학생"}
                      {h.consultantName ? ` · ${h.consultantName}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 푸터 */}
        <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-zinc-200 px-4 py-2 dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-zinc-300 bg-white px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            닫기 <span className="ml-1 text-[10px] text-zinc-400">(Esc)</span>
          </button>
        </div>
      </div>
    </div>
  );
}

