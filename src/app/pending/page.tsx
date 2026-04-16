import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/getAuthedUser";
import PendingPageClient from "@/components/PendingPageClient";

export default async function PendingPage() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) redirect("/login");

  return <PendingPageClient email={user.email} />;
}
