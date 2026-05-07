import React from "react";

export function Badge({ children, variant = "active", dot = false }) {
  return (
    <span className={`ata-badge ata-badge--${variant}`}>
      {dot && <span className="ata-online-dot" />}
      {children}
    </span>
  );
}
