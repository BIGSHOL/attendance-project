import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Header from "@/components/Header";
import Nav from "@/components/Nav";
import TeacherDetail from "@/components/TeacherDetail";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-zinc-950">
      <Header email={user.email || ""} />
      <Nav />
      <main className="flex-1 p-6">
        <TeacherDetail teacherId={id} />
      </main>
    </div>
  );
}
