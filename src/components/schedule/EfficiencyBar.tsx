"use client";

import { useEffect, useState } from "react";

interface EfficiencyData {
  rbtAvailableHours: number;
  scheduledHours: number;
  efficiencyPct: number;
  scheduledClients: number;
  totalRbtProviders: number;
}

interface EfficiencyBarProps {
  centerId: string | null;
  currentDate: Date;     // the day currently being viewed
  refreshKey: number;    // increment to re-fetch after Auto Complete or Clear
}

function fmtHours(h: number): string {
  const hrs = Math.floor(h);
  const min = Math.round((h - hrs) * 60);
  if (min === 0) return `${hrs}h`;
  return `${hrs}h ${min}m`;
}

function getBarColor(pct: number): string {
  if (pct >= 75) return "bg-emerald-500";
  if (pct >= 50) return "bg-amber-400";
  return "bg-rose-500";
}

function getTextColor(pct: number): string {
  if (pct >= 75) return "text-emerald-600";
  if (pct >= 50) return "text-amber-600";
  return "text-rose-600";
}

export function EfficiencyBar({ centerId, currentDate, refreshKey }: EfficiencyBarProps) {
  const [data, setData] = useState<EfficiencyData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!centerId) return;

    setLoading(true);
    const params = new URLSearchParams({
      date: currentDate.toISOString(),
      centerId,
    });

    fetch(`/api/schedule/efficiency?${params}`)
      .then((r) => r.json())
      .then((d: EfficiencyData) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [centerId, currentDate, refreshKey]);

  if (!centerId || loading || !data) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Schedule Efficiency</span>
        <div className="w-24 h-1.5 rounded-full bg-muted animate-pulse" />
      </div>
    );
  }

  const pct = data.efficiencyPct;
  const barColor = getBarColor(pct);
  const textColor = getTextColor(pct);

  return (
    <div className="flex items-center gap-2" title={`${fmtHours(data.scheduledHours)} billable of ${fmtHours(data.rbtAvailableHours)} RBT capacity · ${data.scheduledClients} client${data.scheduledClients !== 1 ? "s" : ""} scheduled`}>
      <span className="text-xs text-muted-foreground whitespace-nowrap">Schedule Efficiency</span>
      {/* Track */}
      <div className="relative w-24 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`absolute left-0 top-0 h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-xs font-medium tabular-nums ${textColor}`}>
        {pct.toFixed(0)}%
      </span>
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        ({fmtHours(data.scheduledHours)}&nbsp;/&nbsp;{fmtHours(data.rbtAvailableHours)})
      </span>
    </div>
  );
}
