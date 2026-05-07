import React from "react";

export function Chip({ children, color = "default" }) {
  return <span className={`ata-chip ${color !== "default" ? `ata-chip--${color}` : ""}`}>{children}</span>;
}
