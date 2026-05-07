"use client";

import { useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProviderStat = {
  providerId: string;
  providerName: string;
  position: string;
  billedHours: number;
  directTherapy: number;
  directTherapyHome: number;
  supervision: number;
  parentTraining: number;
  assessment: number;
  driveTime: number;
  scheduledHours: number;
  cancellations: number;
};

export type ProviderSummaryData = {
  wtd: ProviderStat[];
  mtd: ProviderStat[];
  ytd: ProviderStat[];
};

type Period = "wtd" | "mtd" | "ytd";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtHours(h: number): string {
  if (h === 0) return "—";
  const hrs = Math.floor(h);
  const min = Math.round((h - hrs) * 60);
  if (min === 0) return `${hrs}h`;
  return `${hrs}h ${min}m`;
}

const POSITION_BADGE: Record<string, string> = {
  BCBA:  "bg-purple-50 text-purple-700 border-purple-200",
  BCaBA: "bg-teal-50 text-teal-700 border-teal-200",
  RBT:   "bg-sky-50 text-sky-700 border-sky-200",
};

const PERIOD_LABELS: Record<Period, string> = { wtd: "WTD", mtd: "MTD", ytd: "YTD" };

// ─── Component ────────────────────────────────────────────────────────────────

export function ProviderSummaryTable({ data }: { data: ProviderSummaryData }) {
  const [period, setPeriod] = useState<Period>("wtd");

  const stats = data[period];

  const bcbas = stats.filter((s) => s.position === "BCBA" || s.position === "BCaBA");
  const rbts  = stats.filter((s) => s.position === "RBT");
  const other = stats.filter((s) => s.position !== "BCBA" && s.position !== "BCaBA" && s.position !== "RBT");

  const groups = [
    { label: "BCBAs / BCaBAs", rows: bcbas },
    { label: "RBTs",           rows: rbts  },
    ...(other.length ? [{ label: "Other", rows: other }] : []),
  ].filter((g) => g.rows.length > 0);

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-foreground">Provider Summary</h2>
        <div className="flex gap-1 bg-muted rounded-lg p-0.5">
          {(["wtd", "mtd", "ytd"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                period === p
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {stats.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">No sessions in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 pr-4 font-medium text-muted-foreground uppercase tracking-wide text-[10px] w-44">Provider</th>
                <th className="text-right py-2 px-3 font-medium text-muted-foreground uppercase tracking-wide text-[10px]">Billed</th>
                <th className="text-right py-2 px-3 font-medium text-muted-foreground uppercase tracking-wide text-[10px]">Scheduled</th>
                <th className="py-2 px-3 font-medium text-muted-foreground uppercase tracking-wide text-[10px] w-28">Completion</th>
                <th className="text-right py-2 px-3 font-medium text-muted-foreground uppercase tracking-wide text-[10px]">Drive (h)</th>
                <th className="text-right py-2 pl-3 font-medium text-muted-foreground uppercase tracking-wide text-[10px]">Cancels</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <>
                  <tr key={group.label} className="bg-muted/40">
                    <td
                      colSpan={6}
                      className="py-1 px-0 text-[9px] font-bold text-muted-foreground uppercase tracking-widest pt-3"
                    >
                      {group.label}
                    </td>
                  </tr>
                  {group.rows.map((s) => {
                    const pct = s.scheduledHours > 0
                      ? Math.round((s.billedHours / s.scheduledHours) * 100)
                      : null;
                    const badgeClass = POSITION_BADGE[s.position] ?? "bg-muted text-muted-foreground border-border";
                    return (
                      <tr key={s.providerId} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                        {/* Provider name + position */}
                        <td className="py-2.5 pr-4">
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold border shrink-0 ${badgeClass}`}>
                              {s.position}
                            </span>
                            <span className="font-medium text-foreground truncate">{s.providerName}</span>
                          </div>
                        </td>

                        {/* Billed hours */}
                        <td className="py-2.5 px-3 text-right tabular-nums text-foreground font-medium">
                          {fmtHours(s.billedHours)}
                        </td>

                        {/* Scheduled hours */}
                        <td className="py-2.5 px-3 text-right tabular-nums text-muted-foreground">
                          {fmtHours(s.scheduledHours)}
                        </td>

                        {/* Completion % with mini bar */}
                        <td className="py-2.5 px-3">
                          {pct !== null ? (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-400" : "bg-red-400"
                                  }`}
                                  style={{ width: `${Math.min(100, pct)}%` }}
                                />
                              </div>
                              <span className="tabular-nums text-muted-foreground w-8 text-right shrink-0">
                                {pct}%
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>

                        {/* Drive time */}
                        <td className="py-2.5 px-3 text-right tabular-nums text-muted-foreground">
                          {fmtHours(s.driveTime)}
                        </td>

                        {/* Cancellations */}
                        <td className={`py-2.5 pl-3 text-right tabular-nums font-medium ${
                          s.cancellations > 0 ? "text-red-500" : "text-muted-foreground"
                        }`}>
                          {s.cancellations > 0 ? s.cancellations : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
