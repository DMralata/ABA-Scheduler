import React from "react";
import { Home, Users, Coffee, Car, ClipboardCheck, MoreHorizontal } from "lucide-react";

const styles = {
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

export function SessionBlock({
  title,
  subtitle,
  type = "directTherapyHome",
  proposed = false,
  showMenu = true,
  className = "",
  style,
}) {
  const config = styles[type] || styles.directTherapyHome;
  const Icon = config.icon;

  return (
    <div
      className={`ata-session-block ${className}`}
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
      {showMenu && <MoreHorizontal size={14} style={{ opacity: 0.7, flex: "0 0 auto" }} />}
    </div>
  );
}

export function WeekSessionChip({ children, type = "directTherapyHome", proposed = false }) {
  const config = styles[type] || styles.directTherapyHome;

  return (
    <div
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
      }}
    >
      {children}
    </div>
  );
}
