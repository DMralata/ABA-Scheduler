import * as React from "react";

export type ProgressVariant = "success" | "warning" | "danger";

export function getProgressVariant(value: number): ProgressVariant {
  if (value >= 95) return "danger";
  if (value >= 75) return "warning";
  return "success";
}

type ProgressBarProps = {
  value: number;
  max?: number;
  width?: number | string;
  showLabel?: boolean;
  labelSuffix?: string;
};

export function ProgressBar({
  value,
  max = 100,
  width = 120,
  showLabel = false,
  labelSuffix = "h",
}: ProgressBarProps) {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const variant = getProgressVariant(pct);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div className="ata-progress" style={{ width }}>
        <div
          className={`ata-progress-fill ata-progress-fill--${variant}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ata-gray-700)" }}>
          {value}/{max}
          {labelSuffix}
        </span>
      )}
    </div>
  );
}

type SegmentedProps = {
  used?: number;
  total?: number;
};

export function SegmentedProgress({ used = 0, total = 20 }: SegmentedProps) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {Array.from({ length: total }).map((_, index) => {
        const filled = index < used;
        const warning = index === Math.floor(used) && total > 0 && used / total >= 0.75;
        return (
          <span
            key={index}
            style={{
              width: 30,
              height: 22,
              borderRadius: 4,
              background: filled
                ? warning
                  ? "var(--ata-warning-500)"
                  : "var(--ata-success-600)"
                : "var(--ata-gray-100)",
            }}
          />
        );
      })}
    </div>
  );
}
