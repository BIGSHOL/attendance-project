import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/getAuthedUser";
import Nav from "@/components/Nav";
import AuthGuard from "@/components/AuthGuard";
import ArchivePage from "@/components/admin/ArchivePage";

/**
 * 보관함 — 퇴사 선생님 (status !== active) 의 과거 출석 데이터 read-only 조회.
 * 관리자 이상 접근 가능.
 */
export default async function AdminArchive() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) redirect("/login");

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      <Nav email={user.email} />
      <main className="flex-1 min-h-0 overflow-auto p-6">
        <AuthGuard requireAdmin>
          <ArchivePage />
        </AuthGuard>
      </main>
    </div>
  );
}
