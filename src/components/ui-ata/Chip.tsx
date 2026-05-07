import * as React from "react";

type Color = "default" | "blue" | "purple" | "warning" | "danger";

type Props = {
  children: React.ReactNode;
  color?: Color;
  className?: string;
};

export function Chip({ children, color = "default", className = "" }: Props) {
  const cls = `ata-chip ${color !== "default" ? `ata-chip--${color}` : ""} ${className}`.trim();
  return <span className={cls}>{children}</span>;
}
