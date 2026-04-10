import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Nav from "@/components/Nav";
import AuthGuard from "@/components/AuthGuard";
import AttendancePage from "@/components/AttendancePage";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      <Nav email={user.email || ""} />
      <main className="flex-1 flex flex-col min-h-0">
        <AuthGuard>
          <AttendancePage />
        </AuthGuard>
      </main>
    </div>
  );
}
