"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";

const COMPACT_PREFIXES = ["/schedule"];

type Props = {
  unreadCount: number;
  proposalCount: number;
  userName: string | null;
  userPosition: string | null;
  children: React.ReactNode;
};

export function DashboardShell({
  unreadCount,
  proposalCount,
  userName,
  userPosition,
  children,
}: Props) {
  const pathname = usePathname() ?? "";
  const compact = COMPACT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/"),
  );
  const variant = compact ? "compact" : "expanded";
  const padLeft = compact ? 72 : 184;

  return (
    <div className="min-h-screen" style={{ background: "var(--ata-bg)" }}>
      <Sidebar
        unreadCount={unreadCount}
        proposalCount={proposalCount}
        userName={userName}
        userPosition={userPosition}
        variant={variant}
      />
      <main style={{ paddingLeft: padLeft }}>
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}
