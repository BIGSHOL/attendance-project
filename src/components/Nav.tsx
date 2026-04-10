"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUserRole } from "@/hooks/useUserRole";

const baseNavItems = [
  { href: "/", label: "출석부", icon: "📋" },
  { href: "/teachers", label: "선생님", icon: "👩‍🏫" },
  { href: "/students", label: "학생", icon: "🎒" },
  { href: "/payments", label: "수납", icon: "💳" },
  { href: "/settlement", label: "정산", icon: "💰" },
];

export default function Nav() {
  const pathname = usePathname();
  const { isMaster } = useUserRole();

  const navItems = [
    ...baseNavItems,
    ...(isMaster ? [{ href: "/admin/users", label: "사용자 관리", icon: "👤" }] : []),
  ];

  return (
    <nav className="flex items-center gap-1 border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-900">
      {navItems.map((item) => {
        const isActive =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              isActive
                ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
            }`}
          >
            <span>{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
