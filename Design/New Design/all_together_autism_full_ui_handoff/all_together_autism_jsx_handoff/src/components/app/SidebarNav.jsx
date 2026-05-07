import React from "react";
import {
  Home,
  CalendarDays,
  Users,
  UserRound,
  ClipboardList,
  MessageCircle,
  BarChart3,
  Receipt,
  Settings,
  HelpCircle,
} from "lucide-react";

const navItems = [
  { key: "home", label: "Home", icon: Home },
  { key: "schedule", label: "Schedule", icon: CalendarDays },
  { key: "clients", label: "Clients", icon: Users },
  { key: "providers", label: "Providers", icon: UserRound },
  { key: "sessions", label: "Sessions", icon: ClipboardList },
  { key: "communications", label: "Communications", icon: MessageCircle },
  { key: "reports", label: "Reports", icon: BarChart3 },
  { key: "billing", label: "Billing", icon: Receipt },
  { key: "settings", label: "Settings", icon: Settings },
];

export function SidebarNav({
  activeNav,
  variant = "expanded",
  logoSrc = "/assets/all-together-autism-logo.svg",
  markSrc = "/assets/all-together-autism-mark.svg",
}) {
  const compact = variant === "compact";

  return (
    <aside className={`ata-sidebar ${compact ? "ata-sidebar--compact" : ""}`}>
      <div className="ata-sidebar-logo">
        <img
          src={compact ? markSrc : logoSrc}
          alt="All Together Autism"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      </div>

      <nav className="ata-nav-list" aria-label="Primary navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeNav === item.key;

          return (
            <button
              key={item.key}
              className={`ata-nav-item ${active ? "ata-nav-item--active" : ""}`}
              aria-current={active ? "page" : undefined}
              aria-label={compact ? item.label : undefined}
              title={compact ? item.label : undefined}
              type="button"
            >
              <Icon size={20} strokeWidth={1.8} />
              <span className="ata-nav-label">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="ata-sidebar-footer">
        <button
          type="button"
          className={`ata-nav-item ${compact ? "ata-nav-item--compact" : ""}`}
          aria-label={compact ? "Help" : undefined}
          title={compact ? "Help" : undefined}
        >
          <HelpCircle size={20} strokeWidth={1.8} />
          <span className="ata-nav-label">Help</span>
        </button>

        <div className="ata-profile-block">
          <span className="ata-avatar">AK</span>
          <div className="ata-profile-copy">
            <div style={{ fontSize: 13, fontWeight: 700 }}>Alyssa Kim</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "rgba(255,255,255,.72)" }}>
              <span className="ata-online-dot" />
              Online
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
