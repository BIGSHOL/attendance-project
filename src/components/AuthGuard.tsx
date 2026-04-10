"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUserRole } from "@/hooks/useUserRole";

interface Props {
  children: React.ReactNode;
  requireMaster?: boolean;   // 마스터 전용 페이지
  requireAdmin?: boolean;    // 관리자+ 전용 페이지
}

/**
 * 로그인된 사용자의 역할에 따라 페이지 접근 제어
 * - pending → /pending 으로 리다이렉트
 * - requireMaster: 마스터만
 * - requireAdmin: 관리자 이상
 * - 기본: 승인된 사용자 (teacher/admin/master)
 */
export default function AuthGuard({ children, requireMaster, requireAdmin }: Props) {
  const router = useRouter();
  const { loading, isApproved, isPending, isMaster, isAdmin } = useUserRole();

  useEffect(() => {
    if (loading) return;

    if (isPending) {
      router.replace("/pending");
      return;
    }

    if (!isApproved) {
      router.replace("/pending");
      return;
    }

    if (requireMaster && !isMaster) {
      router.replace("/");
      return;
    }

    if (requireAdmin && !isAdmin) {
      router.replace("/");
      return;
    }
  }, [loading, isApproved, isPending, isMaster, isAdmin, requireMaster, requireAdmin, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-zinc-400 text-sm">
        불러오는 중...
      </div>
    );
  }

  if (isPending || !isApproved) return null;
  if (requireMaster && !isMaster) return null;
  if (requireAdmin && !isAdmin) return null;

  return <>{children}</>;
}
