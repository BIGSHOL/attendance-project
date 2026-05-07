import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/getAuthedUser";
import Nav from "@/components/Nav";
import AuthGuard from "@/components/AuthGuard";
import MigrationCheckPage from "@/components/MigrationCheckPage";

/**
 * 마이그레이션 점검 페이지 (audit #11) — 관리자 전용.
 *   시트 ↔ 앱 정합성 점검: virtual_students / tier 매칭 실패 등.
 */
export default async function MigrationCheck() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) redirect("/login");

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      <Nav email={user.email} />
      <main className="flex-1 min-h-0 overflow-auto p-6">
        <AuthGuard requireAdmin>
          <MigrationCheckPage />
        </AuthGuard>
      </main>
    </div>
  );
}
