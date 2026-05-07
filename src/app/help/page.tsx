import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/getAuthedUser";
import Nav from "@/components/Nav";
import AuthGuard from "@/components/AuthGuard";
import HelpPage from "@/components/HelpPage";

/**
 * 출석부 앱 사용 가이드 (audit #20).
 *   시트의 "사용법" 탭 대체 — 키보드 입력, 시트 동기화, 정산 보는 법, FAQ.
 */
export default async function Help() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) redirect("/login");

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      <Nav email={user.email} />
      <main className="flex-1 min-h-0 overflow-auto p-6">
        <AuthGuard>
          <HelpPage />
        </AuthGuard>
      </main>
    </div>
  );
}
