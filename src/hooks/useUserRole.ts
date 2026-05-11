"use client";

import { useEffect, useState, useCallback } from "react";
import { cachedFetch, getCached, invalidateCache } from "@/lib/fetchCache";

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
type MeResponse = { userRole: UserRoleData | null };

export function useUserRole() {
  // /api/me 는 페이지마다 여러 컴포넌트에서 useUserRole 호출 → 같은 페이지에서
  // 12회 이상 중복 fetch 가능. cachedFetch 로 inflight dedup + last-response 캐시.
  // 캐시 hit 시 즉시 반환 (loading=false), miss 시 fetch.
  const cached = getCached<MeResponse>("/api/me");
  const initialRole = cached?.userRole ?? null;

  const [userRole, setUserRole] = useState<UserRoleData | null>(initialRole);
  const [loading, setLoading] = useState(!cached);
  const [email, setEmail] = useState<string | null>(initialRole?.email ?? null);

  const refetch = useCallback(async () => {
    if (!getCached<MeResponse>("/api/me")) setLoading(true);
    try {
      // TTL 30초 — 사용자 역할은 자주 안 바뀌므로 페이지 안에서 N번 호출 시 1번만 네트워크.
      // forceRefetch (invalidateCache) 로 로그인 상태 변경 시 명시적 갱신 가능.
      const data = await cachedFetch<MeResponse>("/api/me", { ttlMs: 30_000 });
      const role = data?.userRole ?? null;
      setUserRole(role);
      setEmail(role?.email ?? null);
    } catch {
      setUserRole(null);
      setEmail(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // 강제 새로고침 — 로그인 상태 변경 시 사용
  const forceRefetch = useCallback(async () => {
    invalidateCache("/api/me");
    await refetch();
  }, [refetch]);

  useEffect(() => {
    refetch();
  }, [refetch]);

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
    refetch: forceRefetch,
  };
}
