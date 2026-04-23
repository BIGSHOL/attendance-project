"use client";

import { useEffect, useState } from "react";
import type { NoteInspection, NoteInspectionStatus, Student } from "@/types";
import { NOTE_INSPECTION_STATUS_LABEL } from "@/types";

/**
 * 노트 검사 기록 입력·편집 모달 (V1/V2 공용)
 *   - existing 이 있으면 수정/삭제, 없으면 신규 추가
 *   - 학생/선생님 정보는 호출부에서 고정값으로 전달 (선택 UI는 없음)
 */
interface Props {
  student: Student;
  teacherName: string;
  month: string;                      // YYYY-MM — 날짜 기본값 생성용
  existing?: NoteInspection | null;
  onClose: () => void;
  onSave: (input: {
    status: NoteInspectionStatus;
    date: string;
    memo?: string;
  }) => Promise<void>;
  onDelete?: () => Promise<void>;
}

export default function NoteInspectionModal({
  student,
  teacherName,
  month,
  existing,
  onClose,
  onSave,
  onDelete,
}: Props) {
  const today = new Date();
  const defaultDate =
    existing?.date ??
    (() => {
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      // 오늘이 선택 월 안에 있으면 오늘, 아니면 해당 월 1일
      return todayStr.startsWith(month) ? todayStr : `${month}-01`;
    })();

  const [status, setStatus] = useState<NoteInspectionStatus>(existing?.status ?? "done");
  const [date, setDate] = useState<string>(defaultDate);
  const [memo, setMemo] = useState<string>(existing?.memo ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ESC 로 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSave = async () => {
    setSaving(true);
    setErrorMsg(null);
    try {
      await onSave({ status, date, memo: memo.trim() || undefined });
      onClose();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    if (!confirm("이 노트 검사 기록을 삭제하시겠습니까?")) return;
    setDeleting(true);
    setErrorMsg(null);
    try {
      await onDelete();
      onClose();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "삭제 실패");
    } finally {
      setDeleting(false);
    }
  };

  const statusOptions: NoteInspectionStatus[] = ["done", "needs_fix", "missing"];
  const statusColor: Record<NoteInspectionStatus, string> = {
    done: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800",
    needs_fix:
      "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800",
    missing:
      "bg-red-100 text-red-800 border-red-300 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/50 p-4 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-[500px] max-w-full flex-col rounded-sm border border-zinc-300 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
      >
        {/* 헤더 */}
        <div className="flex items-start gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-zinc-500">
              노트 검사 · {teacherName}
            </div>
            <h3 className="mt-0.5 text-base font-bold text-zinc-900 dark:text-zinc-100">
              {student.name}
              <span className="ml-2 text-xs font-normal text-zinc-500">
                {existing ? "기록 편집" : "새 기록"}
              </span>
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="flex-shrink-0 rounded-sm px-2 py-1 text-base leading-none text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            ✕
          </button>
        </div>

        {/* 본문 */}
        <div className="flex flex-col gap-3 px-4 py-4">
          {/* 상태 선택 */}
          <div>
            <label className="mb-1 block text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
              상태
            </label>
            <div className="flex gap-1.5">
              {statusOptions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={`rounded-sm border px-3 py-1.5 text-xs font-medium transition-colors ${
                    status === s
                      ? statusColor[s]
                      : "border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
                  }`}
                >
                  {NOTE_INSPECTION_STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </div>

          {/* 날짜 */}
          <div>
            <label
              htmlFor="note-date"
              className="mb-1 block text-[11px] font-medium text-zinc-600 dark:text-zinc-400"
            >
              날짜
            </label>
            <input
              id="note-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-8 w-full rounded-sm border border-zinc-300 bg-white px-2 text-xs text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>

          {/* 메모 */}
          <div>
            <label
              htmlFor="note-memo"
              className="mb-1 block text-[11px] font-medium text-zinc-600 dark:text-zinc-400"
            >
              메모 (선택)
            </label>
            <textarea
              id="note-memo"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              rows={3}
              placeholder="검사 내용·보완 사항 등"
              className="w-full rounded-sm border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>

          {errorMsg && (
            <div className="rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
              {errorMsg}
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div className="flex items-center justify-between gap-2 border-t border-zinc-200 px-4 py-2 dark:border-zinc-800">
          <div>
            {existing && onDelete && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving || deleting}
                className="rounded-sm border border-red-200 bg-white px-3 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:bg-zinc-800 dark:text-red-400 dark:hover:bg-red-950/30"
              >
                {deleting ? "삭제 중…" : "삭제"}
              </button>
            )}
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={onClose}
              disabled={saving || deleting}
              className="rounded-sm border border-zinc-300 bg-white px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || deleting || !date}
              className="rounded-sm bg-blue-600 px-4 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "저장 중…" : existing ? "저장" : "추가"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
