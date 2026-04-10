"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

export type UserRole = "master" | "admin" | "teacher" | "pending";

/** 급여 유형: 비율제 | 급여제 | 혼합 */
export type SalaryType = "commission" | "fixed" | "mixed";

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
 * 미등록 사용자는 자동으로 pending 상태로 등록
 */
export function useUserRole() {
  const [userRole, setUserRole] = useState<UserRoleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user?.email) {
      setUserRole(null);
      setEmail(null);
      setLoading(false);
      return;
    }

    setEmail(user.email);

    // user_roles 조회
    const { data: existing } = await supabase
      .from("user_roles")
      .select("*")
      .eq("email", user.email)
      .single();

    if (existing) {
      setUserRole(existing as UserRoleData);
    } else {
      // 미등록 → pending 으로 등록
      const { data: inserted } = await supabase
        .from("user_roles")
        .insert({ email: user.email, role: "pending" })
        .select()
        .single();
      if (inserted) {
        setUserRole(inserted as UserRoleData);
      }
    }
    setLoading(false);
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
