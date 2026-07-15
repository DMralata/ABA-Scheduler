"use client";

import { useState } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { X, User, Briefcase, Tag } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Bucket = {
  label: string;
  billedHours: number;
  unbillableHours: number;
  rbtBilledHours: number;
  rbtAvailableHours: number;
  cancellations: number;
  noShows: number;
  totalSessions: number;
  billedDirectTherapy: number;
  billedDirectTherapyHome: number;
  supervisionHours: number;
  parentTrainingHours: number;
  assessmentHours: number;
  driveTimeHours: number;
  scheduledDirectTherapy: number;
  scheduledDirectTherapyHome: number;
  scheduledSupervision: number;
  scheduledParentTraining: number;
  scheduledAssessment: number;
  topClientCancellations: { name: string; count: number }[];
  topProviderCancellations: { name: string; count: number }[];
  cancellationsByReason: { reason: string; clientCount: number; providerCount: number }[];
};

export type DashboardChartData = {
  wtd: Bucket[];
  mtd: Bucket[];
  ytd: Bucket[];
  r12: Bucket[];
};

// ─── Chart Colors — all hex codes live here only ─────────────────────────────

const CHART_COLORS = {
  billed:            "#3b82f6", // blue
  efficiency:        "#10b981", // emerald
  cancellations:     "#ef4444", // red
  noShows:           "#f59e0b", // amber
  unbillable:        "#94a3b8", // slate
  scheduledHours:    "#0ea5e9", // sky
  driveTime:         "#6b7280", // gray
  directTherapy:     "#0ea5e9", // sky blue  — center sessions
  directTherapyHome: "#38bdf8", // lighter sky — home sessions
  supervision:       "#8b5cf6", // purple
  parentTraining:    "#10b981", // green
  assessment:        "#f97316", // orange
  completionLine:    "#a8a29e", // warm gray
};

// Aliases for stacked bar usage — kept for readability
const SCHEDULED_COLORS = {
  directTherapy:     CHART_COLORS.directTherapy,
  directTherapyHome: CHART_COLORS.directTherapyHome,
  supervision:       CHART_COLORS.supervision,
  parentTraining:    CHART_COLORS.parentTraining,
  assessment:        CHART_COLORS.assessment,
};

// ─── Metric Config ────────────────────────────────────────────────────────────

type MetricId =
  | "billed"
  | "efficiency"
  | "cancellations"
  | "billedVsUnbilled"
  | "scheduledHours"
  | "driveTime";

type Period = "wtd" | "mtd" | "ytd" | "r12";

const METRICS: { id: MetricId; label: string; color: string; color2?: string }[] = [
  { id: "billed",     label: "Billed Hours",    color: CHART_COLORS.billed },
  { id: "efficiency", label: "RBT Efficiency", color: CHART_COLORS.efficiency },
  { id: "cancellations",    label: "Cancellations",      color: CHART_COLORS.cancellations },
  { id: "billedVsUnbilled", label: "Billed vs Unbilled", color: CHART_COLORS.billed, color2: CHART_COLORS.unbillable },
  { id: "scheduledHours",   label: "Scheduled Hours",    color: CHART_COLORS.scheduledHours },
  { id: "driveTime",        label: "Drive Time",         color: CHART_COLORS.driveTime },
];

const PERIOD_LABELS: Record<Period, string> = { wtd: "WTD", mtd: "MTD", ytd: "YTD", r12: "12M" };

const DATAKEY: Record<MetricId, string> = {
  billed:           "billed",
  efficiency:       "efficiency",
  cancellations:    "cancellations",
  billedVsUnbilled: "billed",
  scheduledHours:   "scheduledDirectTherapy",
  driveTime:        "driveTime",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtHours(h: number): string {
  const hrs = Math.floor(h);
  const min = Math.round((h - hrs) * 60);
  if (min === 0) return `${hrs}h`;
  return `${hrs}h ${min}m`;
}

function mergeCancellationField<K extends string>(
  buckets: Bucket[],
  key: K
): K extends "topClientCancellations" | "topProviderCancellations"
  ? { name: string; count: number }[]
  : { reason: string; clientCount: number; providerCount: number }[] {
  // Not used directly — kept for reference
  return [] as never;
}

// Merge top-N lists across buckets into a combined sorted list (top 5)
function mergeTopList(buckets: Bucket[], field: "topClientCancellations" | "topProviderCancellations") {
  const map: Record<string, number> = {};
  for (const b of buckets) {
    for (const d of b[field]) {
      map[d.name] = (map[d.name] ?? 0) + d.count;
    }
  }
  return Object.entries(map)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

function mergeReasons(buckets: Bucket[]) {
  const map: Record<string, { clientCount: number; providerCount: number }> = {};
  for (const b of buckets) {
    for (const r of b.cancellationsByReason) {
      if (!map[r.reason]) map[r.reason] = { clientCount: 0, providerCount: 0 };
      map[r.reason].clientCount  += r.clientCount;
      map[r.reason].providerCount += r.providerCount;
    }
  }
  return Object.entries(map)
    .map(([reason, counts]) => ({ reason, ...counts }))
    .sort((a, b) => (b.clientCount + b.providerCount) - (a.clientCount + a.providerCount));
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

function CustomTooltip({
  active,
  payload,
  label,
  metricId,
}: {
  active?: boolean;
  payload?: { value: number; name: string; color: string }[];
  label?: string;
  metricId: MetricId;
}) {
  if (!active || !payload?.length) return null;
  const isPct   = metricId === "efficiency";
  const isCount = metricId === "cancellations";

  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-md">
      <p className="font-medium mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}:{" "}
          <span className="font-semibold">
            {isPct || p.name === "Completion %"
              ? `${p.value.toFixed(1)}%`
              : isCount
              ? p.value
              : fmtHours(p.value)}
          </span>
        </p>
      ))}
      {metricId === "cancellations" && (
        <p className="text-muted-foreground mt-1 italic">Click for breakdown</p>
      )}
    </div>
  );
}

// ─── Cancellation Panel ───────────────────────────────────────────────────────

function CancellationPanel({
  bucket,
  allBuckets,
  onClose,
}: {
  bucket: Bucket | null;
  allBuckets: Bucket[];
  onClose: () => void;
}) {
  const topClients   = bucket ? bucket.topClientCancellations   : mergeTopList(allBuckets, "topClientCancellations");
  const topProviders = bucket ? bucket.topProviderCancellations  : mergeTopList(allBuckets, "topProviderCancellations");
  const byReason     = bucket ? bucket.cancellationsByReason     : mergeReasons(allBuckets);
  const totalCount   = bucket
    ? bucket.cancellations
    : allBuckets.reduce((s, b) => s + b.cancellations, 0);
  const noShowCount  = bucket
    ? bucket.noShows
    : allBuckets.reduce((s, b) => s + b.noShows, 0);
  const totalSessions = bucket
    ? bucket.totalSessions
    : allBuckets.reduce((s, b) => s + b.totalSessions, 0);
  // Rate = (cancellations + no-shows) / everything that was on the books
  const lossRate = totalSessions > 0
    ? (((totalCount + noShowCount) / totalSessions) * 100).toFixed(1)
    : null;

  const maxClientCount   = topClients[0]?.count   ?? 1;
  const maxProviderCount = topProviders[0]?.count  ?? 1;
  const maxReasonCount   = byReason[0] ? byReason[0].clientCount + byReason[0].providerCount : 1;

  return (
    <div className="mt-5 border-t border-border pt-5">
      {/* Panel header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xs font-semibold">
            {bucket ? bucket.label : "All periods"} &middot;{" "}
            <span className="text-red-500">{totalCount}</span> cancellation{totalCount !== 1 ? "s" : ""}
            {noShowCount > 0 && (
              <> &middot; <span className="text-amber-500">{noShowCount}</span> no-show{noShowCount !== 1 ? "s" : ""}</>
            )}
            {lossRate !== null && (
              <span className="text-muted-foreground font-normal"> &middot; {lossRate}% of {totalSessions} scheduled</span>
            )}
          </p>
          {!bucket && (
            <p className="text-[11px] text-muted-foreground mt-0.5">Click a bar to filter by period</p>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X size={13} />
        </button>
      </div>

      {totalCount === 0 ? (
        <p className="text-xs text-muted-foreground py-2">No cancellations in this period.</p>
      ) : (
        <div className="grid grid-cols-3 gap-6">

          {/* Top 5 Clients */}
          <div>
            <div className="flex items-center gap-1.5 mb-3">
              <User size={12} className="text-muted-foreground" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Top Clients</p>
            </div>
            {topClients.length === 0 ? (
              <p className="text-xs text-muted-foreground">None</p>
            ) : (
              <div className="space-y-2">
                {topClients.map((d) => (
                  <div key={d.name} className="flex items-center gap-2">
                    <span className="text-xs flex-1 truncate">{d.name}</span>
                    <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden shrink-0">
                      <div
                        className="h-full rounded-full bg-red-400"
                        style={{ width: `${(d.count / maxClientCount) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs font-semibold tabular-nums w-4 text-right shrink-0">{d.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top 5 Providers */}
          <div>
            <div className="flex items-center gap-1.5 mb-3">
              <Briefcase size={12} className="text-muted-foreground" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Top Providers</p>
            </div>
            {topProviders.length === 0 ? (
              <p className="text-xs text-muted-foreground">None</p>
            ) : (
              <div className="space-y-2">
                {topProviders.map((d) => (
                  <div key={d.name} className="flex items-center gap-2">
                    <span className="text-xs flex-1 truncate">{d.name}</span>
                    <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden shrink-0">
                      <div
                        className="h-full rounded-full bg-amber-400"
                        style={{ width: `${(d.count / maxProviderCount) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs font-semibold tabular-nums w-4 text-right shrink-0">{d.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* By Reason */}
          <div>
            <div className="flex items-center gap-1.5 mb-3">
              <Tag size={12} className="text-muted-foreground" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">By Reason</p>
            </div>
            {byReason.length === 0 ? (
              <p className="text-xs text-muted-foreground">None</p>
            ) : (
              <div className="space-y-2">
                {byReason.map((r) => {
                  const total = r.clientCount + r.providerCount;
                  return (
                    <div key={r.reason}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-xs truncate flex-1 pr-2">{r.reason}</span>
                        <span className="text-xs font-semibold tabular-nums shrink-0">{total}</span>
                      </div>
                      {/* Stacked bar: client (red) + provider (amber) */}
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden flex">
                        <div
                          className="h-full bg-red-400"
                          style={{ width: `${(r.clientCount / maxReasonCount) * 100}%` }}
                        />
                        <div
                          className="h-full bg-amber-400"
                          style={{ width: `${(r.providerCount / maxReasonCount) * 100}%` }}
                        />
                      </div>
                      {(r.clientCount > 0 || r.providerCount > 0) && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {r.clientCount > 0 && <span className="text-red-400">{r.clientCount} client</span>}
                          {r.clientCount > 0 && r.providerCount > 0 && " · "}
                          {r.providerCount > 0 && <span className="text-amber-500">{r.providerCount} provider</span>}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function DashboardChart({ data }: { data: DashboardChartData }) {
  const [period, setPeriod]     = useState<Period>("wtd");
  const [metric, setMetric]     = useState<MetricId>("billed");
  const [clickedIdx, setClickedIdx] = useState<number | null>(null);
  // showPanel stays true as long as cancellations is the active metric and user hasn't dismissed
  const [panelOpen, setPanelOpen] = useState(false);

  const buckets    = data[period];
  const metricCfg  = METRICS.find((m) => m.id === metric)!;
  const isBilledCombo   = metric === "billed";
  const isDual          = metric === "billedVsUnbilled" || metric === "scheduledHours";
  const isPct           = metric === "efficiency";
  const isCancellations = metric === "cancellations";

  const chartData = buckets.map((b) => {
    const efficiency = b.rbtAvailableHours > 0
      ? parseFloat(((b.rbtBilledHours / b.rbtAvailableHours) * 100).toFixed(1))
      : 0;
    const totalScheduledBillable =
      b.scheduledDirectTherapy + b.scheduledDirectTherapyHome +
      b.scheduledSupervision   + b.scheduledParentTraining   + b.scheduledAssessment;
    const billedCompletionPct = totalScheduledBillable > 0
      ? parseFloat(((b.billedHours / totalScheduledBillable) * 100).toFixed(1))
      : null;
    return {
      label:           b.label,
      billed:          parseFloat(b.billedHours.toFixed(2)),
      unbillable:      parseFloat(b.unbillableHours.toFixed(2)),
      efficiency,
      cancellations:   b.cancellations,
      noShows:         b.noShows,
      billedDT:        parseFloat(b.billedDirectTherapy.toFixed(2)),
      billedDTH:       parseFloat(b.billedDirectTherapyHome.toFixed(2)),
      billedCompletionPct,
      scheduledDirectTherapy:     parseFloat(b.scheduledDirectTherapy.toFixed(2)),
      scheduledDirectTherapyHome: parseFloat(b.scheduledDirectTherapyHome.toFixed(2)),
      scheduledSupervision:       parseFloat(b.scheduledSupervision.toFixed(2)),
      scheduledParentTraining:    parseFloat(b.scheduledParentTraining.toFixed(2)),
      scheduledAssessment:        parseFloat(b.scheduledAssessment.toFixed(2)),
      supervision:     parseFloat(b.supervisionHours.toFixed(2)),
      parentTraining:  parseFloat(b.parentTrainingHours.toFixed(2)),
      assessments:     parseFloat(b.assessmentHours.toFixed(2)),
      driveTime:       parseFloat(b.driveTimeHours.toFixed(2)),
    };
  });

  function handlePeriodChange(p: Period) {
    setPeriod(p);
    setClickedIdx(null);
  }

  function handleMetricChange(m: MetricId) {
    setMetric(m);
    setClickedIdx(null);
    if (m === "cancellations") setPanelOpen(true);
    else setPanelOpen(false);
  }

  function handleBarClick(_: unknown, index: number) {
    if (!isCancellations) return;
    setPanelOpen(true);
    setClickedIdx((prev) => (prev === index ? null : index));
  }

  const clickedBucket = clickedIdx !== null ? buckets[clickedIdx] : null;

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-foreground">Activity</h2>
        <div className="flex gap-1 bg-muted rounded-lg p-0.5">
          {(["wtd", "mtd", "ytd", "r12"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => handlePeriodChange(p)}
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

      {/* Metric tabs */}
      <div className="flex flex-wrap gap-1.5 mb-5">
        {METRICS.map((m) => (
          <button
            key={m.id}
            onClick={() => handleMetricChange(m.id)}
            className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
              metric === m.id
                ? "bg-foreground text-background border-foreground"
                : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart
          data={chartData}
          margin={{ top: 4, right: isBilledCombo ? 40 : 4, left: -12, bottom: 0 }}
          barCategoryGap="30%"
        >
          <CartesianGrid
            vertical={false}
            stroke="currentColor"
            strokeOpacity={0.08}
            strokeDasharray="3 3"
          />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "currentColor", opacity: 0.5 }}
            axisLine={false}
            tickLine={false}
          />
          {/* Left axis — always hours (or % / count for special metrics) */}
          {isBilledCombo ? (
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 11, fill: "currentColor", opacity: 0.5 }}
              axisLine={false}
              tickLine={false}
              unit="h"
            />
          ) : (
            <YAxis
              tick={{ fontSize: 11, fill: "currentColor", opacity: 0.5 }}
              axisLine={false}
              tickLine={false}
              unit={isPct ? "%" : isCancellations ? "" : "h"}
            />
          )}
          {/* Right axis — completion % only for billed combo */}
          {isBilledCombo && (
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={[0, 100]}
              tick={{ fontSize: 11, fill: "currentColor", opacity: 0.5 }}
              axisLine={false}
              tickLine={false}
              unit="%"
            />
          )}
          <Tooltip
            content={<CustomTooltip metricId={metric} />}
            cursor={{ fill: "currentColor", opacity: 0.04 }}
          />
          {isBilledCombo ? (
            <>
              <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              <Bar yAxisId="left" dataKey="billedDT"       name="Direct Therapy"      fill={SCHEDULED_COLORS.directTherapy}     stackId="s" radius={[0, 0, 0, 0]} />
              <Bar yAxisId="left" dataKey="billedDTH"      name="Direct Therapy Home" fill={SCHEDULED_COLORS.directTherapyHome}  stackId="s" radius={[0, 0, 0, 0]} />
              <Bar yAxisId="left" dataKey="supervision"    name="Supervision"         fill={SCHEDULED_COLORS.supervision}       stackId="s" radius={[0, 0, 0, 0]} />
              <Bar yAxisId="left" dataKey="parentTraining" name="Parent Training"     fill={SCHEDULED_COLORS.parentTraining}    stackId="s" radius={[0, 0, 0, 0]} />
              <Bar yAxisId="left" dataKey="assessments"    name="Assessment"          fill={SCHEDULED_COLORS.assessment}        stackId="s" radius={[3, 3, 0, 0]} />
              <Line
                yAxisId="right"
                dataKey="billedCompletionPct"
                name="Completion %"
                stroke={CHART_COLORS.completionLine}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={{ r: 3.5, fill: CHART_COLORS.completionLine, strokeWidth: 0 }}
                activeDot={{ r: 5, fill: CHART_COLORS.completionLine, strokeWidth: 0 }}
                connectNulls={false}
              />
            </>
          ) : isDual ? (
            <>
              <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              {metric === "scheduledHours" ? (
                <>
                  <Bar dataKey="scheduledDirectTherapy"     name="Direct Therapy"      fill={SCHEDULED_COLORS.directTherapy}     stackId="s" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="scheduledDirectTherapyHome" name="Direct Therapy Home" fill={SCHEDULED_COLORS.directTherapyHome}  stackId="s" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="scheduledSupervision"       name="Supervision"         fill={SCHEDULED_COLORS.supervision}       stackId="s" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="scheduledParentTraining"    name="Parent Training"     fill={SCHEDULED_COLORS.parentTraining}    stackId="s" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="scheduledAssessment"        name="Assessment"          fill={SCHEDULED_COLORS.assessment}        stackId="s" radius={[3, 3, 0, 0]} />
                </>
              ) : (
                <>
                  <Bar dataKey="billed"     name="Billed"     fill={metricCfg.color}   stackId="s" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="unbillable" name="Unbillable" fill={metricCfg.color2!} stackId="s" radius={[3, 3, 0, 0]} />
                </>
              )}
            </>
          ) : isCancellations ? (
            <>
              <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              <Bar
                dataKey="cancellations"
                name="Cancellations"
                fill={CHART_COLORS.cancellations}
                radius={[3, 3, 0, 0]}
                cursor="pointer"
                onClick={handleBarClick}
              />
              <Bar
                dataKey="noShows"
                name="No-shows"
                fill={CHART_COLORS.noShows}
                radius={[3, 3, 0, 0]}
                cursor="pointer"
                onClick={handleBarClick}
              />
            </>
          ) : (
            <Bar
              dataKey={DATAKEY[metric]}
              name={metricCfg.label}
              fill={metricCfg.color}
              radius={[3, 3, 0, 0]}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      {/* Cancellation breakdown panel */}
      {isCancellations && panelOpen && (
        <CancellationPanel
          bucket={clickedBucket}
          allBuckets={buckets}
          onClose={() => { setPanelOpen(false); setClickedIdx(null); }}
        />
      )}

      {/* Hint when cancellations metric is active but panel is closed */}
      {isCancellations && !panelOpen && (
        <div className="mt-3 text-center">
          <button
            onClick={() => setPanelOpen(true)}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
          >
            Show cancellation breakdown
          </button>
        </div>
      )}
    </div>
  );
}
