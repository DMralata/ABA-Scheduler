import * as React from "react";
import { Button } from "./Button";

export type DockAction = {
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
};

type Props = {
  actions: DockAction[];
  className?: string;
  style?: React.CSSProperties;
};

export function FloatingActionDock({ actions, className = "", style }: Props) {
  return (
    <div className={`ata-floating-dock ${className}`} style={style}>
      {actions.map((action) => (
        <Button
          key={action.label}
          variant={action.variant ?? "secondary"}
          size="sm"
          iconLeft={action.icon}
          onClick={action.onClick}
          disabled={action.disabled}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}
