"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 개발 환경 전용 — Ctrl+Alt+K 로 열리는 비밀번호 입력 모달.
 * 성공 시 /api/dev-login 이 쿠키를 세팅하고 페이지를 리로드해 마스터로 로그인된 상태가 된다.
 *
 * 프로덕션 빌드에서는 렌더링 자체가 안 되도록 조건부로 마운트되어야 함(layout.tsx 참고).
 */
export default function DevLoginModal() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl + Alt + K
      if (e.ctrlKey && e.altKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (open) {
      setError(null);
      setPassword("");
      // 다음 프레임에 포커스
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dev-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "로그인 실패");
        setLoading(false);
        return;
      }
      // 성공 — 쿠키가 설정됐으므로 리로드하면 마스터로 접근 가능
      window.location.href = "/";
    } catch {
      setError("네트워크 오류");
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50"
      onClick={() => setOpen(false)}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-sm border border-zinc-300 bg-white p-6 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
      >
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            개발자 로그인
          </h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Google 로그인을 우회해 마스터 권한으로 접속합니다.
          </p>
        </div>
        <input
          ref={inputRef}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호"
          autoComplete="off"
          className="w-full rounded-sm border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-sm border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-750"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={loading || !password}
            className="rounded-sm bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {loading ? "접속 중..." : "접속"}
          </button>
        </div>
      </form>
    </div>
  );
}
