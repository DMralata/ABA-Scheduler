import { DashboardShell } from "@/components/layout/DashboardShell";
import { getUnreadCount } from "@/lib/queries/communications";
import { getProposalCount } from "@/lib/queries/sessions";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [unreadCount, proposalCount, supabase] = await Promise.all([
    getUnreadCount().catch(() => 0),
    getProposalCount().catch(() => 0),
    createClient(),
  ]);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userName = (user?.user_metadata?.full_name as string | undefined) ?? null;
  const userPosition = (user?.user_metadata?.position as string | undefined) ?? null;

  return (
    <DashboardShell
      unreadCount={unreadCount}
      proposalCount={proposalCount}
      userName={userName}
      userPosition={userPosition}
    >
      {children}
    </DashboardShell>
  );
}
