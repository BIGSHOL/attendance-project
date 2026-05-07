import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/getAuthedUser";
import Nav from "@/components/Nav";
import AuthGuard from "@/components/AuthGuard";
import PaymentSharesEditor from "@/components/PaymentSharesEditor";

/**
 * 영어 강사별 학생 수납 분배 (payment_shares) 수동 보정 (audit #8) — 관리자.
 */
export default async function AdminPaymentSharesPage() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) redirect("/login");

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      <Nav email={user.email} />
      <main className="flex-1 min-h-0 overflow-auto p-6">
        <AuthGuard requireAdmin>
          <PaymentSharesEditor />
        </AuthGuard>
      </main>
    </div>
  );
}
