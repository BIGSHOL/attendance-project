"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useStaff } from "@/hooks/useStaff";
import { useStudents } from "@/hooks/useStudents";
import { useYearlyAttendance } from "@/hooks/useYearlyAttendance";
import { useHiddenTeachers } from "@/hooks/useHiddenTeachers";
import { useAllUserRoles } from "@/hooks/useAllUserRoles";
import { useTeacherSettings } from "@/hooks/useTeacherSettings";
import type { SalaryType } from "@/hooks/useUserRole";
import { useTeacherSheets } from "@/hooks/useTeacherSheets";
import { useSalaryConfig } from "@/hooks/useSalaryConfig";
import { useUserRole } from "@/hooks/useUserRole";
import { useLocalStorage, useLocalStorageSet } from "@/hooks/useLocalStorage";
import { toRoleLabel, toSubjectLabel } from "@/lib/labelMap";
import { syncTeacherSheet, type TeacherSyncResult } from "@/lib/syncSheet";
import Pagination from "./Pagination";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";

const PAGE_SIZE = 20;

// Google Sheets URL에서 파일 ID만 추출
function extractSheetId(urlOrId: string): string {
  const m = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return (m ? m[1] : urlOrId).trim();
}

// 일괄 등록 기본 시드 (사용자 제공 데이터)
// 권나현은 1_SOZRItPf6yivGxCg3QZ0GGrvOamc-iPN7V7GiNKH38 으로 매핑
const DEFAULT_BULK_SEED = `권나현\t1_SOZRItPf6yivGxCg3QZ0GGrvOamc-iPN7V7GiNKH38
김민주\t1QDOae3XsO1-Q26TJV-SLDYShMSmb18M2C7L0NxOl7sc
김윤하\t1pffN2Q8cLLzYwEs5fnHYmGqoaseYsZhTrqNqNlFEQZM
김은정\t11hWWcBrikuf68NwZp4sYcZdqxfyirtEcjsvuNF0261w
김화영\t127K5FIoY2uMYtvBA8B8ZxZ1oDvMfYI0mDY7fvPCNKVw
이성우\t130WbEHQ-tzkWbLWNk5pURZRM1bb-iDeiGMB0AXHng_I
이수진\t1wU4-9xOLdAj3d9_0rdOIfkatqWI4wCMMSsx7UXCh2VM
허은진\t1Zm-2zz0dJQU1XnEhiuQxlmXLJD9n9zDPn2_7EEt0bsc
마수호\t1ltWBCTOyJvz6-TKlL-3NiPRFh0ZmuY4br85ZpD0V15E
강보경\t1c15axkzs5Q2KHhh9-moZW7Ap_3RWONo9tPObXakWBYI
박나연\t1A0r3yEgHMyv6NwvD9YGAIJoNVrFZzcQ31spihQbbQ2U
신명진\t1qxufOEMmUXF2WZXiD9rfGPMtvPoq2VizNuKQ0DGHwJA
이영현\t1eGwFohZSchMI5kqcakGBUf7TW8OfTYYQ6Q9vAgFhtF4
정은지\t1-OBMvrExWzbG2KT8FAO_-utk44uKRFiSYGBznUxu0PU
추민아\t1ThjvOpNIFlyWmijED03e9OgCbfhg0_5AwCBpko9NfAI
한숙영\t1CZ5RJkZ8zocf3ibDIn010MkawnZN2n7pOUchYr8IN_g
김차경\t1XpVxzi-Ta6Sq9Bu9RhIqPnJNIPriBJWlP0hgodneBSQ
노현진\t1-HHJ7EfjpW3VO_TZKmao3GFLVJPJOfxsGxC_H1tBW5c
박소선\t1kW_ktXaYsmSrMHmh3tlHBrza4pujrsR0y0xSH-8rHOg
Sam\t1IsbsUlXgQfKVTQ-USjGrI4rKTNZn08hb-ckpgZxOI8E
Florence\t1wYNUsOnoMC6kKl2ID8uGzvbfuyeGPUqkma6eje0Mes0
Lyra\t1WtaT35r32X8qWXPNaPuKZvAPaV9jNFFQyfOXSoP1KqA
Kristine\t1k4UmMIeBtrzYn67yA3AhRgW8kE3v9pwUmoGEC_OYjJ0
임다영\t1Al9uAJPPjvYkBHoz6RHndFdTgvJNNmuz05DlS9k-veY
이민아\t12fx-hNHqIJR06pOMSkUHpcOUxTDt6ytvdIMs41O1_U8
김유정\t1mMhBTSiktt7i99_61cpkQQuCxLvx1VlaG2plUS0HI-E
이정아\t1dVp2HOTn_Pfzbu6-TUX6zw8oZmJPnTLsANwYIXeftWU
현미진\t1zIyzD-YbMRO3BnS4eIBFA_fTvzvJH694KeJ0Jx5IzYg
김미\t1hX2ZqeXfM__boxQxwNoiqg7OYfPHhBtFCXVj-PyGNek`;

export default function TeacherList() {
  const { teachers, loading } = useStaff();
  const { students, loading: studentsLoading } = useStudents();
  const [selectedYear, setSelectedYear] = useLocalStorage<number>(
    "teacherList.year",
    new Date().getFullYear()
  );
  const { activeStudentsByTeacher, loading: attendanceLoading } =
    useYearlyAttendance(selectedYear);
  const { isHidden, toggleHidden } = useHiddenTeachers();
  const { users: userRoles } = useAllUserRoles();
  const { isMaster } = useUserRole();
  const { sheets, upsertSheet, deleteSheet, markSynced } = useTeacherSheets();
  const { config: salaryConfig } = useSalaryConfig();
  const [editingSheetId, setEditingSheetId] = useState<string | null>(null);
  const [sheetUrlDraft, setSheetUrlDraft] = useState("");
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncResults, setSyncResults] = useState<Record<string, TeacherSyncResult>>({});
  // 일괄 등록 모달
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState(DEFAULT_BULK_SEED);
  const [bulkResult, setBulkResult] = useState<{ ok: string[]; skip: string[] } | null>(null);

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

  // 선생님 급여 유형 설정 (teacher_settings 기반, 미매핑 선생님도 설정 가능)
  const { getSalary, setSalaryType, saving: savingSalary } = useTeacherSettings();

  // 선생님 ID → 급여 유형 + 요일
  // 우선순위: teacher_settings → user_roles (레거시 fallback) → 기본 commission
  const userRolesSalaryMap = useMemo(() => {
    const map: Record<string, { type: SalaryType; days: string[] }> = {};
    userRoles.forEach((u) => {
      if ((u.role === "teacher" || u.role === "admin") && u.staff_id) {
        map[u.staff_id] = {
          type: u.salary_type || "commission",
          days: u.commission_days || [],
        };
      }
    });
    return map;
  }, [userRoles]);

  const resolveSalary = (teacherId: string): { type: SalaryType; days: string[] } =>
    getSalary(teacherId) ||
    userRolesSalaryMap[teacherId] || { type: "commission", days: [] };

  const [salaryEditingId, setSalaryEditingId] = useState<string | null>(null);

  // 선생님 ID → 시트 URL
  const sheetMap = useMemo(() => {
    const map: Record<string, { url: string; lastSyncedAt: string | null }> = {};
    sheets.forEach((s) => {
      map[s.teacher_id] = { url: s.sheet_url, lastSyncedAt: s.last_synced_at };
    });
    return map;
  }, [sheets]);

  // 시트 ID → 사용 중인 teacherId 목록 (중복 검사용)
  const sheetIdUsage = useMemo(() => {
    const map = new Map<string, string[]>();
    sheets.forEach((s) => {
      const id = extractSheetId(s.sheet_url);
      if (!id) return;
      const list = map.get(id) || [];
      list.push(s.teacher_id);
      map.set(id, list);
    });
    return map;
  }, [sheets]);

  // 특정 teacherId가 중복 시트인지 + 함께 쓰는 다른 선생님 이름들
  const getDuplicateInfo = (teacherId: string): string[] => {
    const url = sheetMap[teacherId]?.url;
    if (!url) return [];
    const id = extractSheetId(url);
    const others = (sheetIdUsage.get(id) || []).filter((tid) => tid !== teacherId);
    return others.map((tid) => teachers.find((t) => t.id === tid)?.name || tid);
  };

  // 일괄 등록: 이름/영어이름 → teacherId 매칭 후 등록 (존재하지 않는 선생님은 스킵)
  const handleBulkImport = async () => {
    const lines = bulkText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    // 1. 먼저 전체 파싱 + 이름 해결 + 중복 검사 (실제 저장 전)
    const parsed: { rawName: string; matched: string | null; matchedName: string | null; sheetId: string; url: string }[] = [];
    for (const line of lines) {
      const parts = line.split(/\s+/).filter(Boolean);
      if (parts.length < 2) continue;
      const rawName = parts[0];
      const sheetId = extractSheetId(parts[parts.length - 1]);
      const matched = teachers.find(
        (t) => t.name === rawName || t.englishName === rawName
      );
      const url = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
      parsed.push({
        rawName,
        matched: matched?.id || null,
        matchedName: matched?.name || null,
        sheetId,
        url,
      });
    }

    // 2. 중복 검사: 입력 내부 중복 + 기존 DB와 충돌
    const warnings: string[] = [];
    const idToEntries = new Map<string, string[]>();
    for (const p of parsed) {
      if (!p.matched || !p.sheetId) continue;
      const list = idToEntries.get(p.sheetId) || [];
      list.push(p.matchedName!);
      idToEntries.set(p.sheetId, list);
    }
    for (const [sheetId, names] of idToEntries) {
      if (names.length > 1) {
        warnings.push(`입력 내부 중복: [${names.join(", ")}] 모두 같은 시트 ID (${sheetId.slice(0, 10)}...)`);
      }
    }
    for (const p of parsed) {
      if (!p.matched || !p.sheetId) continue;
      const existingUsers = sheetIdUsage.get(p.sheetId) || [];
      const conflicts = existingUsers.filter((tid) => tid !== p.matched);
      if (conflicts.length > 0) {
        const conflictNames = conflicts.map((tid) => teachers.find((t) => t.id === tid)?.name || tid);
        warnings.push(`기존 DB 충돌: ${p.matchedName} 의 시트가 이미 [${conflictNames.join(", ")}]에게 등록됨`);
      }
    }
    if (warnings.length > 0) {
      const proceed = confirm(
        `⚠ 시트 ID 중복 경고 ${warnings.length}건:\n\n${warnings.join("\n")}\n\n그래도 계속하시겠습니까?`
      );
      if (!proceed) {
        setBulkResult({ ok: [], skip: ["(중복 경고로 취소됨)"] });
        return;
      }
    }

    // 3. 실제 저장
    const ok: string[] = [];
    const skip: string[] = [];
    for (const p of parsed) {
      if (!p.matched) {
        skip.push(p.rawName);
        continue;
      }
      await upsertSheet(p.matched, p.url);
      ok.push(`${p.rawName} → ${p.matchedName}`);
    }
    setBulkResult({ ok, skip });
  };

  const handleSync = async (teacherId: string, teacherName: string, sheetUrl: string) => {
    setSyncingId(teacherId);
    try {
      const teacher = teachers.find((t) => t.id === teacherId);
      const result = await syncTeacherSheet(
        teacherId,
        teacherName,
        sheetUrl,
        students,
        "2026-03",
        undefined,
        salaryConfig,
        teacher?.subjects?.[0]
      );
      setSyncResults((prev) => ({ ...prev, [teacherId]: result }));
      if (result.success) await markSynced(teacherId);
    } finally {
      setSyncingId(null);
    }
  };
  const [page, setPage] = useState(1);
  const [search, setSearch] = useLocalStorage<string>("teacherList.search", "");
  const [checkedSubjects, setCheckedSubjects] = useLocalStorageSet("teacherList.subjects");

  // 선생님별 연도별 누적 통계:
  //  - active  : 해당 연도에 시수(hours>0) 1회 이상 기록된 distinct 학생 수 (재원/관리학생)
  //  - newcomers: 해당 선생님 enrollment.startDate 가 선택 연도인 학생 (distinct)
  //  - leavers  : 해당 선생님 enrollment.endDate   가 선택 연도인 학생 (distinct)
  const yearStr = String(selectedYear);
  const isTeacherMatch = (
    e: { staffId?: string; teacher?: string },
    t: { id: string; name: string; englishName?: string }
  ) => {
    const sid = e.staffId || "";
    const tname = e.teacher || "";
    return (
      sid === t.id || sid === t.name || sid === t.englishName ||
      tname === t.name || tname === t.englishName
    );
  };

  const yearStatsMap = useMemo(() => {
    const map: Record<string, { active: number; newcomers: number; leavers: number }> = {};
    for (const t of teachers) {
      const active = activeStudentsByTeacher.get(t.id)?.size || 0;

      const newSet = new Set<string>();
      const leaveSet = new Set<string>();
      for (const s of students) {
        if (!s.enrollments) continue;
        for (const e of s.enrollments) {
          if (!isTeacherMatch(e, t)) continue;
          if (e.startDate && e.startDate.startsWith(yearStr)) newSet.add(s.id);
          if (e.endDate && e.endDate.startsWith(yearStr)) leaveSet.add(s.id);
        }
      }
      map[t.id] = { active, newcomers: newSet.size, leavers: leaveSet.size };
    }
    return map;
  }, [teachers, students, activeStudentsByTeacher, yearStr]);

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

  // 미생성(숨김 처리된) 선생님 숨기기 토글
  const [hideUnlisted, setHideUnlisted] = useLocalStorage<boolean>(
    "teacherList.hideUnlisted",
    false
  );

  // 정렬 상태
  type SortKey =
    | "name" | "role" | "subject" | "email" | "salary"
    | "active" | "newcomers" | "leavers" | "status";
  const [sortKey, setSortKey] = useLocalStorage<SortKey | "">("teacherList.sortKey", "");
  const [sortDir, setSortDir] = useLocalStorage<"asc" | "desc">("teacherList.sortDir", "asc");

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(1);
  };

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  const filtered = useMemo(() => {
    let list = teachers;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((t) => t.name.toLowerCase().includes(q));
    }
    if (effectiveChecked.size < allSubjects.length) {
      list = list.filter((t) => t.subjects?.some((s) => effectiveChecked.has(s)));
    }
    if (hideUnlisted) {
      list = list.filter((t) => !isHidden(t.id));
    }

    if (sortKey) {
      const dir = sortDir === "asc" ? 1 : -1;
      const stats = (id: string) => yearStatsMap[id] || { active: 0, newcomers: 0, leavers: 0 };
      const subjStr = (t: typeof teachers[number]) => (t.subjects || []).join(",");
      const cmp = (a: typeof teachers[number], b: typeof teachers[number]): number => {
        switch (sortKey) {
          case "name": return a.name.localeCompare(b.name, "ko") * dir;
          case "role": return (a.role || "").localeCompare(b.role || "", "ko") * dir;
          case "subject": return subjStr(a).localeCompare(subjStr(b), "ko") * dir;
          case "email": return (staffEmailMap[a.id] || "").localeCompare(staffEmailMap[b.id] || "") * dir;
          case "salary": return resolveSalary(a.id).type.localeCompare(resolveSalary(b.id).type) * dir;
          case "active": return (stats(a.id).active - stats(b.id).active) * dir;
          case "newcomers": return (stats(a.id).newcomers - stats(b.id).newcomers) * dir;
          case "leavers": return (stats(a.id).leavers - stats(b.id).leavers) * dir;
          case "status": return ((isHidden(a.id) ? 1 : 0) - (isHidden(b.id) ? 1 : 0)) * dir;
          default: return 0;
        }
      };
      list = [...list].sort(cmp);
    }

    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teachers, search, effectiveChecked, allSubjects, hideUnlisted, isHidden, sortKey, sortDir, yearStatsMap, staffEmailMap, userRolesSalaryMap, getSalary]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  );

  // 필터 변경 시 첫 페이지로 이동
  const handleSearch = (v: string) => { setSearch(v); setPage(1); };

  if (loading || studentsLoading || attendanceLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <Skeleton className="h-6 w-40" />
        <div className="flex gap-3">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-9 w-32" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-6 w-14" />
          <Skeleton className="h-6 w-14" />
        </div>
        <SkeletonTable rows={10} cols={7} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] px-2">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
          선생님 목록
          <span className="ml-2 text-sm font-normal text-zinc-500">
            ({filtered.length}명)
          </span>
        </h2>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSelectedYear(selectedYear - 1)}
              className="rounded-sm border border-zinc-300 px-2 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              ◀
            </button>
            <span className="px-3 py-1.5 text-sm font-bold text-zinc-900 dark:text-zinc-100 min-w-[64px] text-center">
              {selectedYear}년
            </span>
            <button
              onClick={() => setSelectedYear(selectedYear + 1)}
              className="rounded-sm border border-zinc-300 px-2 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              ▶
            </button>
          </div>
          {isMaster && (
            <button
              onClick={() => { setBulkOpen(true); setBulkResult(null); }}
              className="rounded-sm border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              📄 시트 일괄 등록
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-3 mb-3 overflow-x-auto [&>*]:flex-shrink-0">
        <input
          type="text"
          placeholder="이름 검색"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="rounded-sm border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
      </div>

      {/* 과목 체크박스 필터 + 미생성 숨기기 토글 */}
      <div className="flex items-center gap-2 mb-4 overflow-x-auto [&>*]:flex-shrink-0">
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

        <div className="mx-2 h-5 w-px bg-zinc-200 dark:bg-zinc-700" />

        <button
          onClick={() => { setHideUnlisted(!hideUnlisted); setPage(1); }}
          className={`text-xs px-2.5 py-1 rounded border transition-colors ${
            hideUnlisted
              ? "bg-amber-100 border-amber-400 text-amber-700 dark:bg-amber-900 dark:border-amber-600 dark:text-amber-300"
              : "bg-white border-zinc-300 text-zinc-500 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-400"
          }`}
          title="출석부가 미생성(숨김) 상태인 선생님 숨기기"
        >
          <span className="mr-1">{hideUnlisted ? "☑" : "☐"}</span>
          미생성 숨기기
        </button>
      </div>

      <div className="overflow-x-auto border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="min-w-full text-sm [&_td]:border-r [&_td]:border-zinc-200 [&_th]:border-r [&_th]:border-zinc-300 [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/50 [&_th.sortable]:cursor-pointer [&_th.sortable]:select-none [&_th.sortable:hover]:bg-zinc-100 dark:[&_th.sortable:hover]:bg-zinc-700/50">
              <th className="px-4 py-3 text-left font-medium text-zinc-500">#</th>
              <th className="sortable px-4 py-3 text-left font-medium text-zinc-500" onClick={() => handleSort("name")}>
                이름{sortIndicator("name")}
              </th>
              <th className="sortable px-4 py-3 text-left font-medium text-zinc-500" onClick={() => handleSort("role")}>
                역할{sortIndicator("role")}
              </th>
              <th className="sortable px-4 py-3 text-left font-medium text-zinc-500" onClick={() => handleSort("subject")}>
                과목{sortIndicator("subject")}
              </th>
              <th className="sortable px-4 py-3 text-left font-medium text-zinc-500" onClick={() => handleSort("email")}>
                구글 계정{sortIndicator("email")}
              </th>
              <th className="sortable px-4 py-3 text-center font-medium text-zinc-500" onClick={() => handleSort("salary")}>
                급여유형{sortIndicator("salary")}
              </th>
              <th
                className="sortable px-4 py-3 text-center font-medium text-zinc-500"
                title={`${selectedYear}년에 시수 1회 이상 기록된 학생 수 (중복 제외)`}
                onClick={() => handleSort("active")}
              >
                재원{sortIndicator("active")}
              </th>
              <th
                className="sortable px-4 py-3 text-center font-medium text-emerald-600"
                title={`${selectedYear}년 시작일 기준 신규 등록`}
                onClick={() => handleSort("newcomers")}
              >
                신입{sortIndicator("newcomers")}
              </th>
              <th
                className="sortable px-4 py-3 text-center font-medium text-rose-600"
                title={`${selectedYear}년 종료일 기준 퇴원`}
                onClick={() => handleSort("leavers")}
              >
                퇴원{sortIndicator("leavers")}
              </th>
              {isMaster && (
                <th className="px-4 py-3 text-left font-medium text-zinc-500">시트</th>
              )}
              <th className="sortable px-4 py-3 text-center font-medium text-zinc-500" onClick={() => handleSort("status")}>
                출석부{sortIndicator("status")}
              </th>
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
                  <td className="px-4 py-3 text-center">
                    {(() => {
                      const s = resolveSalary(teacher.id);
                      const label =
                        s.type === "commission" ? "프리랜서" :
                        s.type === "fixed" ? "급여제" : "혼합";
                      const cls =
                        s.type === "commission"
                          ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 hover:bg-blue-100"
                          : s.type === "fixed"
                          ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 hover:bg-zinc-200"
                          : "bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300 hover:bg-purple-100";
                      const isEditing = salaryEditingId === teacher.id;
                      return isEditing ? (
                        <div className="inline-flex items-center gap-1">
                          {(["commission", "fixed", "mixed"] as SalaryType[]).map((t) => (
                            <button
                              key={t}
                              disabled={!!savingSalary}
                              onClick={async () => {
                                await setSalaryType(teacher.id, t, s.days);
                                setSalaryEditingId(null);
                              }}
                              className={`rounded-sm px-1.5 py-0.5 text-[11px] font-medium border ${
                                s.type === t
                                  ? "border-blue-500 bg-blue-100 text-blue-800"
                                  : "border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50"
                              }`}
                            >
                              {t === "commission" ? "프리랜서" : t === "fixed" ? "급여제" : "혼합"}
                            </button>
                          ))}
                          <button
                            onClick={() => setSalaryEditingId(null)}
                            className="text-[11px] text-zinc-400 hover:text-zinc-600 px-1"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setSalaryEditingId(teacher.id)}
                          className={`inline-flex rounded-sm px-2 py-0.5 text-[11px] font-medium cursor-pointer ${cls}`}
                          title={
                            s.type === "mixed" && s.days.length > 0
                              ? `비율제 요일: ${s.days.join(",")} — 클릭해서 변경`
                              : "클릭해서 변경"
                          }
                        >
                          {label}
                          {s.type === "mixed" && s.days.length > 0 && (
                            <span className="ml-1 text-[9px] text-zinc-400">({s.days.join(",")})</span>
                          )}
                        </button>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3 text-center font-medium text-zinc-700 dark:text-zinc-200">
                    {yearStatsMap[teacher.id]?.active || 0}
                  </td>
                  <td className="px-4 py-3 text-center text-emerald-600 dark:text-emerald-400">
                    {yearStatsMap[teacher.id]?.newcomers
                      ? `+${yearStatsMap[teacher.id].newcomers}`
                      : "-"}
                  </td>
                  <td className="px-4 py-3 text-center text-rose-600 dark:text-rose-400">
                    {yearStatsMap[teacher.id]?.leavers
                      ? `-${yearStatsMap[teacher.id].leavers}`
                      : "-"}
                  </td>
                  {isMaster && (
                    <td className="px-4 py-3 text-xs">
                      {editingSheetId === teacher.id ? (
                        <div className="flex gap-1">
                          <input
                            type="text"
                            value={sheetUrlDraft}
                            onChange={(e) => setSheetUrlDraft(e.target.value)}
                            placeholder="URL 또는 시트 ID"
                            className="w-56 rounded-sm border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                          />
                          <button
                            onClick={async () => {
                              const v = sheetUrlDraft.trim();
                              if (!v) return;
                              const newId = extractSheetId(v);
                              // 중복 검사: 다른 선생님이 이미 같은 시트 ID 사용 중
                              const existingUsers = (sheetIdUsage.get(newId) || []).filter(
                                (tid) => tid !== teacher.id
                              );
                              if (existingUsers.length > 0) {
                                const names = existingUsers.map(
                                  (tid) => teachers.find((t) => t.id === tid)?.name || tid
                                );
                                const proceed = confirm(
                                  `⚠ 이 시트 ID는 이미 [${names.join(", ")}]에게 등록되어 있습니다.\n\n그래도 저장하시겠습니까?`
                                );
                                if (!proceed) return;
                              }
                              const url = v.startsWith("http")
                                ? v
                                : `https://docs.google.com/spreadsheets/d/${v}/edit`;
                              await upsertSheet(teacher.id, url);
                              setEditingSheetId(null);
                              setSheetUrlDraft("");
                            }}
                            className="rounded-sm bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
                          >
                            저장
                          </button>
                          <button
                            onClick={() => { setEditingSheetId(null); setSheetUrlDraft(""); }}
                            className="rounded-sm border border-zinc-300 px-2 py-1 text-xs text-zinc-500"
                          >
                            취소
                          </button>
                        </div>
                      ) : sheetMap[teacher.id] ? (
                        <div className="flex items-center gap-1">
                          <a
                            href={sheetMap[teacher.id].url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex rounded-sm bg-blue-50 px-2 py-0.5 text-blue-700 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300"
                          >
                            등록됨
                          </a>
                          {(() => {
                            const dups = getDuplicateInfo(teacher.id);
                            return dups.length > 0 ? (
                              <span
                                className="inline-flex rounded-sm bg-red-100 px-1.5 py-0.5 font-bold text-red-700 dark:bg-red-950 dark:text-red-300"
                                title={`동일 시트 ID 사용: ${dups.join(", ")}`}
                              >
                                ⚠ 중복
                              </span>
                            ) : null;
                          })()}
                          <button
                            onClick={() => handleSync(teacher.id, teacher.name, sheetMap[teacher.id].url)}
                            disabled={syncingId === teacher.id}
                            className="rounded-sm bg-emerald-600 px-2 py-0.5 text-white hover:bg-emerald-700 disabled:bg-zinc-300"
                          >
                            {syncingId === teacher.id ? "..." : "동기화"}
                          </button>
                          <button
                            onClick={() => {
                              setSheetUrlDraft(sheetMap[teacher.id].url);
                              setEditingSheetId(teacher.id);
                            }}
                            className="text-zinc-400 hover:text-zinc-600"
                            title="수정"
                          >
                            ✎
                          </button>
                          <button
                            onClick={async () => {
                              if (!confirm(`${teacher.name} 시트 연결 삭제?`)) return;
                              await deleteSheet(teacher.id);
                            }}
                            className="text-red-400 hover:text-red-600"
                            title="삭제"
                          >
                            ✕
                          </button>
                          {syncResults[teacher.id] && (
                            <span className="ml-1 text-zinc-500">
                              {syncResults[teacher.id].error
                                ? `❌`
                                : `✓ ${syncResults[teacher.id].months.length}개월`}
                            </span>
                          )}
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setSheetUrlDraft("");
                            setEditingSheetId(teacher.id);
                          }}
                          className="text-zinc-400 hover:text-blue-600"
                        >
                          + 등록
                        </button>
                      )}
                    </td>
                  )}
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => toggleHidden(teacher.id)}
                      className={`inline-flex rounded-sm px-2.5 py-1 text-xs font-medium transition-colors ${
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

      {/* 일괄 등록 모달 */}
      {bulkOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                시트 일괄 등록
              </h3>
              <button
                onClick={() => { setBulkOpen(false); setBulkResult(null); }}
                className="text-zinc-400 hover:text-zinc-600"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-zinc-500 mb-2">
              형식: <code>선생님이름[탭 또는 공백]시트ID또는URL</code> — 한 줄에 하나씩. 존재하지 않는 선생님은 스킵됩니다.
            </p>
            <textarea
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              className="w-full h-64 rounded-sm border border-zinc-300 bg-white p-3 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              spellCheck={false}
            />

            {bulkResult && (
              <div className="mt-3 rounded-sm border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-700 dark:bg-zinc-800">
                <div className="font-semibold text-emerald-600 mb-1">
                  ✓ 등록 {bulkResult.ok.length}건
                </div>
                {bulkResult.ok.slice(0, 5).map((n, i) => (
                  <div key={i} className="text-zinc-500">{n}</div>
                ))}
                {bulkResult.ok.length > 5 && (
                  <div className="text-zinc-400">... 외 {bulkResult.ok.length - 5}건</div>
                )}
                {bulkResult.skip.length > 0 && (
                  <>
                    <div className="font-semibold text-amber-600 mt-2 mb-1">
                      ⚠ 스킵 {bulkResult.skip.length}건 (존재하지 않는 선생님)
                    </div>
                    <div className="text-zinc-500">{bulkResult.skip.join(", ")}</div>
                  </>
                )}
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => { setBulkOpen(false); setBulkResult(null); }}
                className="rounded-sm border border-zinc-300 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                닫기
              </button>
              <button
                onClick={handleBulkImport}
                className="rounded-sm bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                등록 실행
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
