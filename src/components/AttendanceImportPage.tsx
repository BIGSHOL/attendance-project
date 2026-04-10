"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import { useStaff } from "@/hooks/useStaff";
import { useStudents } from "@/hooks/useStudents";
import {
  parseAttendanceExcel,
  parseAttendanceFromArray,
  type ParsedAttendance,
  type AttendanceEntry,
} from "@/lib/parseAttendanceExcel";

interface MatchedEntry extends AttendanceEntry {
  studentId: string | null;
  matchMethod: "이름+학교" | "이름만" | "없음";
}

export default function AttendanceImportPage() {
  const { teachers, loading: staffLoading } = useStaff();
  const { students, loading: studentsLoading } = useStudents();
  const [parsed, setParsed] = useState<ParsedAttendance | null>(null);
  const [teacherId, setTeacherId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [sheetUrl, setSheetUrl] = useState("");
  const [fetchingSheet, setFetchingSheet] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setFileName(file.name);
      try {
        const buffer = await file.arrayBuffer();
        const result = parseAttendanceExcel(buffer);
        setParsed(result);

        // 선생님 자동 매칭
        const cleanName = result.teacherName.replace(/\(.+?\)/g, "").trim();
        const matched = teachers.find(
          (t) =>
            t.name === result.teacherName ||
            t.name === cleanName ||
            t.name.replace(/\(.+?\)/g, "").trim() === cleanName
        );
        setTeacherId(matched?.id || null);
      } catch (e) {
        setError((e as Error).message);
        setParsed(null);
      }
    },
    [teachers]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  // Google Sheets URL로 불러오기
  const handleFetchSheet = async () => {
    if (!sheetUrl.trim()) return;
    setError(null);
    setFetchingSheet(true);
    try {
      const res = await fetch("/api/attendance/import/fetch-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: sheetUrl }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "시트 불러오기 실패");
        return;
      }
      const result = parseAttendanceFromArray(json.values || []);
      setParsed(result);
      setFileName(`📄 Google Sheets (${json.sheetName})`);

      // 선생님 자동 매칭
      const cleanName = result.teacherName.replace(/\(.+?\)/g, "").trim();
      const matched = teachers.find(
        (t) =>
          t.name === result.teacherName ||
          t.name === cleanName ||
          t.name.replace(/\(.+?\)/g, "").trim() === cleanName
      );
      setTeacherId(matched?.id || null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFetchingSheet(false);
    }
  };

  // 학생 매칭
  const matchedEntries = useMemo<MatchedEntry[]>(() => {
    if (!parsed) return [];
    return parsed.entries.map((entry) => {
      // 1차: 이름 + 학교 매칭
      const byNameSchool = students.find(
        (s) =>
          s.name === entry.studentName &&
          (entry.school ? s.school === entry.school : true)
      );
      if (byNameSchool) {
        return { ...entry, studentId: byNameSchool.id, matchMethod: "이름+학교" };
      }
      // 2차: 이름만
      const byName = students.find((s) => s.name === entry.studentName);
      if (byName) {
        return { ...entry, studentId: byName.id, matchMethod: "이름만" };
      }
      return { ...entry, studentId: null, matchMethod: "없음" };
    });
  }, [parsed, students]);

  const stats = useMemo(() => {
    const total = matchedEntries.length;
    const matched = matchedEntries.filter((e) => e.studentId).length;
    const unmatched = total - matched;
    const totalCells = matchedEntries.reduce(
      (sum, e) => sum + Object.keys(e.attendance).length,
      0
    );
    return { total, matched, unmatched, totalCells };
  }, [matchedEntries]);

  const handleSave = async () => {
    if (!parsed || !teacherId) return;
    const unmatched = matchedEntries.filter((e) => !e.studentId);
    if (unmatched.length > 0) {
      const confirmMsg = `매칭 실패한 학생 ${unmatched.length}명이 있습니다. 매칭된 ${stats.matched}명만 저장합니다. 계속?`;
      if (!confirm(confirmMsg)) return;
    }

    const overwriteMsg = `${parsed.year}년 ${parsed.month}월 ${parsed.teacherName} 기존 출석 기록을 덮어씁니다. 계속?`;
    if (!confirm(overwriteMsg)) return;

    setSaving(true);
    const records: Record<string, Record<string, number>> = {};
    for (const e of matchedEntries) {
      if (!e.studentId) continue;
      records[e.studentId] = e.attendance;
    }

    const res = await fetch("/api/attendance/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teacherId,
        year: parsed.year,
        month: parsed.month,
        records,
        overwrite: true,
      }),
    });
    const result = await res.json();
    setSaving(false);

    if (res.ok) {
      alert(`${result.count}건 저장 완료`);
      setParsed(null);
      setFileName(null);
      setTeacherId(null);
    } else {
      alert(result.error || "저장 실패");
    }
  };

  if (staffLoading || studentsLoading) {
    return <div className="text-sm text-zinc-400">불러오는 중...</div>;
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-4">
        출석부 일괄 업로드
      </h2>
      <p className="text-sm text-zinc-500 mb-4">
        기존 출석부 엑셀(담임명, 월, 학생×날짜 형식)을 업로드하여 일괄 입력합니다.
      </p>

      {/* 업로더 */}
      {!parsed && (
        <div className="space-y-4">
          {/* 파일 업로드 */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className="cursor-pointer rounded border-2 border-dashed border-zinc-300 bg-zinc-50 p-10 text-center hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800/50"
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              className="hidden"
            />
            <div className="text-3xl mb-2">📊</div>
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              출석부 엑셀 파일을 여기에 드래그하거나 클릭하여 선택
            </p>
            <p className="text-xs text-zinc-400 mt-1">.xlsx, .xls 지원</p>
          </div>

          {/* 구분선 */}
          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-zinc-200 dark:border-zinc-700"></div>
            <span className="text-xs text-zinc-400">또는</span>
            <div className="flex-1 border-t border-zinc-200 dark:border-zinc-700"></div>
          </div>

          {/* Google Sheets URL */}
          <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
              <span>📄</span> Google Sheets URL 붙여넣기
            </label>
            <p className="text-xs text-zinc-400 mt-1 mb-3">
              로그인한 Google 계정으로 접근 가능한 시트만 읽을 수 있습니다.
            </p>
            <div className="flex gap-2">
              <input
                type="url"
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                className="flex-1 rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
              <button
                onClick={handleFetchSheet}
                disabled={!sheetUrl.trim() || fetchingSheet}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
              >
                {fetchingSheet ? "불러오는 중..." : "불러오기"}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* 미리보기 */}
      {parsed && (
        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-zinc-500">{fileName}</div>
              <div className="mt-1 flex items-center gap-3">
                <span className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                  {parsed.teacherName}
                </span>
                <span className="text-sm text-zinc-500">
                  {parsed.year}년 {parsed.month}월
                </span>
                <span className="text-sm text-zinc-500">
                  날짜 {parsed.dateColumns.length}일
                </span>
              </div>
            </div>
            <button
              onClick={() => { setParsed(null); setFileName(null); setTeacherId(null); }}
              className="text-sm text-zinc-500 hover:text-zinc-700"
            >
              취소
            </button>
          </div>

          {/* 선생님 매칭 */}
          <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              담당 선생님
            </div>
            <select
              value={teacherId || ""}
              onChange={(e) => setTeacherId(e.target.value || null)}
              className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              <option value="">선생님 선택</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {!teacherId && (
              <p className="mt-1 text-xs text-red-500">선생님을 선택해야 저장 가능합니다.</p>
            )}
          </div>

          {/* 통계 */}
          <div className="grid grid-cols-4 gap-3">
            <div className="rounded border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="text-xs text-zinc-500">총 학생</div>
              <div className="text-lg font-bold">{stats.total}명</div>
            </div>
            <div className="rounded border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="text-xs text-zinc-500">매칭됨</div>
              <div className="text-lg font-bold text-emerald-600">{stats.matched}명</div>
            </div>
            <div className="rounded border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="text-xs text-zinc-500">매칭 실패</div>
              <div className="text-lg font-bold text-red-600">{stats.unmatched}명</div>
            </div>
            <div className="rounded border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="text-xs text-zinc-500">출석 기록</div>
              <div className="text-lg font-bold">{stats.totalCells}건</div>
            </div>
          </div>

          {/* 매칭 결과 테이블 */}
          <div className="overflow-hidden border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-800">
                  <tr className="border-b border-zinc-200 dark:border-zinc-700">
                    <th className="px-3 py-2 text-left font-medium text-zinc-500">#</th>
                    <th className="px-3 py-2 text-left font-medium text-zinc-500">학생</th>
                    <th className="px-3 py-2 text-left font-medium text-zinc-500">학교</th>
                    <th className="px-3 py-2 text-left font-medium text-zinc-500">학년</th>
                    <th className="px-3 py-2 text-center font-medium text-zinc-500">매칭</th>
                    <th className="px-3 py-2 text-right font-medium text-zinc-500">출석일</th>
                  </tr>
                </thead>
                <tbody>
                  {matchedEntries.map((e, idx) => (
                    <tr
                      key={idx}
                      className={`border-b border-zinc-100 dark:border-zinc-800 ${
                        !e.studentId ? "bg-red-50 dark:bg-red-950/30" : ""
                      }`}
                    >
                      <td className="px-3 py-2 text-zinc-400">{idx + 1}</td>
                      <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">
                        {e.studentName}
                      </td>
                      <td className="px-3 py-2 text-zinc-500">{e.school || "-"}</td>
                      <td className="px-3 py-2 text-zinc-500">{e.grade || "-"}</td>
                      <td className="px-3 py-2 text-center">
                        {e.studentId ? (
                          <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
                            {e.matchMethod}
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300">
                            실패
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-zinc-500">
                        {Object.keys(e.attendance).length}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            {saving && <span className="text-sm text-blue-600">저장 중...</span>}
            <button
              onClick={handleSave}
              disabled={!teacherId || saving}
              className="rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              저장 (덮어쓰기)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
