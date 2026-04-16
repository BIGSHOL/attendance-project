import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/getAuthedUser";
import Nav from "@/components/Nav";
import AttendanceImportPage from "@/components/AttendanceImportPage";

export default async function Page() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
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
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      <Nav email={user.email} />
      <main className="flex-1 min-h-0 overflow-auto p-6">
        <AttendanceImportPage />
      </main>
    </div>
  );
}
