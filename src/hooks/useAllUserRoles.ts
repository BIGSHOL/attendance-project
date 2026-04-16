"use client";

import { useEffect, useState, useCallback } from "react";
import type { UserRoleData } from "./useUserRole";

/**
 * 전체 user_roles 목록 조회 (마스터/관리자용)
 * 서버 /api/admin/user-roles 엔드포인트를 경유해 RLS 우회(dev bypass) 호환.
 */
export function useAllUserRoles() {
  const [users, setUsers] = useState<UserRoleData[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.fetch("/api/admin/user-roles", {
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as UserRoleData[];
        setUsers(data || []);
      } else {
        setUsers([]);
      }
    } catch {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { users, loading, refetch: fetch };
}
