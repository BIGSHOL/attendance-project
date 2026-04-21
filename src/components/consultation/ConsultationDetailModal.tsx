"use client";

import { useEffect } from "react";
import { toSubjectLabel } from "@/lib/labelMap";
import type { Consultation, ConsultationCategory } from "@/types";

interface Props {
  consultation: Consultation | null;
  onClose: () => void;
}

const CATEGORY_LABEL: Record<ConsultationCategory, string> = {
  academic: "학업",
  behavior: "생활/태도",
  attendance: "출결",
  progress: "진도",
  concern: "고민",
  compliment: "칭찬",
  complaint: "불만",
  general: "일반",
  other: "기타",
};

function formatDateKorean(date: string): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) return date;
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${String(d.getFullYear()).slice(2)}.${mm}.${dd} (${days[d.getDay()]})`;
}

function formatTime(time?: string): string {
  if (!time) return "";
  return time;
}

export default function ConsultationDetailModal({ consultation, onClose }: Props) {
  useEffect(() => {
    if (!consultation) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // 스크롤 잠금
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [consultation, onClose]);

  if (!consultation) return null;

  const c = consultation;
  const typeLabel = c.type === "parent" ? "학부모 상담" : "학생 상담";
  const categoryLabel = CATEGORY_LABEL[c.category] ?? c.category;
  const subjectLabel = c.subject ? toSubjectLabel(c.subject) : null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex flex-shrink-0 items-start justify-between border-b border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                {c.studentName}
              </span>
              <span
                className={`inline-block rounded-sm px-2 py-0.5 text-[10px] font-bold ${
                  c.type === "parent"
                    ? "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300"
                    : "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300"
                }`}
              >
                {typeLabel}
              </span>
              {subjectLabel && (
                <span className="inline-block rounded-sm bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                  {subjectLabel}
                </span>
              )}
              <span className="inline-block rounded-sm bg-zinc-100 px-2 py-0.5 text-[10px] font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {categoryLabel}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="tabular-nums">{formatDateKorean(c.date)}</span>
              {c.time && <span className="tabular-nums">{formatTime(c.time)}</span>}
              {c.duration != null && <span>{c.duration}분</span>}
              <span>· 상담자 {c.consultantName}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-sm text-zinc-500 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-800"
            aria-label="닫기"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto px-4 py-3 text-sm">
          {/* 제목 */}
          {c.title && (
            <div className="mb-3">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
                제목
              </div>
              <div className="font-bold text-zinc-900 dark:text-zinc-100">{c.title}</div>
            </div>
          )}

          {/* 학부모 정보 */}
          {c.type === "parent" && (c.parentName || c.parentRelation) && (
            <div className="mb-3">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
                보호자
              </div>
              <div className="text-zinc-800 dark:text-zinc-200">
                {c.parentName ?? ""}
                {c.parentRelation && (
                  <span className="ml-1 text-zinc-500 dark:text-zinc-400">
                    ({c.parentRelation})
                  </span>
                )}
              </div>
            </div>
          )}

          {/* 학생 기분 */}
          {c.type === "student" && c.studentMood && (
            <div className="mb-3">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
                학생 기분
              </div>
              <span
                className={`inline-block rounded-sm px-2 py-0.5 text-xs font-bold ${
                  c.studentMood === "positive"
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
                    : c.studentMood === "negative"
                      ? "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300"
                      : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                }`}
              >
                {c.studentMood === "positive"
                  ? "긍정"
                  : c.studentMood === "negative"
                    ? "부정"
                    : "보통"}
              </span>
            </div>
          )}

          {/* 상담 내용 */}
          <div className="mb-3">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
              상담 내용
            </div>
            <div className="whitespace-pre-wrap rounded-sm border border-zinc-200 bg-zinc-50 px-3 py-2 text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
              {c.content || <span className="text-zinc-400">내용 없음</span>}
            </div>
          </div>

          {/* 후속 조치 */}
          {(c.followUpNeeded || c.followUpDone || c.followUpNotes) && (
            <div className="mb-3">
              <div className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
                <span>후속 조치</span>
                {c.followUpNeeded && !c.followUpDone && (
                  <span className="inline-block rounded-sm bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold normal-case text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                    필요
                  </span>
                )}
                {c.followUpNeeded && c.followUpDone && (
                  <span className="inline-block rounded-sm bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold normal-case text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                    완료
                  </span>
                )}
              </div>
              {c.followUpDate && (
                <div className="mb-1 text-xs text-zinc-700 dark:text-zinc-300">
                  예정일: <span className="tabular-nums">{formatDateKorean(c.followUpDate)}</span>
                </div>
              )}
              {c.followUpNotes && (
                <div className="whitespace-pre-wrap rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-zinc-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-zinc-200">
                  {c.followUpNotes}
                </div>
              )}
            </div>
          )}

          {/* 메타 */}
          <div className="mt-4 border-t border-zinc-100 pt-2 text-[10px] text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
            <div>
              작성 {new Date(c.createdAt).toLocaleString("ko-KR")}
              {c.updatedAt !== c.createdAt && (
                <> · 수정 {new Date(c.updatedAt).toLocaleString("ko-KR")}</>
              )}
            </div>
            <div className="mt-0.5">ijw-calander 상담 #{c.id}</div>
          </div>
        </div>

        {/* 푸터 */}
        <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-zinc-200 bg-zinc-50 px-4 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-950">
          <span className="text-zinc-500 dark:text-zinc-400">
            Esc 또는 배경 클릭으로 닫기
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-zinc-300 bg-white px-3 py-1 font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
