import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Header from "@/components/Header";
import Nav from "@/components/Nav";
import AttendanceImportPage from "@/components/AttendanceImportPage";

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // 관리자 이상만 접근
  const { data: role } = await supabase
    .from("user_roles")
    .select("role")
    .eq("email", user.email)
    .single();
  if (!role || !["master", "admin"].includes(role.role)) {
    redirect("/");
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-zinc-950">
      <Header email={user.email || ""} />
      <Nav />
      <main className="flex-1 p-6">
        <AttendanceImportPage />
      </main>
    </div>
  );
}
