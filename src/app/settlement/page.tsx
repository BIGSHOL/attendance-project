import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Header from "@/components/Header";
import Nav from "@/components/Nav";
import AuthGuard from "@/components/AuthGuard";
import SettlementPage from "@/components/SettlementPage";

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-zinc-950">
      <Header email={user.email || ""} />
      <Nav />
      <main className="flex-1 p-6">
        <AuthGuard requireAdmin>
          <SettlementPage />
        </AuthGuard>
      </main>
    </div>
  );
}
