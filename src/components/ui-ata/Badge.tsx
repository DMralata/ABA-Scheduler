import * as React from "react";

type Variant = "active" | "success" | "warning" | "danger" | "neutral";

type Props = {
  children: React.ReactNode;
  variant?: Variant;
  dot?: boolean;
};

export function Badge({ children, variant = "active", dot = false }: Props) {
  return (
    <span className={`ata-badge ata-badge--${variant}`}>
      {dot && <span className="ata-badge-dot" />}
      {children}
    </span>
  );
}
