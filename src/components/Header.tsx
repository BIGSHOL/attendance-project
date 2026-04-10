"use client";

interface HeaderProps {
  email: string;
}

export default function Header({ email }: HeaderProps) {
  return (
    <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-900">
      <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
        출석부
      </h1>
      <div className="flex items-center gap-4">
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          {email}
        </span>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            로그아웃
          </button>
        </form>
      </div>
    </header>
  );
}
