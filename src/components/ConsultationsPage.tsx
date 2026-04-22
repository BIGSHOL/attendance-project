"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useStaff } from "@/hooks/useStaff";
import { useStudents } from "@/hooks/useStudents";
import { useConsultations } from "@/hooks/useConsultations";
import { toSubjectLabel } from "@/lib/labelMap";
import HomeroomPicker, { SUBJECT_PREFIX } from "@/components/consultation/HomeroomPicker";
import ConsultationDetailModal from "@/components/consultation/ConsultationDetailModal";
import ConsultationSettings from "@/components/consultation/ConsultationSettings";
import ConsultationsPageV2 from "@/components/consultation/ConsultationsPageV2";
import { useUserRole } from "@/hooks/useUserRole";
import { useHiddenTeachers } from "@/hooks/useHiddenTeachers";
import { Skeleton, SkeletonKpi, SkeletonTable } from "@/components/ui/Skeleton";
import type { Student, Teacher, Consultation } from "@/types";

// ─── 헬퍼 ───────────────────────────────────────────

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

/**
 * enrollment가 해당 월 범위 내에 active 상태인지 판정
 *   startDate <= 월말 && (endDate 없음 || endDate >= 월초)
 *   날짜 없으면 active 처리 (ijw-calander의 "재원중" 표시와 일관)
 */
function isEnrollmentActiveInMonth(
  e: { startDate?: string; endDate?: string },
  monthStart: string,
  monthEnd: string
): boolean {
  if (e.startDate && e.startDate > monthEnd) return false;
  if (e.endDate && e.endDate < monthStart) return false;
  return true;
}

/**
 * 임의 문자열(ID / name / englishName / "한글(영어)" 등)에서 staff 객체를 찾아
 * canonical name (staff.name) 을 반환. 실패 시 원본 문자열.
 *   - "박나연(Jenny)" 와 "Jenny" 같은 다른 표기를 한 선생님으로 통합하기 위해
 */
function resolveCanonicalTeacherName(
  raw: string | undefined,
  staffByKey: Map<string, Teacher>
): string | null {
  if (!raw) return null;
  // 직접 매칭
  const direct = staffByKey.get(raw);
  if (direct) return direct.name;
  // alias 파싱 후 각각 시도
  for (const alias of extractNameAliases(raw)) {
    const hit = staffByKey.get(alias);
    if (hit) return hit.name;
  }
  return raw; // staff 에 없는 이름이면 그대로
}

/**
 * 학생의 수업 담당 선생님 전체 목록 (canonical name 기준, 중복 제거)
 *   ijw-calander의 "담당" 개념과 일치 — 한 학생이 수학/영어 등 과목별로 여러 선생님 가짐
 *   onHold 는 무시 (ijw-calander UI에선 "재원중"으로 표시되는 케이스 존재)
 *   월 범위를 벗어난 enrollment만 제외
 *   enrollment.teacher 에 "박나연(Jenny)" / "Jenny" 처럼 다른 표기가 섞여 있어도
 *   staff 의 canonical name 으로 통합
 */
function getTeachersOfStudent(
  student: Student,
  staffByKey: Map<string, Teacher>,
  monthStart: string,
  monthEnd: string
): string[] {
  if (!student.enrollments || student.enrollments.length === 0) return [];
  const names = new Set<string>();
  for (const e of student.enrollments) {
    if (!isEnrollmentActiveInMonth(e, monthStart, monthEnd)) continue;
    const canonical =
      resolveCanonicalTeacherName(e.staffId, staffByKey) ??
      resolveCanonicalTeacherName(e.teacher, staffByKey);
    if (canonical) names.add(canonical);
  }
  return Array.from(names);
}

/**
 * 이름 문자열에서 가능한 모든 표기 추출
 *   "정유진(Yoojin)" → ["정유진(Yoojin)", "정유진", "Yoojin"]
 *   "Yoojin" → ["Yoojin"]
 *   "정유진" → ["정유진"]
 */
function extractNameAliases(raw: string): string[] {
  const s = (raw ?? "").trim();
  if (!s) return [];
  const result = new Set<string>([s]);
  // "한글(영어)" 또는 "영어(한글)" 패턴
  const m = s.match(/^(.+?)\s*\(\s*(.+?)\s*\)$/);
  if (m) {
    result.add(m[1].trim());
    result.add(m[2].trim());
  }
  // 괄호 내부만 있는 경우 제거한 버전
  const stripped = s.replace(/\s*\([^)]*\)\s*/g, "").trim();
  if (stripped) result.add(stripped);
  return Array.from(result);
}

/**
 * 상담자 이름(ijw-calander 포맷 포함)이 특정 선생님과 일치하는지
 *   - "정유진(Yoojin)" 상담자 vs teacher.name="Yoojin" / englishName=undefined → 매치
 *   - "Sarah" vs teacher.name="강보경" / englishName="Sarah" → 매치
 *   - 정확 일치, 괄호 안/밖 모두 고려
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

function consultationSubjectLabel(c: Consultation): string {
  return c.subject ? toSubjectLabel(c.subject) : "-";
}

type Tab = "consultation" | "note" | "v2";
const ALL_TEACHERS = "__all__";

// ─── 컴포넌트 ───────────────────────────────────────

export default function ConsultationsPage() {
  const [activeTab, setActiveTab] = useLocalStorage<Tab>(
    "consultations.activeTab",
    "consultation"
  );

  const defaultMonth = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }, []);

  const [selectedMonth, setSelectedMonth] = useLocalStorage<string>(
    "consultations.selectedMonth",
    defaultMonth
  );

  const [selectedHomeroomRaw, setSelectedHomeroom] = useLocalStorage<string>(
    "consultations.selectedHomeroom",
    ALL_TEACHERS
  );

  // 상담 상세 팝업 선택 상태
  const [selectedConsultation, setSelectedConsultation] = useState<Consultation | null>(null);

  const { userRole, isTeacher, isAdmin } = useUserRole();
  const { hiddenTeacherIds, toggleHidden } = useHiddenTeachers();
  const [hideUnassignedSubject, setHideUnassignedSubject] = useLocalStorage<boolean>(
    "consultations.hideUnassignedSubject",
    false
  );
  // 학생 상담 현황 테이블 — 학생 이름 검색 (localStorage 영속화)
  const [studentSearch, setStudentSearch] = useLocalStorage<string>(
    "consultations.studentSearch",
    ""
  );
  const { teachers, loading: staffLoading } = useStaff();
  const { students, loading: studentsLoading } = useStudents();
  const { consultations, loading: consultationsLoading } = useConsultations(selectedMonth);

  // 선생님 계정이면 본인으로 고정 (localStorage 값 무시)
  const selectedHomeroom = useMemo(() => {
    if (isTeacher && userRole?.staff_name) {
      return userRole.staff_name;
    }
    return selectedHomeroomRaw;
  }, [isTeacher, userRole, selectedHomeroomRaw]);

  const loading = staffLoading || studentsLoading || consultationsLoading;

  // staff 빠른 조회 맵 (staffId/이름 다 키로)
  const staffByKey = useMemo(() => {
    const m = new Map<string, Teacher>();
    for (const t of teachers) {
      m.set(t.id, t);
      m.set(t.name, t);
      if (t.englishName) m.set(t.englishName, t);
    }
    return m;
  }, [teachers]);

  // 학생 ID → 학생 매핑
  const studentById = useMemo(() => {
    const m = new Map<string, Student>();
    for (const s of students) m.set(s.id, s);
    return m;
  }, [students]);

  // 선택된 월의 시작/종료 날짜 (enrollment active 판정용)
  const monthBounds = useMemo(() => {
    const [y, m] = selectedMonth.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    return {
      start: `${selectedMonth}-01`,
      end: `${selectedMonth}-${String(last).padStart(2, "0")}`,
    };
  }, [selectedMonth]);

  // 학생 ID → 담당 선생님 배열 (한 학생이 여러 과목이면 여러 선생님)
  const teachersByStudent = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of students) {
      const list = getTeachersOfStudent(s, staffByKey, monthBounds.start, monthBounds.end);
      if (list.length > 0) m.set(s.id, list);
    }
    return m;
  }, [students, staffByKey, monthBounds]);

  // 담임별 학생 목록 (active만) — 학생은 여러 담임 아래 중복 등록 가능
  const studentsByHomeroom = useMemo(() => {
    const m = new Map<string, Student[]>();
    for (const s of students) {
      if (s.status !== "active") continue;
      const teachers = teachersByStudent.get(s.id) ?? [];
      for (const t of teachers) {
        if (!m.has(t)) m.set(t, []);
        m.get(t)!.push(s);
      }
    }
    return m;
  }, [students, teachersByStudent]);

  // 담임 목록 (담임 학생이 1명 이상인 선생님만)
  const homerooms = useMemo(() => {
    const result = Array.from(studentsByHomeroom.keys())
      .map((name) => {
        const teacher = staffByKey.get(name);
        return { name, teacher };
      })
      // 설정에서 숨김 처리한 선생님 제외
      .filter(({ teacher }) => !(teacher && hiddenTeacherIds.has(teacher.id)))
      .map(({ name, teacher }) => {
        const subjects = teacher?.subjects ?? [];
        const subjectLabel = subjects.length > 0 ? subjects.map(toSubjectLabel).join("/") : "";
        return {
          name,
          subject: subjectLabel,
          studentCount: studentsByHomeroom.get(name)?.length ?? 0,
        };
      })
      // 과목 미지정 선생님 일괄 숨김 옵션
      .filter((h) => !(hideUnassignedSubject && !h.subject));
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }, [studentsByHomeroom, staffByKey, hiddenTeacherIds, hideUnassignedSubject]);

  const isAllView = selectedHomeroom === ALL_TEACHERS;
  const isSubjectView = selectedHomeroom.startsWith(SUBJECT_PREFIX);
  const selectedSubject = isSubjectView
    ? selectedHomeroom.slice(SUBJECT_PREFIX.length)
    : "";

  // 과목 뷰에서 대상이 되는 담임 이름 목록
  const subjectTeacherNames = useMemo(() => {
    if (!isSubjectView) return [] as string[];
    return homerooms
      .filter((h) => h.subject === selectedSubject)
      .map((h) => h.name);
  }, [isSubjectView, selectedSubject, homerooms]);

  // 담임 필터 적용한 scoped 학생 목록
  //   - 전체 뷰: 한 학생이 여러 담임 아래에 있어도 1번만 (unique by id)
  //   - 과목 뷰: 해당 과목 담임들의 학생 합집합 (unique)
  //   - 특정 담임: 그 담임 학생들만
  const scopedStudents = useMemo(() => {
    if (isAllView) {
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
    if (isSubjectView) {
      const seen = new Set<string>();
      const out: Student[] = [];
      for (const name of subjectTeacherNames) {
        for (const s of studentsByHomeroom.get(name) ?? []) {
          if (seen.has(s.id)) continue;
          seen.add(s.id);
          out.push(s);
        }
      }
      return out;
    }
    return studentsByHomeroom.get(selectedHomeroom) ?? [];
  }, [isAllView, isSubjectView, selectedHomeroom, subjectTeacherNames, studentsByHomeroom]);

  // 담임 필터 적용한 상담 목록
  //   - 전체 뷰: 모든 상담
  //   - 과목 뷰: 해당 과목 담임들이 한 상담만 (학생 × 상담자 교집합)
  //   - 특정 담임: 담임 학생 × 상담자 === 담임
  const scopedStudentIds = useMemo(
    () => new Set(scopedStudents.map((s) => s.id)),
    [scopedStudents]
  );

  const scopedConsultations = useMemo(() => {
    if (isAllView) return consultations;

    if (isSubjectView) {
      // 해당 과목 담임들의 staff 객체 & alias 집합
      const teacherObjs = subjectTeacherNames
        .map((n) => staffByKey.get(n))
        .filter((t): t is Teacher => !!t);
      const nameLowerAliases = new Set(
        subjectTeacherNames.flatMap((n) =>
          extractNameAliases(n).map((x) => x.toLowerCase())
        )
      );
      return consultations.filter((c) => {
        if (!scopedStudentIds.has(c.studentId)) return false;
        if (teacherObjs.some((t) => matchesTeacher(c.consultantName, t))) return true;
        // fallback alias 비교
        return extractNameAliases(c.consultantName ?? "")
          .map((n) => n.toLowerCase())
          .some((x) => nameLowerAliases.has(x));
      });
    }

    const teacher = staffByKey.get(selectedHomeroom);
    return consultations.filter(
      (c) =>
        scopedStudentIds.has(c.studentId) &&
        (matchesTeacher(c.consultantName, teacher) ||
          // 선생님 정보가 staff에 없을 경우 이름 alias fallback
          extractNameAliases(selectedHomeroom)
            .map((n) => n.toLowerCase())
            .some((n) =>
              extractNameAliases(c.consultantName ?? "")
                .map((x) => x.toLowerCase())
                .includes(n)
            ))
    );
  }, [consultations, isAllView, isSubjectView, selectedHomeroom, subjectTeacherNames, scopedStudentIds, staffByKey]);

  // 일자별 상담 수 집계
  const consultationsByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of scopedConsultations) {
      map.set(c.date, (map.get(c.date) ?? 0) + 1);
    }
    return map;
  }, [scopedConsultations]);

  // 학생별 상담 집계 (횟수 + 날짜 목록)
  const matrixByStudent = useMemo(() => {
    const result = new Map<string, { dates: string[]; lastDate: string | null; total: number }>();
    for (const s of scopedStudents) {
      result.set(s.id, { dates: [], lastDate: null, total: 0 });
    }
    for (const c of scopedConsultations) {
      const bucket = result.get(c.studentId);
      if (!bucket) continue;
      bucket.dates.push(c.date);
      bucket.total += 1;
      if (!bucket.lastDate || c.date > bucket.lastDate) bucket.lastDate = c.date;
    }
    for (const b of result.values()) b.dates.sort();
    return result;
  }, [scopedStudents, scopedConsultations]);

  // 미상담 먼저, 그다음 이름 오름차순
  const sortedStudents = useMemo(() => {
    return [...scopedStudents].sort((a, b) => {
      const ta = matrixByStudent.get(a.id)?.total ?? 0;
      const tb = matrixByStudent.get(b.id)?.total ?? 0;
      if (ta === 0 && tb !== 0) return -1;
      if (tb === 0 && ta !== 0) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [scopedStudents, matrixByStudent]);

  // 학생 이름 검색 필터 적용 — 공백/대소문자 무시 substring 매칭
  const searchedStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    if (!q) return sortedStudents;
    return sortedStudents.filter((s) => {
      const name = (s.name || "").toLowerCase();
      const grade = (s.grade || "").toLowerCase();
      const school = (s.school || "").toLowerCase();
      return name.includes(q) || grade.includes(q) || school.includes(q);
    });
  }, [sortedStudents, studentSearch]);

  // 학생 목록 페이지네이션: 페이지 크기 = 월 일수 (좌측 날짜 행 수와 일치)
  const pageSize = useMemo(() => {
    const [y, m] = selectedMonth.split("-").map(Number);
    return new Date(y, m, 0).getDate();
  }, [selectedMonth]);
  const [studentsPage, setStudentsPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(searchedStudents.length / pageSize));

  useEffect(() => {
    // 월/담임/과목/검색어 바뀌면 1페이지로 리셋
    setStudentsPage(1);
  }, [selectedMonth, selectedHomeroom, studentSearch]);

  useEffect(() => {
    // 현재 페이지가 전체 페이지 초과 시 조정
    if (studentsPage > totalPages) setStudentsPage(totalPages);
  }, [studentsPage, totalPages]);

  const pagedStudents = useMemo(
    () => searchedStudents.slice((studentsPage - 1) * pageSize, studentsPage * pageSize),
    [searchedStudents, studentsPage, pageSize]
  );

  const totalConsultations = scopedConsultations.length;
  const counseledStudentIds = new Set(scopedConsultations.map((c) => c.studentId));
  const uncounseledCount = scopedStudents.length - counseledStudentIds.size;
  const heavyCounseledCount = Array.from(matrixByStudent.values()).filter(
    (b) => b.total >= 3
  ).length;

  // ─── 좌우 높이 동기화 ─────────────────────────────
  //   좌측(날짜) = 자연 높이 기준, 우측(학생) = 좌측 높이로 제한
  //   학생이 많으면 우측만 내부 스크롤
  const leftRef = useRef<HTMLElement>(null);
  const [leftHeight, setLeftHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = leftRef.current;
    if (!el) return;
    const update = () => setLeftHeight(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 담임별 요약 (전체 뷰에서만 사용)
  //   - 각 담임의 "자기 학생을 자기가 상담" 기준
  //   - consultantName은 "정유진(Yoojin)" 같은 포맷 가능 → matchesTeacher로 유연 매칭
  const homeroomSummaries = useMemo(() => {
    return homerooms.map((h) => {
      const hrStudents = studentsByHomeroom.get(h.name) ?? [];
      const idSet = new Set(hrStudents.map((s) => s.id));
      const teacher = staffByKey.get(h.name);
      const nameLowered = h.name.toLowerCase();
      const cs = consultations.filter((c) => {
        if (!idSet.has(c.studentId)) return false;
        if (matchesTeacher(c.consultantName, teacher)) return true;
        // fallback: alias 비교
        return extractNameAliases(c.consultantName ?? "")
          .map((n) => n.toLowerCase())
          .includes(nameLowered);
      });
      const counseled = new Set(cs.map((c) => c.studentId));
      const heavy = hrStudents.filter(
        (s) => cs.filter((c) => c.studentId === s.id).length >= 3
      ).length;
      return {
        name: h.name,
        subject: h.subject,
        studentCount: hrStudents.length,
        consultationCount: cs.length,
        counseledCount: counseled.size,
        uncounseledCount: hrStudents.length - counseled.size,
        heavyCount: heavy,
      };
    });
  }, [homerooms, studentsByHomeroom, consultations]);

  // 과목 뷰면 해당 과목 담임만, 아니면 전체
  const visibleSummaries = useMemo(
    () =>
      isSubjectView
        ? homeroomSummaries.filter((h) => h.subject === selectedSubject)
        : homeroomSummaries,
    [homeroomSummaries, isSubjectView, selectedSubject]
  );

  // 담임별 요약 합계 (표 하단 행)
  const summaryTotals = useMemo(() => {
    return visibleSummaries.reduce(
      (acc, h) => {
        acc.studentCount += h.studentCount;
        acc.consultationCount += h.consultationCount;
        acc.counseledCount += h.counseledCount;
        acc.uncounseledCount += h.uncounseledCount;
        acc.heavyCount += h.heavyCount;
        return acc;
      },
      { studentCount: 0, consultationCount: 0, counseledCount: 0, uncounseledCount: 0, heavyCount: 0 }
    );
  }, [visibleSummaries]);

  const selectedTeacher = !isAllView ? staffByKey.get(selectedHomeroom) : undefined;
  const currentSubjectLabel = selectedTeacher
    ? selectedTeacher.subjects.map(toSubjectLabel).join("/")
    : "";

  const monthDays = daysInMonth(selectedMonth);
  const [y, m] = selectedMonth.split("-");
  const monthLabel = `${y.slice(2)}년 ${parseInt(m)}월`;

  return (
    <div className="mx-auto max-w-[1400px]">
      {/* 상단 바: 탭 + 담임 + 월 */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">상담 관리</h2>
          {!isAllView && selectedHomeroom && (
            <span className="rounded-sm bg-blue-100 text-blue-700 text-[11px] font-bold px-2 py-0.5 dark:bg-blue-900/40 dark:text-blue-300">
              {selectedHomeroom}
              {currentSubjectLabel && ` · ${currentSubjectLabel}`}
            </span>
          )}
          {loading && (
            <span className="text-[11px] text-zinc-400">불러오는 중…</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-sm border border-zinc-200 bg-zinc-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-800">
            <button
              onClick={() => setActiveTab("consultation")}
              className={`rounded-sm px-3 py-1 text-xs font-bold transition-all ${
                activeTab === "consultation"
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              상담 현황
            </button>
            <button
              onClick={() => setActiveTab("note")}
              className={`rounded-sm px-3 py-1 text-xs font-bold transition-all ${
                activeTab === "note"
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              노트 검사
            </button>
            <button
              onClick={() => setActiveTab("v2")}
              className={`rounded-sm px-3 py-1 text-xs font-bold transition-all ${
                activeTab === "v2"
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
              title="V2 레이아웃 파일럿 — 좌측 선생님 레일 + 우측 상세"
            >
              상담 V2
            </button>
          </div>

          {isTeacher ? (
            // 선생님 계정은 본인으로 고정 — 드롭다운 대신 라벨 표시
            <div className="flex min-w-[200px] items-center gap-1.5 rounded-sm border border-zinc-300 bg-zinc-50 px-2.5 py-1.5 text-xs font-bold text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
              <span>{selectedHomeroom}</span>
              <span className="font-normal text-zinc-500 dark:text-zinc-400">· 본인 상담만</span>
            </div>
          ) : (
            <HomeroomPicker
              homerooms={homerooms}
              selected={selectedHomeroom}
              onChange={setSelectedHomeroom}
              allValue={ALL_TEACHERS}
            />
          )}

          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="rounded-sm border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />

          {/* 관리자+: 담임 목록 표시 설정 */}
          {isAdmin && (
            <ConsultationSettings
              teachers={teachers}
              hiddenTeacherIds={hiddenTeacherIds}
              onToggle={toggleHidden}
              hideUnassigned={hideUnassignedSubject}
              onToggleUnassigned={() => setHideUnassignedSubject((v) => !v)}
            />
          )}
        </div>
      </div>

      {/* ─── 탭: 상담 V2 (파일럿) ─── */}
      {activeTab === "v2" && (
        <ConsultationsPageV2
          month={selectedMonth}
          teachers={teachers}
          students={students}
          consultations={consultations}
          homerooms={homerooms}
          studentsByHomeroom={studentsByHomeroom}
          hiddenTeacherIds={hiddenTeacherIds}
          selectedHomeroom={selectedHomeroom}
          setSelectedHomeroom={setSelectedHomeroom}
          loading={loading}
          isAllView={isAllView}
        />
      )}

      {/* ─── 탭: 상담 현황 ─── */}
      {activeTab === "consultation" && loading && homerooms.length === 0 && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonKpi key={i} />
            ))}
          </div>
          <SkeletonTable rows={6} cols={8} />
          <div className="grid grid-cols-[200px_1fr] gap-3">
            <SkeletonTable rows={15} cols={2} />
            <SkeletonTable rows={10} cols={6} />
          </div>
        </div>
      )}
      {activeTab === "consultation" && !(loading && homerooms.length === 0) && (
        <>
          {/* KPI 카드 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
            <KpiCard
              label={isAllView ? "총 상담 건수 (전체)" : `${selectedHomeroom} 상담 건수`}
              value={`${totalConsultations}건`}
            />
            <KpiCard
              label={isAllView ? "담당 학생 총합" : `${selectedHomeroom} 담당 학생`}
              value={`${scopedStudents.length}명`}
            />
            <KpiCard
              label="미상담 학생"
              value={`${uncounseledCount}명`}
              tone={uncounseledCount > 0 ? "warn" : "neutral"}
            />
            <KpiCard
              label="3회 이상 집중 상담"
              value={`${heavyCounseledCount}명`}
              tone={heavyCounseledCount > 0 ? "alert" : "neutral"}
            />
          </div>

          {/* 담임별 요약 (전체 뷰에서만) */}
          {(isAllView || isSubjectView) && homeroomSummaries.length > 0 && (
            <section className="mb-3 border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <div className="border-b border-zinc-200 bg-zinc-50 px-3 py-1.5 text-[11px] font-bold text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
                담임별 상담 현황 ({monthLabel})
                {isSubjectView && (
                  <span className="ml-2 font-normal text-zinc-500">· {selectedSubject} 과목</span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-zinc-100 dark:bg-zinc-800">
                    <tr>
                      <th className="border-b border-zinc-200 px-3 py-1.5 text-left font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400 whitespace-nowrap">
                        담임
                      </th>
                      <th className="border-b border-zinc-200 px-3 py-1.5 text-left font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400 whitespace-nowrap">
                        과목
                      </th>
                      <th className="border-b border-zinc-200 px-3 py-1.5 text-right font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400 whitespace-nowrap">
                        담당 학생
                      </th>
                      <th className="border-b border-zinc-200 px-3 py-1.5 text-right font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400 whitespace-nowrap">
                        총 상담 건수
                      </th>
                      <th className="border-b border-zinc-200 px-3 py-1.5 text-right font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400 whitespace-nowrap">
                        상담 학생
                      </th>
                      <th className="border-b border-zinc-200 px-3 py-1.5 text-right font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400 whitespace-nowrap">
                        미상담
                      </th>
                      <th className="border-b border-zinc-200 px-3 py-1.5 text-right font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400 whitespace-nowrap">
                        3회 이상
                      </th>
                      <th className="border-b border-zinc-200 px-3 py-1.5 text-right font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400 whitespace-nowrap">
                        상세
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleSummaries.map((h) => {
                      const coverageRate =
                        h.studentCount > 0
                          ? Math.round((h.counseledCount / h.studentCount) * 100)
                          : 0;
                      return (
                        <tr
                          key={h.name}
                          className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                        >
                          <td className="px-3 py-1.5 font-bold text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                            {h.name}
                          </td>
                          <td className="px-3 py-1.5 whitespace-nowrap">
                            {h.subject ? (
                              <span className="inline-block rounded-sm bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                                {h.subject}
                              </span>
                            ) : (
                              <span className="text-zinc-300">—</span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                            {h.studentCount}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums font-bold text-blue-600 dark:text-blue-400">
                            {h.consultationCount}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                            {h.counseledCount}
                            <span className="text-[10px] text-zinc-400 ml-1">
                              ({coverageRate}%)
                            </span>
                          </td>
                          <td
                            className={`px-3 py-1.5 text-right tabular-nums ${
                              h.uncounseledCount > 0
                                ? "font-bold text-amber-600 dark:text-amber-400"
                                : "text-zinc-400"
                            }`}
                          >
                            {h.uncounseledCount}
                          </td>
                          <td
                            className={`px-3 py-1.5 text-right tabular-nums ${
                              h.heavyCount > 0
                                ? "font-bold text-red-600 dark:text-red-400"
                                : "text-zinc-400"
                            }`}
                          >
                            {h.heavyCount}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <button
                              onClick={() => setSelectedHomeroom(h.name)}
                              className="text-[10px] rounded-sm border border-zinc-300 bg-white px-2 py-0.5 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
                            >
                              열기 →
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-zinc-100 dark:bg-zinc-800">
                    <tr className="border-t-2 border-zinc-300 dark:border-zinc-700">
                      <td
                        colSpan={2}
                        className="px-3 py-1.5 font-bold text-zinc-900 dark:text-zinc-100"
                      >
                        합계
                        <span className="ml-1 text-[10px] font-normal text-zinc-500">
                          ({visibleSummaries.length}명)
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-bold text-zinc-800 dark:text-zinc-200">
                        {summaryTotals.studentCount}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-bold text-blue-600 dark:text-blue-400">
                        {summaryTotals.consultationCount}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-bold text-zinc-800 dark:text-zinc-200">
                        {summaryTotals.counseledCount}
                        {summaryTotals.studentCount > 0 && (
                          <span className="text-[10px] font-normal text-zinc-500 ml-1">
                            ({Math.round((summaryTotals.counseledCount / summaryTotals.studentCount) * 100)}%)
                          </span>
                        )}
                      </td>
                      <td
                        className={`px-3 py-1.5 text-right tabular-nums font-bold ${
                          summaryTotals.uncounseledCount > 0
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-zinc-400"
                        }`}
                      >
                        {summaryTotals.uncounseledCount}
                      </td>
                      <td
                        className={`px-3 py-1.5 text-right tabular-nums font-bold ${
                          summaryTotals.heavyCount > 0
                            ? "text-red-600 dark:text-red-400"
                            : "text-zinc-400"
                        }`}
                      >
                        {summaryTotals.heavyCount}
                      </td>
                      <td className="px-3 py-1.5"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          )}

          {/* Empty state: 데이터 없음 */}
          {!loading && homerooms.length === 0 && (
            <div className="rounded-sm border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
              담임 정보를 가진 학생이 없습니다. 학생 enrollments에 `mainClasses` 또는 `teacher` 필드가 있는지 확인해주세요.
            </div>
          )}

          {/* 본문: 좌(일자별) + 우(학생 매트릭스)
              - 좌측 = 그 달 날짜 + 총합 = 자연 높이 (스크롤 없음, 높이 기준)
              - 우측 = 좌측과 같은 높이로 제한, 학생 많으면 내부 세로 스크롤 */}
          {homerooms.length > 0 && (
            <div className="grid grid-cols-[200px_1fr] items-start gap-3">
              {/* 좌측: 일자별 상담 수 — 한 달 날짜 기준 (자연 높이, 스크롤 없음) */}
              <section
                ref={leftRef}
                className="border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex h-7 flex-shrink-0 items-center border-b border-zinc-200 bg-zinc-50 px-2 text-[11px] font-bold text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
                  {monthLabel} 상담기간
                </div>
                <div>
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-zinc-100 dark:bg-zinc-800">
                      <tr>
                        <th className="border-b border-zinc-200 px-2 py-1 text-left font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                          날짜
                        </th>
                        <th className="border-b border-zinc-200 px-2 py-1 text-right font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                          상담 수
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthDays.map((d) => {
                        const count = consultationsByDate.get(d) ?? 0;
                        const isWeekend = [0, 6].includes(new Date(d).getDay());
                        return (
                          <tr
                            key={d}
                            className={`h-7 border-b border-zinc-100 dark:border-zinc-800 ${
                              isWeekend ? "bg-zinc-50/50 dark:bg-zinc-950/50" : ""
                            }`}
                          >
                            <td className="px-2 py-1 text-zinc-700 dark:text-zinc-300 whitespace-nowrap">
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
                      <tr className="h-7 border-b border-zinc-100 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-800">
                        <td className="px-2 py-1 font-bold text-zinc-700 dark:text-zinc-300">
                          총합
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums font-bold text-zinc-900 dark:text-zinc-100">
                          {totalConsultations}회
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              {/* 우측: 학생 상담 현황 — 좌측 높이로 제한, 넘치면 내부 스크롤 */}
              <section
                className="flex flex-col overflow-hidden border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
                style={leftHeight ? { maxHeight: leftHeight } : undefined}
              >
                <div className="flex h-7 flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-zinc-200 bg-zinc-50 px-3 dark:border-zinc-800 dark:bg-zinc-950">
                  <span className="text-[11px] font-bold text-zinc-700 dark:text-zinc-300">
                    학생별 상담 현황 ({monthLabel})
                    {!isAllView && (
                      <span className="ml-2 text-zinc-500 font-normal">
                        · {selectedHomeroom} 담임반
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <input
                        type="text"
                        value={studentSearch}
                        onChange={(e) => setStudentSearch(e.target.value)}
                        placeholder="학생 이름 검색"
                        className="h-5 w-36 rounded-sm border border-zinc-300 bg-white pl-5 pr-5 text-[10px] leading-none text-zinc-900 placeholder-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
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
                    <span className="text-[10px] text-zinc-500">
                      읽기 전용 · ijw-calander에서 동기화
                    </span>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 z-10 bg-zinc-100 dark:bg-zinc-800">
                      <tr>
                        <th className="border-b border-zinc-200 px-2 py-1 text-left font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400 whitespace-nowrap">
                          학생
                        </th>
                        <th className="border-b border-zinc-200 px-2 py-1 text-left font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400 whitespace-nowrap">
                          학년
                        </th>
                        {isAllView && (
                          <th className="border-b border-zinc-200 px-2 py-1 text-left font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400 whitespace-nowrap">
                            담임
                          </th>
                        )}
                        <th className="border-b border-zinc-200 px-2 py-1 text-center font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400 whitespace-nowrap">
                          횟수
                        </th>
                        <th className="border-b border-zinc-200 px-2 py-1 text-left font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400 whitespace-nowrap">
                          마지막 상담일
                        </th>
                        <th className="border-b border-zinc-200 px-2 py-1 text-left font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                          상담 일자
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedStudents.map((s) => {
                        const bucket = matrixByStudent.get(s.id);
                        if (!bucket) return null;
                        const highlight = bucket.total >= 3;
                        const nothing = bucket.total === 0;
                        const hrList = teachersByStudent.get(s.id) ?? [];
                        const hr = hrList.length > 0 ? hrList.join(", ") : "—";
                        return (
                          <tr
                            key={s.id}
                            className={`h-7 border-b border-zinc-100 dark:border-zinc-800 ${
                              nothing
                                ? "bg-amber-50 dark:bg-amber-950/30"
                                : highlight
                                  ? "bg-red-50 dark:bg-red-950/30"
                                  : ""
                            }`}
                          >
                            <td
                              className={`px-2 py-1 font-medium whitespace-nowrap ${
                                nothing
                                  ? "text-amber-800 dark:text-amber-300"
                                  : highlight
                                    ? "text-red-700 dark:text-red-300"
                                    : "text-zinc-900 dark:text-zinc-100"
                              }`}
                            >
                              {s.name}
                            </td>
                            <td className="px-2 py-1 text-zinc-500 whitespace-nowrap">
                              {s.grade || "—"}
                            </td>
                            {isAllView && (
                              <td
                                className="max-w-[140px] truncate px-2 py-1 text-zinc-500"
                                title={hr}
                              >
                                {hr}
                              </td>
                            )}
                            <td className="px-2 py-1 text-center whitespace-nowrap">
                              {nothing ? (
                                <span className="inline-block rounded-sm bg-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-900 dark:bg-amber-900/60 dark:text-amber-200">
                                  미상담
                                </span>
                              ) : (
                                <span
                                  className={`tabular-nums font-bold ${
                                    highlight
                                      ? "text-red-700 dark:text-red-300"
                                      : "text-blue-600 dark:text-blue-400"
                                  }`}
                                >
                                  {bucket.total}회
                                </span>
                              )}
                            </td>
                            <td className="px-2 py-1 text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                              {bucket.lastDate ? formatDateKorean(bucket.lastDate) : "—"}
                            </td>
                            <td className="px-2 py-1">
                              {bucket.dates.length === 0 ? (
                                <span className="text-[11px] text-amber-700 dark:text-amber-400">
                                  이달 상담 필요
                                </span>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {bucket.dates.map((d) => {
                                    // 해당 학생 × 날짜의 상담 찾기 (여러 건이면 첫 번째)
                                    const match = scopedConsultations.find(
                                      (c) => c.studentId === s.id && c.date === d
                                    );
                                    return (
                                      <button
                                        key={d}
                                        type="button"
                                        onClick={() => match && setSelectedConsultation(match)}
                                        disabled={!match}
                                        title={match ? "상세 보기" : ""}
                                        className={`inline-block rounded-sm px-1.5 py-0.5 text-[10px] tabular-nums transition-colors ${
                                          highlight
                                            ? "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/50 dark:text-red-300 dark:hover:bg-red-900/70"
                                            : "bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900/70"
                                        } ${!match ? "opacity-60" : "cursor-pointer"}`}
                                      >
                                        {d.slice(5).replace("-", "/")}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {/* 마지막 페이지에서 부족한 만큼 빈 행 채움 — 테이블 높이 고정 → 페이지네이션 위치 일정 */}
                      {Array.from({ length: Math.max(0, pageSize - pagedStudents.length) }).map(
                        (_, i) => (
                          <tr
                            key={`blank-${i}`}
                            aria-hidden="true"
                            className="h-7 border-b border-zinc-100 dark:border-zinc-800"
                          >
                            <td colSpan={isAllView ? 6 : 5} />
                          </tr>
                        )
                      )}
                      {/* 검색 결과 0건 안내 — 빈 행 위에 오버레이 느낌으로 표시 */}
                      {searchedStudents.length === 0 && studentSearch.trim() && (
                        <tr className="pointer-events-none">
                          <td
                            colSpan={isAllView ? 6 : 5}
                            className="px-2 py-3 text-center text-[11px] text-zinc-500 dark:text-zinc-400"
                          >
                            &quot;{studentSearch.trim()}&quot; 검색 결과가 없습니다
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {/* 학생 목록 페이지네이션 — 좌측 '총합' 행과 동일 높이(h-7). 페이지 없을 때도 자리 확보 */}
                <div className="flex h-7 flex-shrink-0 items-center justify-between border-t border-zinc-200 bg-zinc-50/50 px-2 text-[11px] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
                  {totalPages > 1 ? (
                  <>
                    <span className="tabular-nums">
                      {searchedStudents.length === 0
                        ? "0 / 0명"
                        : `${(studentsPage - 1) * pageSize + 1}–${Math.min(
                            studentsPage * pageSize,
                            searchedStudents.length
                          )} / ${searchedStudents.length}명`}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setStudentsPage((p) => Math.max(1, p - 1))}
                        disabled={studentsPage === 1}
                        aria-label="이전 페이지"
                        className="px-1 text-zinc-500 hover:text-zinc-900 disabled:opacity-30 dark:hover:text-zinc-100"
                      >
                        ◀
                      </button>
                      <span className="tabular-nums">
                        {studentsPage} / {totalPages}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setStudentsPage((p) => Math.min(totalPages, p + 1))
                        }
                        disabled={studentsPage === totalPages}
                        aria-label="다음 페이지"
                        className="px-1 text-zinc-500 hover:text-zinc-900 disabled:opacity-30 dark:hover:text-zinc-100"
                      >
                        ▶
                      </button>
                    </div>
                  </>
                  ) : (
                    <span className="tabular-nums text-zinc-400">
                      {searchedStudents.length === 0 && studentSearch.trim()
                        ? "0명"
                        : `총 ${searchedStudents.length}명`}
                    </span>
                  )}
                </div>
              </section>
            </div>
          )}

          {/* 최근 상담 이력 */}
          {scopedConsultations.length > 0 && (
            <section className="mt-3 border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <div className="border-b border-zinc-200 bg-zinc-50 px-3 py-1.5 text-[11px] font-bold text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
                최근 상담 이력 ({scopedConsultations.length}건)
              </div>
              <div className="max-h-[500px] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-zinc-100 dark:bg-zinc-800">
                    <tr>
                      <th className="border-b border-zinc-200 px-2 py-1 text-left font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                        날짜
                      </th>
                      <th className="border-b border-zinc-200 px-2 py-1 text-left font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                        학생
                      </th>
                      <th className="border-b border-zinc-200 px-2 py-1 text-left font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                        유형
                      </th>
                      <th className="border-b border-zinc-200 px-2 py-1 text-left font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                        과목
                      </th>
                      <th className="border-b border-zinc-200 px-2 py-1 text-left font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                        상담자
                      </th>
                      <th className="border-b border-zinc-200 px-2 py-1 text-left font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                        제목
                      </th>
                      <th className="border-b border-zinc-200 px-2 py-1 text-left font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                        후속
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {scopedConsultations
                      .slice()
                      .sort((a, b) => b.date.localeCompare(a.date))
                      .map((c) => (
                        <tr
                          key={c.id}
                          onClick={() => setSelectedConsultation(c)}
                          className="cursor-pointer border-b border-zinc-100 transition-colors hover:bg-blue-50 dark:border-zinc-800 dark:hover:bg-blue-950/30"
                          title="클릭하여 상세 보기"
                        >
                          <td className="px-2 py-1 whitespace-nowrap text-zinc-700 dark:text-zinc-300 tabular-nums">
                            {formatDateKorean(c.date)}
                          </td>
                          <td className="px-2 py-1 whitespace-nowrap font-medium text-zinc-900 dark:text-zinc-100">
                            {c.studentName}
                          </td>
                          <td className="px-2 py-1 whitespace-nowrap">
                            <span className="inline-block rounded-sm bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                              {c.type === "parent" ? "학부모" : "학생"}
                            </span>
                          </td>
                          <td className="px-2 py-1 whitespace-nowrap">
                            {c.subject ? (
                              <span className="inline-block rounded-sm bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                                {consultationSubjectLabel(c)}
                              </span>
                            ) : (
                              <span className="text-zinc-300">—</span>
                            )}
                          </td>
                          <td className="px-2 py-1 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                            {c.consultantName}
                          </td>
                          <td className="px-2 py-1 text-zinc-700 dark:text-zinc-300 max-w-[280px] truncate">
                            {c.title}
                          </td>
                          <td className="px-2 py-1 whitespace-nowrap">
                            {c.followUpNeeded && !c.followUpDone && (
                              <span className="inline-block rounded-sm bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                                필요
                              </span>
                            )}
                            {c.followUpNeeded && c.followUpDone && (
                              <span className="inline-block rounded-sm bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                                완료
                              </span>
                            )}
                            {!c.followUpNeeded && <span className="text-zinc-300">—</span>}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      {/* ─── 탭: 노트 검사 (목업 유지) ─── */}
      {activeTab === "note" && (
        <div className="border border-amber-200 bg-amber-50 px-4 py-6 text-center text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          <div className="font-bold mb-1">노트 검사 기능은 준비 중입니다</div>
          <div className="text-xs">
            Supabase <code>note_inspections</code> 테이블 신설 후 연동 예정.
            입력·기록 UI는 이후 작업에서 추가합니다.
          </div>
        </div>
      )}

      {/* 상담 상세 팝업 */}
      <ConsultationDetailModal
        consultation={selectedConsultation}
        onClose={() => setSelectedConsultation(null)}
      />
    </div>
  );
}

// ─── KPI 카드 ──────────────────────────────────────
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
