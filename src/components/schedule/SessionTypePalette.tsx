"use client";

import { getSessionTypeSwatchBg, getSessionTypeSwatchBorder } from "@/lib/utils";

interface SessionType {
  id: string;
  name: string;
  billable: boolean;
  requiresBcba: boolean;
}

interface SessionTypePaletteProps {
  sessionTypes: SessionType[];
  activeSessionTypeId?: string;
  onSelect: (id: string) => void;
}

function LegendSwatch({ kind }: { kind: "proposed" | "cancelled" | "confirmed" }) {
  const styles: Record<string, React.CSSProperties> = {
    proposed: {
      background: "transparent",
      border: "1px dashed var(--ata-blue-600)",
    },
    cancelled: {
      background:
        "repeating-linear-gradient(135deg, var(--ata-danger-50) 0 4px, var(--ata-danger-100) 4px 8px)",
      border: "1px solid var(--ata-danger-300)",
    },
    confirmed: {
      background: "var(--ata-success-50)",
      border: "1px solid var(--ata-success-100)",
    },
  };
  return (
    <div
      style={{
        width: 22,
        height: 11,
        borderRadius: 3,
        flexShrink: 0,
        ...styles[kind],
      }}
    />
  );
}

export function SessionTypePalette({
  sessionTypes,
  activeSessionTypeId,
  onSelect,
}: SessionTypePaletteProps) {
  return (
    <div
      style={{
        width: 240,
        flexShrink: 0,
        borderRight: "1px solid var(--ata-gray-200)",
        background: "#FFFFFF",
        display: "flex",
        flexDirection: "column",
        padding: "16px 0",
        height: "100%",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 18px 12px",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.08em",
            color: "var(--ata-gray-500)",
            textTransform: "uppercase",
          }}
        >
          Session types
        </div>
      </div>

      <div
        style={{
          padding: "0 10px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          flex: 1,
        }}
      >
        {sessionTypes.length === 0 && (
          <p style={{ fontSize: 12, color: "var(--ata-gray-400)", padding: "0 10px" }}>
            No session types configured.
          </p>
        )}
        {sessionTypes.map((t) => {
          const isActive = t.id === activeSessionTypeId;
          const isCancellation = t.name.toLowerCase().includes("cancel");
          const swatchBg = isCancellation
            ? "var(--ata-danger-50)"
            : getSessionTypeSwatchBg(t.name);
          const swatchBorder = isCancellation
            ? "var(--ata-danger-600)"
            : getSessionTypeSwatchBorder(t.name);

          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(isActive ? "" : t.id)}
              title={isActive ? "Click to deactivate" : "Click to activate, then drag on a row"}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                borderRadius: 8,
                cursor: "grab",
                fontSize: 13,
                color: "var(--ata-gray-900)",
                background: isActive ? "var(--ata-blue-50)" : "transparent",
                boxShadow: isActive ? "inset 0 0 0 1px var(--ata-blue-200)" : "none",
                border: 0,
                textAlign: "left",
                width: "100%",
                transition: "background 120ms ease",
              }}
              onMouseEnter={(e) => {
                if (!isActive)
                  (e.currentTarget as HTMLButtonElement).style.background = "var(--ata-gray-50)";
              }}
              onMouseLeave={(e) => {
                if (!isActive)
                  (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              }}
            >
              <div
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  flexShrink: 0,
                  background: swatchBg,
                  border: `1.5px solid ${swatchBorder}`,
                }}
              />

              <span
                style={{
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontWeight: isActive ? 700 : 500,
                }}
              >
                {t.name}
              </span>

              {t.requiresBcba && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    color: "var(--ata-gray-500)",
                    flexShrink: 0,
                  }}
                >
                  BCBA
                </span>
              )}

              {!t.billable && (
                <span
                  style={{
                    fontSize: 10,
                    color: "var(--ata-gray-400)",
                    flexShrink: 0,
                  }}
                  title="Non-billable"
                >
                  nb
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div
        style={{
          padding: "14px 18px",
          borderTop: "1px solid var(--ata-gray-100)",
          marginTop: 12,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.08em",
            color: "var(--ata-gray-500)",
            textTransform: "uppercase",
            marginBottom: 10,
          }}
        >
          Status key
        </div>
        {(["proposed", "cancelled", "confirmed"] as const).map((kind) => (
          <div
            key={kind}
            style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}
          >
            <LegendSwatch kind={kind} />
            <span
              style={{
                fontSize: 12,
                color: "var(--ata-gray-600)",
                textTransform: "capitalize",
              }}
            >
              {kind === "confirmed" ? "Available" : kind}
            </span>
          </div>
        ))}
        <p
          style={{
            fontSize: 11,
            color: "var(--ata-gray-400)",
            marginTop: 10,
            lineHeight: 1.5,
          }}
        >
          Click to activate, drag on a row to place.
        </p>
      </div>
    </div>
  );
}
