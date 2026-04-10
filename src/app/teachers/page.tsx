import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Nav from "@/components/Nav";
import AuthGuard from "@/components/AuthGuard";
import TeacherList from "@/components/TeacherList";

export default async function TeachersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      <Nav email={user.email || ""} />
      <main className="flex-1 min-h-0 overflow-auto p-6">
        <AuthGuard requireAdmin>
          <TeacherList />
        </AuthGuard>
      </main>
    </div>
  );
}
