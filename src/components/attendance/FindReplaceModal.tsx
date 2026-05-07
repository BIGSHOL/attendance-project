"use client";

import { useEffect, useMemo, useState } from "react";
import type { Student } from "@/types";
import { formatDateKey } from "@/lib/date";

interface Match {
  studentId: string;
  studentName: string;
  dateKey: string;
  before: string;
  after: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** 검색·치환 대상 학생 목록 (현재 표시 행) */
  students: Student[];
  /** 검색·치환 대상 날짜 목록 (현재 표시 컬럼) */
  dates: Date[];
  /** 메모 갱신 콜백 — useAttendanceData.updateMemo */
  onMemoChange: (studentId: string, dateKey: string, memo: string) => void;
}

/**
 * 시트 Ctrl+H 대체 — 메모 일괄 찾기/바꾸기 (audit E).
 *
 * 시트 셀 메모(노란 모서리)와 동등 매칭. 출석값은 숫자라 검색 대상 외.
 * 사용자가 매칭 결과를 보고 일부 선택해서 바꾸거나, 전부 바꾸기 가능.
 */
export default function FindReplaceModal({
  isOpen,
  onClose,
  students,
  dates,
  onMemoChange,
}: Props) {
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  // 모달 닫힐 때 입력 초기화 X (사용자가 다시 열 때 편의). 단, 제외 set 만 reset.
  useEffect(() => {
    if (isOpen) setExcluded(new Set());
  }, [isOpen]);

  const matches = useMemo<Match[]>(() => {
    const q = findText;
    if (!q) return [];
    const cmp = caseSensitive ? q : q.toLowerCase();
    const out: Match[] = [];
    const dateSet = new Set(dates.map((d) => formatDateKey(d)));
    for (const s of students) {
      const memos = s.memos || {};
      for (const [dk, memo] of Object.entries(memos)) {
        if (!memo) continue;
        if (!dateSet.has(dk)) continue; // 표시 중인 날짜만
        const target = caseSensitive ? memo : memo.toLowerCase();
        if (!target.includes(cmp)) continue;
        // 치환 — 대소문자 무시 모드여도 원본 케이스 보존하려면 정규식 i 플래그 필요
        let after = memo;
        if (caseSensitive) {
          after = memo.split(q).join(replaceText);
        } else {
          // 정규식 escape
          const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          after = memo.replace(new RegExp(escaped, "gi"), replaceText);
        }
        out.push({
          studentId: s.id,
          studentName: s.name,
          dateKey: dk,
          before: memo,
          after,
        });
      }
    }
    return out;
  }, [findText, replaceText, caseSensitive, students, dates]);

  const toggleExclude = (key: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const applyAll = () => {
    if (matches.length === 0) return;
    const target = matches.filter(
      (m) => !excluded.has(`${m.studentId}|${m.dateKey}`)
    );
    if (target.length === 0) {
      alert("적용할 매치가 없습니다 (모두 제외됨).");
      return;
    }
    if (
      !confirm(
        `${target.length}개 메모를 "${findText}" → "${replaceText}" 로 일괄 치환합니다. 계속할까요?`
      )
    )
      return;
    for (const m of target) {
      onMemoChange(m.studentId, m.dateKey, m.after);
    }
    setExcluded(new Set());
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 p-4 pt-12"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
            🔍 메모 찾기/바꾸기
            <span className="ml-2 text-xs font-normal text-zinc-500">
              (Ctrl+H — 시트와 동일)
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-sm text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        {/* 입력 */}
        <div className="flex-shrink-0 space-y-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <label className="w-12 text-xs text-zinc-500">찾기</label>
            <input
              type="text"
              value={findText}
              onChange={(e) => setFindText(e.target.value)}
              autoFocus
              placeholder="검색할 텍스트"
              className="flex-1 rounded-sm border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="w-12 text-xs text-zinc-500">바꾸기</label>
            <input
              type="text"
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              placeholder="치환할 텍스트 (비우면 삭제)"
              className="flex-1 rounded-sm border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            />
          </div>
          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1 text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={(e) => setCaseSensitive(e.target.checked)}
              />
              대소문자 구분
            </label>
            <span className="ml-auto text-zinc-500">
              매치{" "}
              <b className="text-zinc-900 dark:text-zinc-100">
                {matches.length}
              </b>
              건 / 적용 대상{" "}
              <b className="text-blue-700 dark:text-blue-300">
                {matches.length - excluded.size}
              </b>
              건
            </span>
          </div>
        </div>

        {/* 매치 목록 */}
        <div className="flex-1 overflow-y-auto px-4 py-2 text-xs">
          {findText.length === 0 ? (
            <div className="py-6 text-center text-zinc-400">
              "찾기" 에 텍스트를 입력하세요.
            </div>
          ) : matches.length === 0 ? (
            <div className="py-6 text-center text-zinc-400">
              매치된 메모가 없습니다.
            </div>
          ) : (
            <ul className="space-y-1">
              {matches.map((m) => {
                const key = `${m.studentId}|${m.dateKey}`;
                const isExcluded = excluded.has(key);
                return (
                  <li
                    key={key}
                    className={`flex items-start gap-2 rounded-sm border px-2 py-1.5 ${
                      isExcluded
                        ? "border-zinc-200 bg-zinc-50 opacity-60 dark:border-zinc-800 dark:bg-zinc-900"
                        : "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={!isExcluded}
                      onChange={() => toggleExclude(key)}
                      className="mt-0.5 flex-shrink-0"
                    />
                    <div className="flex-1">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">
                        {m.studentName}{" "}
                        <span className="text-[10px] text-zinc-500">
                          {m.dateKey.slice(5)}
                        </span>
                      </div>
                      <div className="mt-0.5">
                        <span className="text-rose-600 line-through dark:text-rose-400">
                          {m.before}
                        </span>{" "}
                        →{" "}
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                          {m.after || "(삭제)"}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* 푸터 */}
        <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-zinc-200 bg-zinc-50 px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950">
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            취소
          </button>
          <button
            type="button"
            onClick={applyAll}
            disabled={matches.length === 0 || matches.length - excluded.size === 0}
            className="rounded-sm bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            ✓ 일괄 적용 ({matches.length - excluded.size})
          </button>
        </div>
      </div>
    </div>
  );
}
