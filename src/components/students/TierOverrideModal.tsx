"use client";

import { useEffect, useMemo, useState } from "react";
import { useStaff } from "@/hooks/useStaff";
import { useSalaryConfig } from "@/hooks/useSalaryConfig";
import { toSubjectLabel } from "@/lib/labelMap";
import type { SalarySettingItem } from "@/types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  studentId: string;
  studentName?: string;
  /** 저장 성공 후 부모 refetch 트리거 */
  onSaved?: () => void;
  /**
   * 모달 열 때 선생님 dropdown 자동 prefill (출석부에서 부르면 현재 선택된 선생님).
   *   사용자가 dropdown 으로 다른 선생님 선택 가능.
   */
  prefilledTeacherId?: string;
}

/**
 * 학생 수강 분반 추가 모달 (audit J — class_name 별 다른 단가 지원).
 *
 * 입력:
 *   - 선생님 (useStaff)
 *   - 분반 이름 (자유 텍스트, 시트 F열 형식 권장 — "초등 3T", "TP2Q" 등)
 *   - tier (useSalaryConfig.items)
 *
 * 저장:
 *   PUT /api/attendance/tier-overrides
 *   body: { teacherId, overrides: [{ student_id, class_name, salary_item_id, tier_name, is_manual: true }] }
 *
 * is_manual=true 로 저장됨 → 시트 sync 시 보호.
 */
export default function TierOverrideModal({
  isOpen,
  onClose,
  studentId,
  studentName,
  onSaved,
  prefilledTeacherId,
}: Props) {
  const { teachers } = useStaff();
  const { config } = useSalaryConfig();

  const [teacherId, setTeacherId] = useState("");
  const [className, setClassName] = useState("");
  const [salaryItemId, setSalaryItemId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 모달 열릴 때 입력 리셋. prefilledTeacherId 있으면 선생님 dropdown 자동 선택.
  useEffect(() => {
    if (isOpen) {
      setTeacherId(prefilledTeacherId || "");
      setClassName("");
      setSalaryItemId("");
      setError(null);
    }
  }, [isOpen, prefilledTeacherId]);

  // 선택된 선생님의 과목으로 tier 후보 필터.
  //   선택 안 했으면 전체 표시.
  const tierItems = useMemo<SalarySettingItem[]>(() => {
    const items = config.items || [];
    if (!teacherId) return items;
    const t = teachers.find((x) => x.id === teacherId);
    if (!t || !t.subjects || t.subjects.length === 0) return items;
    // SalarySubject 와 enrollment subject 가 다를 수 있으나, items 는 subject 필드 있음.
    return items.filter((it) => !it.subject || t.subjects?.includes(it.subject));
  }, [config.items, teacherId, teachers]);

  const selectedTier = useMemo(
    () => (config.items || []).find((i) => i.id === salaryItemId),
    [config.items, salaryItemId]
  );

  const handleSave = async () => {
    setError(null);
    if (!teacherId) return setError("선생님을 선택하세요.");
    if (!className.trim()) return setError("분반 이름을 입력하세요.");
    if (!salaryItemId) return setError("tier(단가) 를 선택하세요.");
    if (!selectedTier) return setError("선택한 tier 를 찾을 수 없음.");

    setSaving(true);
    try {
      const res = await fetch("/api/attendance/tier-overrides", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teacherId,
          overrides: [
            {
              student_id: studentId,
              class_name: className.trim(),
              salary_item_id: selectedTier.id,
              tier_name: selectedTier.name,
              is_manual: true,
            },
          ],
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 p-4 pt-16"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-md flex-col overflow-hidden border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
            🔧 수강 분반 추가
            {studentName && (
              <span className="ml-2 text-xs font-normal text-zinc-500">
                ({studentName})
              </span>
            )}
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

        {/* 본문 */}
        <div className="flex-1 space-y-3 px-4 py-3 text-sm">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">
              담당 선생님
            </label>
            <select
              value={teacherId}
              onChange={(e) => setTeacherId(e.target.value)}
              className="w-full rounded-sm border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            >
              <option value="">선택...</option>
              {teachers
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name, "ko"))
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.subjects && t.subjects.length > 0 &&
                      ` (${t.subjects.map(toSubjectLabel).join(", ")})`}
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">
              분반 이름 (시트 F열 형식 권장)
            </label>
            <input
              type="text"
              value={className}
              onChange={(e) => setClassName(e.target.value)}
              placeholder="예: 초등 3T, TP2Q, CR1C"
              className="w-full rounded-sm border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            />
            <p className="mt-1 text-[10px] text-zinc-400">
              같은 (선생님, 학생) 조합으로 다른 분반 이름 = 다른 단가 행으로 분리됨.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">
              tier (단가)
            </label>
            <select
              value={salaryItemId}
              onChange={(e) => setSalaryItemId(e.target.value)}
              className="w-full rounded-sm border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            >
              <option value="">선택...</option>
              {tierItems.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name}
                  {it.baseTuition ? ` — ${it.baseTuition.toLocaleString()}원` : ""}
                  {it.type === "percentage" && it.ratio
                    ? ` (${it.ratio}%)`
                    : ""}
                </option>
              ))}
            </select>
            {selectedTier && (
              <p className="mt-1 text-[10px] text-zinc-500">
                {selectedTier.name}: 단가{" "}
                {(
                  selectedTier.unitPrice || selectedTier.baseTuition
                ).toLocaleString()}
                원 ·{" "}
                {selectedTier.type === "percentage"
                  ? `비율 ${selectedTier.ratio}%`
                  : `고정 ${selectedTier.fixedRate.toLocaleString()}원`}
              </p>
            )}
          </div>

          {error && (
            <div className="rounded-sm border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="rounded-sm border border-blue-200 bg-blue-50 px-2 py-1.5 text-[11px] text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300">
            💡 추가된 분반은 <b>is_manual=true</b> 로 저장됨 — 다음 시트
            동기화에서 덮어쓰지 않음 (보호).
          </div>
        </div>

        {/* 푸터 */}
        <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-zinc-200 bg-zinc-50 px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-sm border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-sm bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "저장 중..." : "✓ 저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
