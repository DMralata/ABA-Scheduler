import React from "react";
import { SidebarNav } from "./SidebarNav";
import "../../styles/ata-tokens.css";

export function AppShell({ activeNav, sidebarVariant = "expanded", children }) {
  return (
    <div className="ata-app-shell">
      <SidebarNav activeNav={activeNav} variant={sidebarVariant} />
      <main className="ata-app-main">{children}</main>
    </div>
  );
}
