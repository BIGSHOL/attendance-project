"use client";

import { useEffect, useState, useCallback } from "react";

export type UserRole = "master" | "admin" | "teacher" | "pending";

/** 급여 유형: 비율제 | 급여제 | 혼합 | 파트타임 */
export type SalaryType = "commission" | "fixed" | "mixed" | "part_time";

/** SalaryType → 한글 라벨 (UI 표기용 공용 매핑) */
export const SALARY_TYPE_LABEL: Record<SalaryType, string> = {
  commission: "비율제",
  fixed: "급여제",
  mixed: "혼합",
  part_time: "파트타임",
};

/** 실급여(출석·수납 기반) 계산이 비활성화되는 유형 — 계약 기반 별도 지급 */
export const CONTRACT_BASED_SALARY_TYPES: SalaryType[] = ["fixed", "part_time"];

/** 계약 기반(고정/파트타임) 여부 — 실급여 계산 비활성 조건 */
export function isContractBasedSalary(type: SalaryType | undefined): boolean {
  return !!type && CONTRACT_BASED_SALARY_TYPES.includes(type);
}

export interface UserRoleData {
  id: string;
  email: string;
  role: UserRole;
  staff_id: string | null;
  staff_name: string | null;
  salary_type: SalaryType;
  commission_days: string[];  // ["월", "화", ...]
  blog_required: boolean;     // 블로그 작성 의무 여부 (미작성 시 -2% 패널티)
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
}

/**
 * 현재 로그인 사용자의 역할 조회
 * 서버 /api/me 엔드포인트를 호출해 dev bypass 와 Supabase 세션 두 경로를 통합 처리.
 * 미등록 사용자는 서버에서 pending 으로 자동 등록됨.
 */
export function useUserRole() {
  const [userRole, setUserRole] = useState<UserRoleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.fetch("/api/me", { cache: "no-store" });
      if (!res.ok) {
        setUserRole(null);
        setEmail(null);
        return;
      }
      const data = await res.json();
      const role = (data?.userRole ?? null) as UserRoleData | null;
      setUserRole(role);
      setEmail(role?.email ?? null);
    } catch {
      setUserRole(null);
      setEmail(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const isMaster = userRole?.role === "master";
  const isAdmin = userRole?.role === "admin" || isMaster;
  const isTeacher = userRole?.role === "teacher";
  const isPending = userRole?.role === "pending";
  const isApproved = isMaster || isAdmin || isTeacher;

  return {
    userRole,
    email,
    loading,
    isMaster,
    isAdmin,
    isTeacher,
    isPending,
    isApproved,
    refetch: fetch,
  };
}
