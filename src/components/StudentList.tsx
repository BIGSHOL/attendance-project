"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useStudents } from "@/hooks/useStudents";
import { useUserRole } from "@/hooks/useUserRole";
import { useLocalStorage, useLocalStorageSet } from "@/hooks/useLocalStorage";
import { toStatusLabel, toSubjectLabel } from "@/lib/labelMap";
import Pagination from "./Pagination";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import ColumnFilter from "./ColumnFilter";

const PAGE_SIZE = 20;
type SortKey =
  | "name"
  | "school"
  | "grade"
  | "subject"
  | "teacher"
  | "status"
  | null;
type SortDir = "asc" | "desc";

export default function StudentList() {
  const { students: allStudents, loading } = useStudents();
  const { userRole, isTeacher } = useUserRole();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useLocalStorage<string>("studentList.search", "");
  const [checkedSubjects, setCheckedSubjects] = useLocalStorageSet("studentList.subjects");
  const [statusFilter, setStatusFilter] = useLocalStorage<string>("studentList.status", "active");

  // 컬럼별 정렬 (시트 헤더 클릭 정렬, audit D)
  const [sortKey, setSortKey] = useLocalStorage<SortKey>("studentList.sortKey", null);
  const [sortDir, setSortDir] = useLocalStorage<SortDir>("studentList.sortDir", "asc");
  // 컬럼별 드롭다운 필터 (audit F) — value Set 으로 다중 선택
  const [schoolFilter, setSchoolFilter] = useLocalStorageSet("studentList.schoolFilter");
  const [gradeFilter, setGradeFilter] = useLocalStorageSet("studentList.gradeFilter");
  const [teacherFilter, setTeacherFilter] = useLocalStorageSet("studentList.teacherFilter");
  const NONE_SENTINEL = "\0__NONE__\0";

  /**
   * ColumnFilter helper — 선택 set 적용.
   *   비어 있음(set.size === 0) = 전체 통과.
   *   NONE_SENTINEL 만 = 모두 차단 (사용자가 "전체 해제" 누른 상태).
   *   그 외 = set 에 포함된 값만 통과.
   */
  const passesColumnFilter = (
    set: Set<string>,
    value: string | undefined
  ): boolean => {
    if (set.size === 0) return true;
    if (set.size === 1 && set.has(NONE_SENTINEL)) return false;
    return set.has(value || "");
  };

  // 선생님 계정이면 본인 담당 학생만 노출
  //   enrollment.staffId === 내 staff_id  또는  enrollment.teacher === 내 이름
  const students = useMemo(() => {
    if (!isTeacher || !userRole?.staff_id) return allStudents;
    const myId = userRole.staff_id;
    const myName = userRole.staff_name;
    return allStudents.filter((s) =>
      s.enrollments?.some(
        (e) => e.staffId === myId || (!!myName && e.teacher === myName)
      )
    );
  }, [allStudents, isTeacher, userRole]);

  const allSubjects = useMemo(() => {
    const set = new Set<string>();
    students.forEach((s) => s.enrollments?.forEach((e) => {
      if (e.subject) set.add(e.subject);
    }));
    return Array.from(set).sort();
  }, [students]);

  // 기본값: 전체 과목 체크
  const effectiveChecked = useMemo(() => {
    if (checkedSubjects.size === 0) return new Set(allSubjects);
    return checkedSubjects;
  }, [checkedSubjects, allSubjects]);

  const toggleSubject = (subject: string) => {
    const next = new Set(effectiveChecked);
    if (next.has(subject)) next.delete(subject);
    else next.add(subject);
    setCheckedSubjects(next);
    setPage(1);
  };

  const toggleAllSubjects = () => {
    if (effectiveChecked.size === allSubjects.length) {
      setCheckedSubjects(new Set());
    } else {
      setCheckedSubjects(new Set(allSubjects));
    }
    setPage(1);
  };

  /**
   * 학생 → 대표 담당선생님 라벨 (다중이면 첫 번째).
   *   필터/정렬용. 표시는 별도로 모든 선생님 나열.
   */
  const teacherLabel = (s: typeof students[number]): string => {
    const names = Array.from(
      new Set((s.enrollments || []).map((e) => e.staffId || e.teacher).filter((n): n is string => !!n))
    );
    return names[0] || "";
  };

  const filtered = useMemo(() => {
    let list = students;
    if (statusFilter !== "all") {
      list = list.filter((s) => s.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((s) => s.name.toLowerCase().includes(q));
    }
    // 체크된 과목 중 하나라도 가진 학생만
    if (effectiveChecked.size < allSubjects.length) {
      list = list.filter((s) =>
        s.enrollments?.some((e) => effectiveChecked.has(e.subject))
      );
    }
    // 컬럼 필터 (audit F)
    list = list.filter((s) => {
      if (!passesColumnFilter(schoolFilter, s.school)) return false;
      if (!passesColumnFilter(gradeFilter, s.grade)) return false;
      if (!passesColumnFilter(teacherFilter, teacherLabel(s))) return false;
      return true;
    });
    // 컬럼 정렬 (audit D)
    if (sortKey) {
      const dir = sortDir === "asc" ? 1 : -1;
      const key = sortKey;
      list = [...list].sort((a, b) => {
        const va =
          key === "name"
            ? a.name
            : key === "school"
              ? a.school || ""
              : key === "grade"
                ? a.grade || ""
                : key === "subject"
                  ? (a.enrollments?.[0]?.subject || "")
                  : key === "teacher"
                    ? teacherLabel(a)
                    : key === "status"
                      ? a.status || ""
                      : "";
        const vb =
          key === "name"
            ? b.name
            : key === "school"
              ? b.school || ""
              : key === "grade"
                ? b.grade || ""
                : key === "subject"
                  ? (b.enrollments?.[0]?.subject || "")
                  : key === "teacher"
                    ? teacherLabel(b)
                    : key === "status"
                      ? b.status || ""
                      : "";
        return va.localeCompare(vb, "ko") * dir;
      });
    }
    return list;
  }, [
    students,
    search,
    effectiveChecked,
    allSubjects,
    statusFilter,
    schoolFilter,
    gradeFilter,
    teacherFilter,
    sortKey,
    sortDir,
  ]);

  // 컬럼별 unique 값 (필터 드롭다운 옵션). 학생 전체에서 추출 — 현재 필터에
  // 영향받지 않도록 students 기준 (시트와 동일한 UX).
  const columnValues = useMemo(() => {
    const schools = new Set<string>();
    const grades = new Set<string>();
    const teachers = new Set<string>();
    for (const s of students) {
      if (s.school) schools.add(s.school);
      if (s.grade) grades.add(s.grade);
      const t = teacherLabel(s);
      if (t) teachers.add(t);
    }
    return {
      schools: Array.from(schools).sort((a, b) => a.localeCompare(b, "ko")),
      grades: Array.from(grades).sort((a, b) => a.localeCompare(b, "ko")),
      teachers: Array.from(teachers).sort((a, b) => a.localeCompare(b, "ko")),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students]);

  // 컬럼 정렬 변경 helper — 같은 컬럼 다시 클릭 시 dir 토글, 다른 컬럼 클릭 시 asc 시작.
  const handleSort = (key: SortKey, dir: SortDir) => {
    setSortKey(key);
    setSortDir(dir);
    setPage(1);
  };
  const wrapColumnFilter =
    (setter: (next: Set<string>) => void) => (next: Set<string>) => {
      setter(next);
      setPage(1);
    };

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  );

  const handleSearch = (v: string) => { setSearch(v); setPage(1); };
  const handleStatusFilter = (v: string) => { setStatusFilter(v); setPage(1); };

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Skeleton className="h-6 w-40" />
        <div className="flex gap-3">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-28" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-6 w-14" />
          <Skeleton className="h-6 w-14" />
          <Skeleton className="h-6 w-14" />
        </div>
        <SkeletonTable rows={10} cols={7} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-4">
        학생 목록
        <span className="ml-2 text-sm font-normal text-zinc-500">
          ({filtered.length}명)
        </span>
        {isTeacher && (
          <span className="ml-2 rounded-sm bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
            내 담당 학생만
          </span>
        )}
      </h2>

      <div className="flex flex-wrap gap-3 mb-3">
        <input
          type="text"
          placeholder="이름 검색"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="rounded-sm border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <select
          value={statusFilter}
          onChange={(e) => handleStatusFilter(e.target.value)}
          className="rounded-sm border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        >
          <option value="all">전체 상태</option>
          <option value="active">재원</option>
          <option value="withdrawn">퇴원</option>
        </select>
      </div>

      {/* 과목 체크박스 필터 */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          onClick={toggleAllSubjects}
          className="text-xs px-2 py-1 rounded border border-zinc-300 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          {effectiveChecked.size === allSubjects.length ? "전체 해제" : "전체 선택"}
        </button>
        {allSubjects.map((s) => {
          const checked = effectiveChecked.has(s);
          return (
            <button
              key={s}
              onClick={() => toggleSubject(s)}
              className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                checked
                  ? "bg-blue-100 border-blue-400 text-blue-700 dark:bg-blue-900 dark:border-blue-600 dark:text-blue-300"
                  : "bg-white border-zinc-300 text-zinc-400 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-500"
              }`}
            >
              <span className="mr-1">{checked ? "☑" : "☐"}</span>
              {toSubjectLabel(s)}
            </button>
          );
        })}
      </div>

      <div className="overflow-x-auto border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="min-w-full text-sm [&_td]:border-r [&_td]:border-zinc-200 [&_th]:border-r [&_th]:border-zinc-300 [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/50">
              <th className="px-4 py-3 text-left font-medium text-zinc-500">#</th>
              <th className="text-left">
                <ColumnFilter
                  values={[]}
                  selected={new Set()}
                  onChange={() => {}}
                  sortKey={sortKey === "name" ? sortKey : null}
                  sortDir={sortDir}
                  onSort={(d) => handleSort("name", d)}
                >
                  이름
                </ColumnFilter>
              </th>
              <th className="text-left">
                <ColumnFilter
                  values={columnValues.schools}
                  selected={schoolFilter}
                  onChange={wrapColumnFilter(setSchoolFilter)}
                  sortKey={sortKey === "school" ? sortKey : null}
                  sortDir={sortDir}
                  onSort={(d) => handleSort("school", d)}
                >
                  학교
                </ColumnFilter>
              </th>
              <th className="text-left">
                <ColumnFilter
                  values={columnValues.grades}
                  selected={gradeFilter}
                  onChange={wrapColumnFilter(setGradeFilter)}
                  sortKey={sortKey === "grade" ? sortKey : null}
                  sortDir={sortDir}
                  onSort={(d) => handleSort("grade", d)}
                >
                  학년
                </ColumnFilter>
              </th>
              <th className="text-left">
                <ColumnFilter
                  values={[]}
                  selected={new Set()}
                  onChange={() => {}}
                  sortKey={sortKey === "subject" ? sortKey : null}
                  sortDir={sortDir}
                  onSort={(d) => handleSort("subject", d)}
                >
                  과목
                </ColumnFilter>
              </th>
              <th className="text-left">
                <ColumnFilter
                  values={columnValues.teachers}
                  selected={teacherFilter}
                  onChange={wrapColumnFilter(setTeacherFilter)}
                  sortKey={sortKey === "teacher" ? sortKey : null}
                  sortDir={sortDir}
                  onSort={(d) => handleSort("teacher", d)}
                >
                  담당선생님
                </ColumnFilter>
              </th>
              <th className="text-left">
                <ColumnFilter
                  values={[]}
                  selected={new Set()}
                  onChange={() => {}}
                  sortKey={sortKey === "status" ? sortKey : null}
                  sortDir={sortDir}
                  onSort={(d) => handleSort("status", d)}
                >
                  상태
                </ColumnFilter>
              </th>
            </tr>
          </thead>
          <tbody>
            {paged.map((student, idx) => (
              <tr
                key={student.id}
                className="border-b border-zinc-300 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/30"
              >
                <td className="px-4 py-3 text-zinc-400">
                  {(page - 1) * PAGE_SIZE + idx + 1}
                </td>
                <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                  <Link href={`/students/${student.id}`} className="hover:text-blue-600 hover:underline">
                    {student.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-zinc-500">{student.school || "-"}</td>
                <td className="px-4 py-3 text-zinc-500">{student.grade || "-"}</td>
                <td className="px-4 py-3 text-zinc-500">
                  {(() => {
                    const subjects = Array.from(
                      new Set(
                        student.enrollments
                          ?.map((e) => e.subject)
                          .filter(Boolean)
                      )
                    );
                    return subjects.length > 0
                      ? subjects.map(toSubjectLabel).join(", ")
                      : "-";
                  })()}
                </td>
                <td className="px-4 py-3 text-zinc-500">
                  {(() => {
                    const names = Array.from(
                      new Set(
                        student.enrollments
                          ?.map((e) => e.staffId || e.teacher)
                          .filter((n): n is string => !!n)
                      )
                    );
                    return names.length > 0
                      ? names.map((name, i) => (
                          <div key={i}>{name}</div>
                        ))
                      : "-";
                  })()}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-sm px-2 py-0.5 text-xs font-medium ${
                    student.status === "withdrawn"
                      ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                      : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
                  }`}>
                    {toStatusLabel(student.status)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
