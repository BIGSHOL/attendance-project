"use client";

import { useState, useMemo } from "react";
import { useUserRole, type UserRole, type SalaryType } from "@/hooks/useUserRole";
import { useAllUserRoles } from "@/hooks/useAllUserRoles";
import { useStaff } from "@/hooks/useStaff";
import { createClient } from "@/lib/supabase/client";
import { DAY_ORDER } from "@/types";
import Pagination from "./Pagination";

const PAGE_SIZE = 20;

const ROLE_LABELS: Record<UserRole, string> = {
  master: "마스터",
  admin: "관리자",
  teacher: "선생님",
  pending: "승인 대기",
};

const ROLE_COLORS: Record<UserRole, string> = {
  master: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  admin: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  teacher: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
};

const SALARY_TYPE_LABELS: Record<SalaryType, string> = {
  commission: "비율제",
  fixed: "급여제",
  mixed: "혼합",
};

export default function UserManagement() {
  const { isMaster, loading: roleLoading } = useUserRole();
  const { users, loading: usersLoading, refetch } = useAllUserRoles();
  const { teachers, loading: staffLoading } = useStaff();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return users;
    const q = search.toLowerCase();
    return users.filter((u) => u.email.toLowerCase().includes(q));
  }, [users, search]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  );

  const updateUser = async (userId: string, patch: Record<string, unknown>) => {
    setSaving(userId);
    const supabase = createClient();
    await supabase
      .from("user_roles")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", userId);
    await refetch();
    setSaving(null);
  };

  const handleRoleChange = async (
    userId: string,
    newRole: UserRole,
    staffId?: string,
    staffName?: string
  ) => {
    // 승인 대기로 돌아갈 때만 매핑 초기화, 관리자/선생님은 매핑 유지
    const preserveMapping = newRole === "teacher" || newRole === "admin";
    await updateUser(userId, {
      role: newRole,
      staff_id: preserveMapping ? staffId || null : null,
      staff_name: preserveMapping ? staffName || null : null,
      approved_at: newRole !== "pending" ? new Date().toISOString() : null,
    });
  };

  const handleSalaryTypeChange = async (userId: string, salaryType: SalaryType) => {
    await updateUser(userId, {
      salary_type: salaryType,
      // 비율제/급여제는 commission_days 초기화, 혼합은 유지
      ...(salaryType !== "mixed" ? { commission_days: [] } : {}),
    });
  };

  const handleCommissionDaysChange = async (
    userId: string,
    currentDays: string[],
    day: string
  ) => {
    const next = currentDays.includes(day)
      ? currentDays.filter((d) => d !== day)
      : [...currentDays, day];
    await updateUser(userId, { commission_days: next });
  };

  const handleDelete = async (userId: string, email: string) => {
    if (!confirm(`${email} 계정을 삭제하시겠습니까?`)) return;
    setSaving(userId);
    const supabase = createClient();
    await supabase.from("user_roles").delete().eq("id", userId);
    await refetch();
    setSaving(null);
  };

  if (roleLoading || usersLoading || staffLoading) {
    return <div className="flex items-center justify-center h-64 text-zinc-400 text-sm">불러오는 중...</div>;
  }

  if (!isMaster) {
    return (
      <div className="flex items-center justify-center h-64 text-zinc-400 text-sm">
        마스터 계정만 접근 가능합니다.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-4">
        사용자 관리
        <span className="ml-2 text-sm font-normal text-zinc-500">
          ({filtered.length}명)
        </span>
      </h2>

      <div className="mb-4">
        <input
          type="text"
          placeholder="이메일 검색"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="rounded-sm border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
      </div>

      <div className="overflow-hidden border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm [&_td]:border-r [&_td]:border-zinc-200 [&_th]:border-r [&_th]:border-zinc-300">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/50">
              <th className="px-4 py-3 text-left font-medium text-zinc-500">이메일</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-500">역할</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-500">선생님 매핑</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-500">급여 유형</th>
              <th className="px-4 py-3 text-center font-medium text-zinc-500">작업</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((u) => {
              const isSaving = saving === u.id;
              const isTeacher = u.role === "teacher";
              const canMap = u.role === "teacher" || u.role === "admin";
              return (
                <tr
                  key={u.id}
                  className={`border-b border-zinc-300 last:border-0 dark:border-zinc-800 ${isSaving ? "opacity-50" : ""}`}
                >
                  {/* 이메일 */}
                  <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                    {u.email}
                  </td>

                  {/* 역할 */}
                  <td className="px-4 py-3">
                    {u.role === "master" ? (
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_COLORS.master}`}>
                        {ROLE_LABELS.master}
                      </span>
                    ) : (
                      <select
                        value={u.role}
                        onChange={(e) => handleRoleChange(u.id, e.target.value as UserRole, u.staff_id || undefined, u.staff_name || undefined)}
                        disabled={isSaving}
                        className="rounded-sm border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                      >
                        <option value="pending">승인 대기</option>
                        <option value="admin">관리자</option>
                        <option value="teacher">선생님</option>
                      </select>
                    )}
                  </td>

                  {/* 선생님 매핑 */}
                  <td className="px-4 py-3">
                    {canMap ? (
                      <select
                        value={u.staff_id || ""}
                        onChange={(e) => {
                          const t = teachers.find((tt) => tt.id === e.target.value);
                          handleRoleChange(u.id, u.role, t?.id, t?.name);
                        }}
                        disabled={isSaving}
                        className="rounded-sm border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                      >
                        <option value="">선택 안 함</option>
                        {teachers.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                            {t.englishName ? ` (${t.englishName})` : ""}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-zinc-400">-</span>
                    )}
                  </td>

                  {/* 급여 유형 */}
                  <td className="px-4 py-3">
                    {canMap && u.staff_id ? (
                      <div className="flex flex-col gap-1">
                        <select
                          value={u.salary_type || "commission"}
                          onChange={(e) => handleSalaryTypeChange(u.id, e.target.value as SalaryType)}
                          disabled={isSaving}
                          className="rounded-sm border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                        >
                          <option value="commission">비율제</option>
                          <option value="fixed">급여제</option>
                          <option value="mixed">혼합 (급여제+비율제)</option>
                        </select>

                        {/* 혼합 → 비율제 적용 요일 선택 */}
                        {u.salary_type === "mixed" && (
                          <div className="flex gap-0.5 flex-wrap">
                            {DAY_ORDER.map((day) => {
                              const active = (u.commission_days || []).includes(day);
                              return (
                                <button
                                  key={day}
                                  onClick={() =>
                                    handleCommissionDaysChange(u.id, u.commission_days || [], day)
                                  }
                                  disabled={isSaving}
                                  className={`rounded-sm border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                                    active
                                      ? "border-blue-500 bg-blue-500 text-white"
                                      : "border-zinc-300 bg-white text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
                                  }`}
                                  title={`${day}요일 비율제 적용`}
                                >
                                  {day}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {u.salary_type === "mixed" && (u.commission_days || []).length === 0 && (
                          <span className="text-[10px] text-amber-600">비율제 요일을 선택하세요</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-zinc-400">-</span>
                    )}
                  </td>

                  {/* 작업 */}
                  <td className="px-4 py-3 text-center">
                    {u.role !== "master" && (
                      <button
                        onClick={() => handleDelete(u.id, u.email)}
                        disabled={isSaving}
                        className="rounded-sm border border-red-200 px-2 py-1 text-xs text-red-500 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950"
                      >
                        삭제
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />

      {/* 설명 */}
      <div className="mt-4 rounded-sm border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        <p className="font-semibold mb-2 text-zinc-700 dark:text-zinc-300">급여 유형 안내</p>
        <ul className="space-y-1">
          <li>• <span className="font-medium">비율제</span>: 모든 출석이 급여에 반영됩니다.</li>
          <li>• <span className="font-medium">급여제</span>: 출석 체크는 하지만 급여에는 영향을 주지 않습니다.</li>
          <li>• <span className="font-medium">혼합</span>: 선택된 요일의 출석만 비율제로 계산됩니다.</li>
        </ul>
      </div>
    </div>
  );
}
