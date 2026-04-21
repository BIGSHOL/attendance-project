"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUserRole } from "@/hooks/useUserRole";

const baseNavItems = [
  { href: "/", label: "출석부", icon: "📋" },
  { href: "/teachers", label: "선생님", icon: "👩‍🏫" },
  { href: "/students", label: "학생", icon: "🎒" },
  { href: "/consultations", label: "상담", icon: "💬" },
  { href: "/payments", label: "수납", icon: "💳" },
  { href: "/settlement", label: "정산", icon: "💰" },
];

interface NavProps {
  email?: string;
}

export default function Nav({ email }: NavProps) {
  const pathname = usePathname();
  const { isMaster, isAdmin } = useUserRole();

  const navItems = [
    ...baseNavItems,
    ...(isAdmin ? [{ href: "/attendance-import", label: "출석부 업로드", icon: "📥" }] : []),
    ...(isMaster ? [{ href: "/admin/users", label: "사용자 관리", icon: "👤" }] : []),
    ...(isAdmin ? [{ href: "/admin/audit", label: "변경 이력", icon: "📜" }] : []),
  ];

  return (
    <nav className="flex items-center border-b border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-0.5 rounded-sm border border-zinc-200 bg-zinc-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-800">
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-bold transition-all ${
                isActive
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100"
                  : "text-zinc-500 hover:bg-white/60 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700/60 dark:hover:text-zinc-200"
              }`}
            >
              <span>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </div>
      {email && (
        <div className="ml-auto flex items-center gap-3 pr-1">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">{email}</span>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="rounded-sm border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-600 shadow-sm hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              로그아웃
            </button>
          </form>
        </div>
      )}
    </nav>
  );
}
