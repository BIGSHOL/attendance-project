import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PendingPageClient from "@/components/PendingPageClient";

export default async function PendingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <PendingPageClient email={user.email || ""} />;
}
