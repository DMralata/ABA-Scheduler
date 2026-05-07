"use client";

import { X, Car, MapPin } from "lucide-react";

interface DriveTimeMeta {
  fromClientId: string;
  fromName: string;
  fromAddress?: string | null;
  fromLat: number | null;
  fromLng: number | null;
  toClientId: string;
  toName: string;
  toAddress?: string | null;
  toLat: number | null;
  toLng: number | null;
  driveMinutes: number;
  distanceMeters?: number;
}

export interface DriveTimeSummaryTarget {
  sessionId: string;
  providerName: string;
  startLabel: string;      // pre-formatted local time
  totalBlockMinutes: number; // full duration of the drive block (drive + buffer)
  notes: string | null;    // raw JSON from session.notes
}

interface DriveTimeSummaryModalProps {
  target: DriveTimeSummaryTarget;
  onClose: () => void;
}

function parseMeta(notes: string | null): DriveTimeMeta | null {
  if (!notes) return null;
  try {
    return JSON.parse(notes) as DriveTimeMeta;
  } catch {
    return null;
  }
}

function mapsUrl(meta: DriveTimeMeta): string | null {
  // Prefer address strings (more accurate); fall back to lat/lng
  const from = meta.fromAddress ?? (meta.fromLat != null && meta.fromLng != null ? `${meta.fromLat},${meta.fromLng}` : null);
  const to = meta.toAddress ?? (meta.toLat != null && meta.toLng != null ? `${meta.toLat},${meta.toLng}` : null);
  if (!from || !to) return null;
  return `https://www.google.com/maps/dir/${encodeURIComponent(from)}/${encodeURIComponent(to)}`;
}

function formatMiles(meters: number): string {
  const miles = meters / 1609.344;
  return miles < 0.1 ? `${Math.round(meters)} m` : `${miles.toFixed(1)} mi`;
}

export function DriveTimeSummaryModal({ target, onClose }: DriveTimeSummaryModalProps) {
  const meta = parseMeta(target.notes);
  const minsRounded = meta ? Math.round(meta.driveMinutes) : null;
  const distanceMi = meta?.distanceMeters ? formatMiles(meta.distanceMeters) : null;
  const mapsLink = meta ? mapsUrl(meta) : null;
  const bufferMins = minsRounded != null ? Math.max(0, target.totalBlockMinutes - minsRounded) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(6, 21, 41, 0.58)", backdropFilter: "blur(2px)", padding: 24 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full mx-4"
        style={{
          maxWidth: 480,
          background: "#FFFFFF",
          borderRadius: 20,
          boxShadow: "var(--shadow-modal)",
          maxHeight: "calc(100vh - 48px)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "24px 28px 18px",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <span
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: "var(--ata-gray-50)",
                color: "var(--ata-gray-700)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flex: "0 0 auto",
              }}
              aria-hidden
            >
              <Car size={20} />
            </span>
            <div>
              <h2
                style={{
                  fontSize: 20,
                  lineHeight: "28px",
                  fontWeight: 700,
                  color: "var(--ata-gray-900)",
                  margin: 0,
                }}
              >
                Drive Time
              </h2>
              <p
                style={{
                  fontSize: 14,
                  lineHeight: "20px",
                  color: "var(--ata-gray-600)",
                  margin: "4px 0 0",
                }}
              >
                {target.providerName} · {target.startLabel}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ata-icon-button"
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: "0 28px 24px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
          {meta ? (
            <>
              {/* Route */}
              <div className="space-y-2">
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 flex flex-col items-center gap-0.5">
                    <MapPin size={12} className="text-emerald-500 shrink-0" />
                    <div className="w-px flex-1 min-h-[16px] bg-border" />
                    <MapPin size={12} className="text-rose-500 shrink-0" />
                  </div>
                  <div className="flex-1 space-y-2">
                    <div>
                      <p className="text-[11px] text-muted-foreground">From</p>
                      <p className="text-xs font-medium">{meta.fromName}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">To</p>
                      <p className="text-xs font-medium">{meta.toName}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Est. time + distance + buffer */}
              <div className="rounded-lg bg-muted/60 border border-border px-3 py-2.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Est. drive time</span>
                  <span className="text-sm font-semibold tabular-nums">{minsRounded} min</span>
                </div>
                {bufferMins != null && bufferMins > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Misc. Setup and Parking Allocation</span>
                    <span className="text-sm font-semibold tabular-nums text-muted-foreground">{bufferMins} min</span>
                  </div>
                )}
                {bufferMins != null && (
                  <div className="flex items-center justify-between border-t border-border pt-1.5">
                    <span className="text-xs font-medium">Total block</span>
                    <span className="text-sm font-semibold tabular-nums">{target.totalBlockMinutes} min</span>
                  </div>
                )}
                {distanceMi && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Distance</span>
                    <span className="text-sm font-semibold tabular-nums">{distanceMi}</span>
                  </div>
                )}
              </div>

              {/* Maps link */}
              {mapsLink && (
                <a
                  href={mapsLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg border border-border text-xs font-medium hover:bg-muted transition-colors"
                >
                  <Car size={11} />
                  Open in Google Maps
                </a>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">No route details available for this drive time block.</p>
          )}
        </div>
      </div>
    </div>
  );
}
