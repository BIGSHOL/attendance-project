import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/getAuthedUser";
import Nav from "@/components/Nav";
import AuthGuard from "@/components/AuthGuard";
import AuditLogViewer from "@/components/AuditLogViewer";

export default async function AdminAuditPage() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) redirect("/login");

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      <Nav email={user.email} />
      <main className="flex-1 min-h-0 overflow-auto p-6">
        <AuthGuard requireAdmin>
          <AuditLogViewer />
        </AuthGuard>
      </main>
    </div>
  );
}
