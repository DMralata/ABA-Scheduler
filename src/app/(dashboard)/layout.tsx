import { DashboardShell } from "@/components/layout/DashboardShell";
import { getUnreadCount } from "@/lib/queries/communications";
import { getProposalCount } from "@/lib/queries/sessions";
import { getCurrentUser } from "@/lib/auth";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // getCurrentUser() is request-deduped, so this shares one auth round trip with
  // requireUser()/isBlindedViewer() rather than making its own.
  const [unreadCount, proposalCount, user] = await Promise.all([
    getUnreadCount().catch(() => 0),
    getProposalCount().catch(() => 0),
    getCurrentUser(),
  ]);
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
