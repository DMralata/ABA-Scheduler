import * as React from "react";
import {
  Home,
  Users,
  Coffee,
  Car,
  ClipboardCheck,
  MoreHorizontal,
  type LucideIcon,
} from "lucide-react";

export type SessionBlockType =
  | "directTherapyHome"
  | "directTherapy"
  | "supervision"
  | "lunch"
  | "driveTime"
  | "cancellation";

type StyleConfig = {
  background: string;
  borderColor: string;
  color: string;
  icon: LucideIcon;
};

const styles: Record<SessionBlockType, StyleConfig> = {
  directTherapyHome: {
    background: "#EFF6FF",
    borderColor: "#BFDBFE",
    color: "#1E3A8A",
    icon: Home,
  },
  directTherapy: {
    background: "#F4F3FF",
    borderColor: "#D9D6FE",
    color: "#42307D",
    icon: Users,
  },
  supervision: {
    background: "#ECFDF3",
    borderColor: "#ABEFC6",
    color: "#027A48",
    icon: ClipboardCheck,
  },
  lunch: {
    background: "#FFFAEB",
    borderColor: "#FEDF89",
    color: "#B54708",
    icon: Coffee,
  },
  driveTime: {
    background: "#FFF7ED",
    borderColor: "#FED7AA",
    color: "#C2410C",
    icon: Car,
  },
  cancellation: {
    background: "#FEF3F2",
    borderColor: "#FDA29B",
    color: "#B42318",
    icon: ClipboardCheck,
  },
};

type SessionBlockProps = {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  type?: SessionBlockType;
  proposed?: boolean;
  showMenu?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMenuClick?: (e: React.MouseEvent) => void;
};

export function SessionBlock({
  title,
  subtitle,
  type = "directTherapyHome",
  proposed = false,
  showMenu = true,
  className = "",
  style,
  onClick,
  onMenuClick,
}: SessionBlockProps) {
  const config = styles[type] ?? styles.directTherapyHome;
  const Icon = config.icon;

  return (
    <div
      className={`ata-session-block ${className}`}
      onClick={onClick}
      style={{
        height: 28,
        minWidth: 96,
        borderRadius: 8,
        padding: "4px 8px",
        border: proposed ? "1px dashed var(--ata-blue-500)" : `1px solid ${config.borderColor}`,
        background: proposed ? "#FFFFFF" : config.background,
        color: config.color,
        display: "flex",
        alignItems: "center",
        gap: 6,
        overflow: "hidden",
        fontSize: 12,
        lineHeight: 1.15,
        cursor: onClick ? "pointer" : undefined,
        ...style,
      }}
    >
      <Icon size={13} style={{ flex: "0 0 auto" }} />
      <span
        style={{
          fontWeight: 700,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          minWidth: 0,
          flex: 1,
        }}
      >
        {title}
        {subtitle && (
          <span style={{ fontWeight: 500, color: "var(--ata-gray-600)", marginLeft: 6 }}>
            {subtitle}
          </span>
        )}
      </span>
      {showMenu && (
        <button
          type="button"
          aria-label="Session options"
          onClick={
            onMenuClick
              ? (e) => {
                  e.stopPropagation();
                  onMenuClick(e);
                }
              : undefined
          }
          style={{
            background: "transparent",
            border: 0,
            padding: 0,
            color: "inherit",
            opacity: 0.7,
            display: "inline-flex",
            cursor: onMenuClick ? "pointer" : "default",
          }}
        >
          <MoreHorizontal size={14} />
        </button>
      )}
    </div>
  );
}

type WeekChipProps = {
  children: React.ReactNode;
  type?: SessionBlockType;
  proposed?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
};

export function WeekSessionChip({
  children,
  type = "directTherapyHome",
  proposed = false,
  onClick,
  style,
}: WeekChipProps) {
  const config = styles[type] ?? styles.directTherapyHome;

  return (
    <div
      onClick={onClick}
      style={{
        height: 24,
        width: "calc(100% - 12px)",
        margin: 6,
        borderRadius: 6,
        padding: "0 8px",
        border: proposed ? "1px dashed var(--ata-blue-500)" : `1px solid ${config.borderColor}`,
        background: proposed ? "#FFFFFF" : config.background,
        color: config.color,
        fontSize: 12,
        fontWeight: 600,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        overflow: "hidden",
        cursor: onClick ? "pointer" : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
