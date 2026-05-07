import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/getAuthedUser";
import Nav from "@/components/Nav";
import AuthGuard from "@/components/AuthGuard";
import BlogManagementPage from "@/components/BlogManagementPage";

/**
 * 블로그 일괄 관리 (audit #14) — 관리자 전용.
 *   선생님별 의무 토글 + 작성 일수 + 패널티 적용 여부 한 표.
 */
export default async function AdminBlogPage() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) redirect("/login");

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      <Nav email={user.email} />
      <main className="flex-1 min-h-0 overflow-auto p-6">
        <AuthGuard requireAdmin>
          <BlogManagementPage />
        </AuthGuard>
      </main>
    </div>
  );
}
