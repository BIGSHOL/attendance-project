"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * 선생님별 급여 비율 오버라이드 편집 카드.
 * 과목(수학/영어) × 그룹(초등·중등·고등·수능·특강) 그리드.
 * 값 0 이하면 "비활성(기본 45%)"으로 간주. 저장은 직접 "저장" 버튼 클릭 시.
 *
 * TeacherDetail.tsx 에서 분리됨 — 동작 변경 없음.
 */
export default function TeacherRatiosCard({
  teacher,
  isEditable,
  ratios,
  defaultRatios,
  onSave,
}: {
  teacher: { id: string; name: string; subjects?: string[] };
  isEditable: boolean;
  ratios: Record<string, Record<string, number>>;
  defaultRatios: Record<string, Record<string, number>>;
  onSave: (next: Record<string, Record<string, number>>) => Promise<unknown> | unknown;
}) {
  const GROUPS = ["초등", "중등", "고등", "수능", "특강"] as const;
  // 선생님이 담당하는 과목만 표시 (subjects 필드 기반)
  const subjects = (teacher.subjects || []).filter((s) =>
    ["math", "highmath", "english"].includes(s)
  );
  // math 와 highmath 는 같은 tier 체계 공유 → math 로 통합
  const normalized: ("math" | "english")[] = [];
  if (subjects.includes("math") || subjects.includes("highmath"))
    normalized.push("math");
  if (subjects.includes("english")) normalized.push("english");
  if (normalized.length === 0) normalized.push("math"); // 폴백

  const subjectLabel = (s: string) => (s === "math" ? "수학" : "영어");

  // 하드코딩 기본값 + DB 오버라이드 머지 (DB 우선). UI 표시 및 dirty 비교의 기준.
  const merged = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    for (const s of Object.keys(defaultRatios || {})) {
      out[s] = { ...(defaultRatios[s] || {}) };
    }
    for (const s of Object.keys(ratios || {})) {
      out[s] = { ...(out[s] || {}), ...(ratios[s] || {}) };
    }
    return out;
  }, [defaultRatios, ratios]);

  const [draft, setDraft] = useState<Record<string, Record<string, number>>>(
    () => JSON.parse(JSON.stringify(merged))
  );
  const [saving, setSaving] = useState(false);
  // merged 변경 시 draft 동기화 (선생님 전환 등)
  useEffect(() => {
    setDraft(JSON.parse(JSON.stringify(merged)));
  }, [merged]);

  const handleChange = (subject: string, group: string, value: string) => {
    setDraft((d) => {
      const next = { ...d, [subject]: { ...(d[subject] || {}) } };
      const n = parseFloat(value);
      if (isNaN(n) || n <= 0) {
        delete next[subject][group];
        if (Object.keys(next[subject]).length === 0) delete next[subject];
      } else {
        next[subject][group] = n;
      }
      return next;
    });
  };

  const isDirty = JSON.stringify(draft) !== JSON.stringify(merged);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-6 rounded-sm border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          급여 비율 <span className="text-xs font-normal text-zinc-400">(값을 바꾸고 저장하면 이 선생님에게만 적용 · 비우면 45% 폴백)</span>
        </h3>
        {isEditable && isDirty && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-sm bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        )}
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800">
            <th className="w-24 px-3 py-2 text-left text-xs font-medium text-zinc-500">과목</th>
            {GROUPS.map((g) => (
              <th key={g} className="px-3 py-2 text-center text-xs font-medium text-zinc-500">
                {g}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {normalized.map((subject) => (
            <tr key={subject} className="border-b border-zinc-100 dark:border-zinc-800">
              <td className="px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {subjectLabel(subject)}
              </td>
              {GROUPS.map((g) => {
                const value = draft[subject]?.[g];
                const dbValue = ratios?.[subject]?.[g];
                const defaultValue = defaultRatios[subject]?.[g];
                // DB 저장값인지 구분 — 테두리만 강조 (DB=파랑 / 기본값=회색)
                const isFromDB = dbValue != null;
                return (
                  <td key={g} className="px-2 py-1 text-center">
                    {isEditable ? (
                      <div className="flex items-center justify-center gap-1">
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          max="100"
                          value={value ?? ""}
                          onChange={(e) => handleChange(subject, g, e.target.value)}
                          placeholder="45"
                          title={
                            dbValue != null
                              ? `DB 저장값: ${dbValue}%`
                              : defaultValue != null
                              ? `하드코딩 기본값: ${defaultValue}% (적용 중, 저장하면 DB에 기록)`
                              : "비어있으면 공용 45% 적용"
                          }
                          className={`w-16 rounded-sm border bg-white px-1 py-1 text-center text-sm text-zinc-900 placeholder:text-zinc-400 dark:bg-zinc-800 dark:text-zinc-100 ${
                            isFromDB
                              ? "border-blue-400 dark:border-blue-500"
                              : "border-zinc-300 dark:border-zinc-700"
                          }`}
                        />
                        <span className="text-xs text-zinc-400">%</span>
                      </div>
                    ) : (
                      <span className="text-sm text-zinc-700 dark:text-zinc-300">
                        {value != null ? `${value}%` : <span className="text-zinc-400">—</span>}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
