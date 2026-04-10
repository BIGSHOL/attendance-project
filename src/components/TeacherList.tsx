"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useStaff } from "@/hooks/useStaff";
import { useStudents } from "@/hooks/useStudents";
import { useHiddenTeachers } from "@/hooks/useHiddenTeachers";
import { useAllUserRoles } from "@/hooks/useAllUserRoles";
import { useLocalStorage, useLocalStorageSet } from "@/hooks/useLocalStorage";
import { toRoleLabel, toSubjectLabel } from "@/lib/labelMap";
import Pagination from "./Pagination";

const PAGE_SIZE = 20;

export default function TeacherList() {
  const { teachers, loading } = useStaff();
  const { students, loading: studentsLoading } = useStudents();
  const { isHidden, toggleHidden } = useHiddenTeachers();
  const { users: userRoles } = useAllUserRoles();

  // 선생님 ID → 매핑된 구글 이메일 (선생님/관리자 매핑 모두 포함)
  const staffEmailMap = useMemo(() => {
    const map: Record<string, string> = {};
    userRoles.forEach((u) => {
      if ((u.role === "teacher" || u.role === "admin") && u.staff_id) {
        map[u.staff_id] = u.email;
      }
    });
    return map;
  }, [userRoles]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useLocalStorage<string>("teacherList.search", "");
  const [checkedSubjects, setCheckedSubjects] = useLocalStorageSet("teacherList.subjects");

  // 선생님별 담당 학생 수 (staffId가 이름/영어이름/ID로 저장됨)
  const studentCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of teachers) {
      const count = students.filter((s) =>
        s.enrollments?.some((e) => {
          const sid = e.staffId || "";
          const tname = e.teacher || "";
          return (
            sid === t.id || sid === t.name || sid === t.englishName ||
            tname === t.name || tname === t.englishName
          );
        })
      ).length;
      map[t.id] = count;
    }
    return map;
  }, [teachers, students]);

  const allSubjects = useMemo(() => {
    const set = new Set<string>();
    teachers.forEach((t) => t.subjects?.forEach((s) => set.add(s)));
    return Array.from(set).sort();
  }, [teachers]);

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

  const filtered = useMemo(() => {
    let list = teachers;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((t) => t.name.toLowerCase().includes(q));
    }
    if (effectiveChecked.size < allSubjects.length) {
      list = list.filter((t) => t.subjects?.some((s) => effectiveChecked.has(s)));
    }
    return list;
  }, [teachers, search, effectiveChecked, allSubjects]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  );

  // 필터 변경 시 첫 페이지로 이동
  const handleSearch = (v: string) => { setSearch(v); setPage(1); };

  if (loading || studentsLoading) {
    return <div className="flex items-center justify-center h-64 text-zinc-400 text-sm">불러오는 중...</div>;
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-4">
        선생님 목록
        <span className="ml-2 text-sm font-normal text-zinc-500">
          ({filtered.length}명)
        </span>
      </h2>

      <div className="flex flex-wrap gap-3 mb-3">
        <input
          type="text"
          placeholder="이름 검색"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="rounded-sm border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
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

      <div className="overflow-hidden border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm [&_td]:border-r [&_td]:border-zinc-200 [&_th]:border-r [&_th]:border-zinc-300">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/50">
              <th className="px-4 py-3 text-left font-medium text-zinc-500">#</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-500">이름</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-500">역할</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-500">과목</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-500">구글 계정</th>
              <th className="px-4 py-3 text-center font-medium text-zinc-500">담당학생</th>
              <th className="px-4 py-3 text-center font-medium text-zinc-500">출석부</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((teacher, idx) => {
              const hidden = isHidden(teacher.id);
              return (
                <tr
                  key={teacher.id}
                  className={`border-b border-zinc-300 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/30 ${hidden ? "opacity-50" : ""}`}
                >
                  <td className="px-4 py-3 text-zinc-400">
                    {(page - 1) * PAGE_SIZE + idx + 1}
                  </td>
                  <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                    <Link href={`/teachers/${teacher.id}`} className="hover:text-blue-600 hover:underline">
                      {teacher.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-zinc-500">{toRoleLabel(teacher.role)}</td>
                  <td className="px-4 py-3 text-zinc-500">
                    {teacher.subjects?.map(toSubjectLabel).join(", ") || "-"}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500">
                    {staffEmailMap[teacher.id] ? (
                      <span className="inline-flex items-center gap-1 rounded-sm bg-blue-50 px-2 py-0.5 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                        {staffEmailMap[teacher.id]}
                      </span>
                    ) : (
                      <span className="text-zinc-300">미매핑</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center text-zinc-600 dark:text-zinc-400">
                    {studentCountMap[teacher.id] || 0}명
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => toggleHidden(teacher.id)}
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                        hidden
                          ? "bg-zinc-100 text-zinc-400 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-500"
                          : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900 dark:text-emerald-300"
                      }`}
                    >
                      {hidden ? "미생성" : "생성됨"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
