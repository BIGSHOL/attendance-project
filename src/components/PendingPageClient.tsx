"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUserRole } from "@/hooks/useUserRole";

interface Props {
  email: string;
}

export default function PendingPageClient({ email }: Props) {
  const router = useRouter();
  const { loading, isApproved } = useUserRole();

  useEffect(() => {
    if (!loading && isApproved) {
      router.replace("/");
    }
  }, [loading, isApproved, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
      <div className="w-full max-w-md rounded-sm border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="text-center">
          <div className="mb-4 text-5xl">⏳</div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
            승인 대기 중
          </h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            계정 ({email}) 이 아직 승인되지 않았습니다.
          </p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            관리자가 승인할 때까지 기다려주세요.
          </p>
        </div>
        <div className="mt-6 flex flex-col gap-2">
          <button
            onClick={() => window.location.reload()}
            className="w-full rounded-sm border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-750"
          >
            새로고침
          </button>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="w-full rounded-sm border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-750"
            >
              로그아웃
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
