"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Home,
  CalendarDays,
  Users,
  UserRound,
  Repeat,
  MessageCircle,
  Settings as SettingsIcon,
  HelpCircle,
  LogOut,
  UserCog,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type SidebarVariant = "compact" | "expanded";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  badgeKind?: "proposal" | "unread";
};

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard",      label: "Dashboard",        icon: Home },
  { href: "/schedule",       label: "Schedule",         icon: CalendarDays, badgeKind: "proposal" },
  { href: "/recurring",      label: "Recurring events", icon: Repeat },
  { href: "/clients",        label: "Clients",          icon: Users },
  { href: "/providers",      label: "Providers",        icon: UserRound },
  { href: "/communications", label: "Communications",   icon: MessageCircle, badgeKind: "unread" },
];

type SidebarProps = {
  unreadCount?: number;
  proposalCount?: number;
  userName?: string | null;
  userPosition?: string | null;
  variant: SidebarVariant;
};

export function Sidebar({
  unreadCount = 0,
  proposalCount = 0,
  userName,
  userPosition,
  variant,
}: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const compact = variant === "compact";
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  const initials =
    userName
      ?.split(" ")
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  return (
    <aside className={`ata-sidebar ${compact ? "ata-sidebar--compact" : ""}`}>
      <div className="ata-sidebar-logo" aria-label="All Together Autism">
        <BrandMark compact={compact} />
      </div>

      <nav className="ata-nav-list" aria-label="Primary navigation">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          const badgeCount =
            item.badgeKind === "proposal" ? proposalCount : item.badgeKind === "unread" ? unreadCount : 0;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`ata-nav-item ${active ? "ata-nav-item--active" : ""}`}
              aria-current={active ? "page" : undefined}
              aria-label={compact ? item.label : undefined}
              title={compact ? item.label : undefined}
            >
              <span style={{ position: "relative", display: "inline-flex", flex: "0 0 auto" }}>
                <Icon size={20} strokeWidth={1.8} />
                {compact && badgeCount > 0 && (
                  <span
                    style={{
                      position: "absolute",
                      top: -3,
                      right: -3,
                      width: 8,
                      height: 8,
                      borderRadius: 9999,
                      background: "var(--ata-danger-500)",
                      border: "2px solid var(--ata-navy-950)",
                    }}
                    aria-hidden
                  />
                )}
              </span>
              <span className="ata-nav-label" style={{ flex: 1 }}>
                {item.label}
              </span>
              {!compact && badgeCount > 0 && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    background: "rgba(255,255,255,0.16)",
                    color: "#FFFFFF",
                    padding: "2px 8px",
                    borderRadius: 9999,
                    flex: "0 0 auto",
                  }}
                >
                  {badgeCount > 99 ? "99+" : badgeCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="ata-sidebar-footer">
        <Link
          href="/settings"
          className={`ata-nav-item ${pathname === "/settings" ? "ata-nav-item--active" : ""}`}
          aria-label={compact ? "Settings" : undefined}
          title={compact ? "Settings" : undefined}
        >
          <SettingsIcon size={20} strokeWidth={1.8} />
          <span className="ata-nav-label">Settings</span>
        </Link>

        <Link
          href="/help"
          className={`ata-nav-item ${pathname === "/help" || pathname.startsWith("/help/") ? "ata-nav-item--active" : ""}`}
          aria-label={compact ? "Help" : undefined}
          title={compact ? "Help" : undefined}
        >
          <HelpCircle size={20} strokeWidth={1.8} />
          <span className="ata-nav-label">Help</span>
        </Link>

        <div ref={menuRef} style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Account menu"
            title={compact ? userName ?? "Account" : undefined}
            className="ata-profile-block"
            style={{
              width: "100%",
              background: "transparent",
              border: 0,
              padding: 0,
              cursor: "pointer",
              textAlign: "left",
              color: "inherit",
              font: "inherit",
            }}
          >
            <span className="ata-avatar" aria-hidden>
              {initials}
            </span>
            <div className="ata-profile-copy" style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {userName ?? "Account"}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  color: "rgba(255,255,255,0.72)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                <span className="ata-online-dot" aria-hidden />
                {userPosition || "Online"}
              </div>
            </div>
          </button>

          {menuOpen && (
            <div
              role="menu"
              style={{
                position: "absolute",
                bottom: "calc(100% + 8px)",
                left: 0,
                right: 0,
                minWidth: 180,
                background: "#FFFFFF",
                color: "var(--ata-gray-900)",
                borderRadius: 10,
                boxShadow: "0 12px 32px rgba(0,0,0,0.28)",
                padding: 6,
                zIndex: 50,
              }}
            >
              <Link
                href="/profile"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                style={menuItemStyle}
              >
                <UserCog size={16} />
                <span>Edit profile</span>
              </Link>
              <Link
                href="/settings"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                style={menuItemStyle}
              >
                <SettingsIcon size={16} />
                <span>Settings</span>
              </Link>
              <div style={{ height: 1, background: "var(--ata-gray-100)", margin: "4px 0" }} />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  handleSignOut();
                }}
                style={{ ...menuItemStyle, width: "100%", background: "transparent", border: 0, cursor: "pointer", textAlign: "left", font: "inherit" }}
              >
                <LogOut size={16} />
                <span>Sign out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

const menuItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 10px",
  borderRadius: 6,
  fontSize: 13,
  color: "var(--ata-gray-900)",
  textDecoration: "none",
};

function BrandMark({ compact }: { compact: boolean }) {
  if (compact) {
    return (
      <span
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          background: "linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#FFFFFF",
          boxShadow: "0 6px 16px rgba(37,99,235,0.35)",
        }}
        aria-hidden
      >
        <RingsGlyph />
      </span>
    );
  }

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        color: "#FFFFFF",
      }}
    >
      <span
        style={{
          width: 32,
          height: 32,
          borderRadius: 9,
          background: "linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#FFFFFF",
          boxShadow: "0 4px 12px rgba(37,99,235,0.35)",
        }}
        aria-hidden
      >
        <RingsGlyph />
      </span>
      <span
        style={{
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: "-0.01em",
          lineHeight: 1.15,
          whiteSpace: "nowrap",
        }}
      >
        All Together
        <br />
        Autism
      </span>
    </div>
  );
}

function RingsGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="9" cy="12" r="4.5" />
      <circle cx="15" cy="12" r="4.5" />
    </svg>
  );
}
