"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { UserRoleData } from "./useUserRole";

/**
 * 전체 user_roles 목록 조회 (마스터/관리자용)
 */
export function useAllUserRoles() {
  const [users, setUsers] = useState<UserRoleData[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("user_roles")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && data) {
      setUsers(data as UserRoleData[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { users, loading, refetch: fetch };
}
