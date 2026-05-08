"use client";

import { useEffect, useMemo, useState } from "react";
import { cachedFetch } from "@/lib/fetchCache";
import {
  extractNameAliases,
  formatSchoolGrade,
  matchesTeacher,
} from "@/lib/consultationHelpers";
import type { Consultation, Student, Teacher } from "@/types";

/**
 * 상담 상세 모달 — 선택된 이벤트 행을 중앙 오버레이로 표시.
 *   filterTeacher 가 있으면 이전 월 이력을 해당 선생님 본인 상담만 필터 (전체 담임 뷰면 null)
 *
 * ConsultationsPageV2.tsx 에서 분리됨 — 동작 변경 없음.
 */
export default function ConsultationModal({
  row,
  month,
  filterTeacher,
  filterTeacherName,
  onClose,
}: {
  row: {
    key: string;
    student: Student;
    className: string;
    homeroomNames: string[];
    status: "done" | "pending";
    consultation: Consultation | null;
    allConsultations: Consultation[];
  };
  month: string;
  filterTeacher: Teacher | null;
  filterTeacherName: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 지금 본문에 표시 중인 상담 — 리스트 항목 클릭으로 바뀜(페이지 이동 없이).
  //   row 가 바뀌면(학생 이동) 원래 상담으로 리셋.
  const [viewing, setViewing] = useState<Consultation | null>(row.consultation);
  useEffect(() => {
    setViewing(row.consultation);
  }, [row.key, row.consultation]);

  // 이전 월 이력 — 모달 열릴 때 API 호출, 월 변경되면 재조회.
  const [pastHistoryAll, setPastHistoryAll] = useState<Consultation[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const studentId = row.student.id;
    const url = `/api/consultations/student-history?studentId=${encodeURIComponent(
      studentId
    )}&beforeMonth=${encodeURIComponent(month)}&limit=30`;
    setHistoryLoading(true);
    setHistoryError(false);
    (async () => {
      try {
        const data = await cachedFetch<Consultation[]>(url);
        if (!cancelled) setPastHistoryAll(data);
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

  // 현재 선생님 기준 필터 + 10건 제한. 전체 담임 뷰면 필터 없이 그대로.
  const pastHistory = useMemo(() => {
    if (!pastHistoryAll) return null;
    if (!filterTeacher && !filterTeacherName) return pastHistoryAll.slice(0, 10);
    const nameAliases = new Set(
      extractNameAliases(filterTeacherName ?? "").map((n) => n.toLowerCase())
    );
    return pastHistoryAll
      .filter((c) => {
        if (matchesTeacher(c.consultantName, filterTeacher ?? undefined)) return true;
        const consAliases = extractNameAliases(c.consultantName ?? "").map((n) => n.toLowerCase());
        return consAliases.some((x) => nameAliases.has(x));
      })
      .slice(0, 10);
  }, [pastHistoryAll, filterTeacher, filterTeacherName]);

  const c = viewing;
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
              {viewing ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                  ✓ 완료
                </span>
              ) : (
                <span className="rounded-full bg-amber-100 px-2 py-0 text-[10px] font-bold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                  ! 미상담
                </span>
              )}
              {/* 원래 열었던 상담이 아닌 다른 항목 보는 중일 때 되돌리기 */}
              {row.consultation && viewing?.id !== row.consultation.id && (
                <button
                  type="button"
                  onClick={() => setViewing(row.consultation)}
                  className="rounded-sm border border-zinc-300 bg-white px-1.5 py-0 text-[10px] text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                  title="처음 열었던 상담으로 돌아가기"
                >
                  ↺ 원래 상담
                </button>
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
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => setViewing(h)}
                    className="flex items-baseline gap-2 border-l-2 border-zinc-200 pl-2 text-left transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800/50"
                    title="이 상담으로 이동"
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
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 이전 월 이력 — API 조회, 본인 상담만 필터, 최대 10건 */}
          <div className="mt-5">
            <div className="mb-1.5 flex items-baseline gap-2">
              <span className="text-[11px] font-medium text-zinc-500">
                이전 월 상담 이력
                {pastHistory && ` · ${pastHistory.length}건`}
                {pastHistory && pastHistory.length >= 10 && (
                  <span className="ml-1 text-[10px] text-zinc-400">(최근 10건)</span>
                )}
                {filterTeacherName && (
                  <span className="ml-1 text-[10px] text-zinc-400">· {filterTeacherName} 본인</span>
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
                {pastHistory.map((h) => {
                  const isViewing = viewing?.id === h.id;
                  return (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() => setViewing(h)}
                      className={`flex items-baseline gap-2 border-l-2 pl-2 text-left transition-colors ${
                        isViewing
                          ? "border-blue-500 bg-blue-50/60 dark:border-blue-400 dark:bg-blue-950/40"
                          : "border-blue-200 hover:bg-zinc-50 dark:border-blue-900 dark:hover:bg-zinc-800/50"
                      }`}
                      title="이 상담으로 이동"
                    >
                      <span className="w-24 flex-shrink-0 text-[11px] tabular-nums text-zinc-500">
                        {h.date}
                      </span>
                      <span
                        className={`truncate text-xs ${
                          isViewing
                            ? "font-bold text-zinc-900 dark:text-zinc-100"
                            : "text-zinc-700 dark:text-zinc-300"
                        }`}
                      >
                        {h.title}
                      </span>
                      <span className="ml-auto flex-shrink-0 text-[10px] text-zinc-400">
                        {h.type === "parent" ? "학부모" : "학생"}
                        {h.consultantName ? ` · ${h.consultantName}` : ""}
                      </span>
                    </button>
                  );
                })}
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
