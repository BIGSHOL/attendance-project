import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Header from "@/components/Header";
import Nav from "@/components/Nav";
import AuthGuard from "@/components/AuthGuard";
import UserManagement from "@/components/UserManagement";

export default async function AdminUsersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-zinc-950">
      <Header email={user.email || ""} />
      <Nav />
      <main className="flex-1 p-6">
        <AuthGuard requireMaster>
          <UserManagement />
        </AuthGuard>
      </main>
    </div>
  );
}
