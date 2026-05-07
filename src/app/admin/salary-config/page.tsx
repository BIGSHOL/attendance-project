import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/getAuthedUser";
import Nav from "@/components/Nav";
import AuthGuard from "@/components/AuthGuard";
import SalaryConfigEditorPage from "@/components/SalaryConfigEditorPage";

/**
 * 급여 설정 편집 (audit #7) — 마스터 전용.
 *   tier 단가/비율, 수수료, 인센티브 편집.
 */
export default async function AdminSalaryConfig() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) redirect("/login");

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      <Nav email={user.email} />
      <main className="flex-1 min-h-0 overflow-auto p-6">
        <AuthGuard requireMaster>
          <SalaryConfigEditorPage />
        </AuthGuard>
      </main>
    </div>
  );
}
