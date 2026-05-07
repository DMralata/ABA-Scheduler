"use client";

import { X, CheckCircle, AlertCircle, AlertTriangle } from "lucide-react";

export type AuditData = {
  weekOf: string;
  score: number;
  scoreLabel: string;
  compliance: {
    result: "PASS" | "FAIL";
    violations: {
      clientName: string;
      providerName: string;
      rule: string;
      detail: string;
      severity: "CRITICAL" | "HIGH";
    }[];
  };
  utilization: {
    rbtProviders: {
      name: string;
      availableHours: number;
      scheduledHours: number;
      utilizationPct: number;
      gapHours: number;
    }[];
    allProviders: {
      name: string;
      position: string;
      availableHours: number;
      scheduledHours: number;
      utilizationPct: number;
      gapHours: number;
      scoredInUtilization: boolean;
    }[];
    aggregate: {
      totalAvailable: number;
      totalScheduled: number;
      utilizationPct: number;
      hoursLeftOnTable: number;
    };
  };
  coverage: {
    clients: {
      name: string;
      authorizedWeekly: number;
      scheduledHours: number;
      coveragePct: number;
      status: string;
      flags: string[];
    }[];
    summary: {
      fullyCovered: number;
      underServed: number;
      overServed: number;
      expiringAuths: number;
      clientsNoAuth: number;
    };
  };
  scoreBreakdown: {
    compliance: number;
    utilization: number;
    coverage: number;
    consistency: number;
    travel: number;
  };
  topActions: string[];
};

function fmtHours(h: number): string {
  const hrs = Math.floor(h);
  const min = Math.round((h - hrs) * 60);
  if (min === 0) return `${hrs}h`;
  return `${hrs}h ${min}m`;
}

interface Props {
  data: AuditData;
  onClose: () => void;
}

function Bar({ pct }: { pct: number }) {
  const color =
    pct >= 90 ? "bg-emerald-500" :
    pct >= 75 ? "bg-green-500" :
    pct >= 50 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

function ScorePill({ value, label, weight, description }: { value: number; label: string; weight: string; description: string }) {
  const color =
    value >= 90 ? "text-emerald-700 bg-emerald-50 border-emerald-200" :
    value >= 75 ? "text-amber-700 bg-amber-50 border-amber-200" :
    value >= 50 ? "text-orange-700 bg-orange-50 border-orange-200" :
                  "text-rose-700 bg-rose-50 border-rose-200";
  return (
    <div className={`flex flex-col px-2.5 py-1.5 rounded-lg border ${color} min-w-[80px]`} title={description}>
      <div className="flex items-baseline gap-1">
        <span className="text-sm font-bold tabular-nums">{value}</span>
        <span className="text-[10px] opacity-60">/100</span>
      </div>
      <span className="text-[10px] font-medium leading-tight">{label}</span>
      <span className="text-[9px] leading-tight opacity-60">{weight} of score</span>
    </div>
  );
}

export function WeekAnalysisModal({ data, onClose }: Props) {
  const overallColor =
    data.score >= 90 ? "text-emerald-700 border-emerald-200 bg-emerald-50" :
    data.score >= 75 ? "text-amber-700 border-amber-200 bg-amber-50" :
    data.score >= 60 ? "text-orange-700 border-orange-200 bg-orange-50" :
                       "text-rose-700 border-rose-200 bg-rose-50";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-background border border-border rounded-xl shadow-xl w-full max-w-3xl max-h-[88vh] flex flex-col">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5">
            <h2 className="text-sm font-semibold">Week Analysis</h2>
            <span className="text-xs text-muted-foreground">{data.weekOf}</span>
          </div>
          <div className="flex items-center gap-2.5">
            <div className={`flex items-baseline gap-1 px-2.5 py-1 rounded-lg border text-xs ${overallColor}`}>
              <span className="text-base font-bold tabular-nums">{data.score}</span>
              <span className="opacity-75">/ 100 · {data.scoreLabel}</span>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-0.5">
              <X size={15} />
            </button>
          </div>
        </div>

        {/* ── Score breakdown row ── */}
        <div className="px-5 py-2.5 border-b border-border bg-muted/30 shrink-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium shrink-0">
              Score Breakdown
            </span>
            <ScorePill
              value={data.scoreBreakdown.compliance} label="Compliance" weight="30%"
              description="Binary pass/fail. Any double-booking, auth overage, or availability violation = 0. Clean schedule = 100."
            />
            <ScorePill
              value={data.scoreBreakdown.utilization} label="RBT Utilization" weight="30%"
              description="Hours RBTs are actually scheduled vs. their total available hours this week. Higher = more billable time captured."
            />
            <ScorePill
              value={data.scoreBreakdown.coverage} label="Client Coverage" weight="25%"
              description="% of clients reaching ≥90% of their authorized weekly hours. Clients under 70% are flagged as under-served."
            />
            <ScorePill
              value={data.scoreBreakdown.consistency} label="Consistency" weight="10%"
              description="% of sessions assigned to the same provider the client saw in the prior 4 weeks. Supports therapeutic relationships."
            />
            <ScorePill
              value={data.scoreBreakdown.travel} label="Travel" weight="5%"
              description="% of back-to-back home sessions that have a drive time entry logged between them."
            />
          </div>
          <p className="text-[9px] text-muted-foreground">
            Composite = (Compliance × 30%) + (Utilization × 30%) + (Coverage × 25%) + (Consistency × 10%) + (Travel × 5%)
          </p>
        </div>

        {/* ── Scrollable content ── */}
        <div className="overflow-y-auto flex-1 p-5 space-y-4">

          {/* Top actions */}
          {data.topActions.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 mb-2 flex items-center gap-1.5">
                <AlertTriangle size={11} />
                Top actions to improve this score
              </p>
              <div className="space-y-1.5">
                {data.topActions.map((action, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-amber-900">
                    <span className="shrink-0 font-bold text-amber-500">{i + 1}.</span>
                    {action}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Two-column grid: Provider Utilization + Client Coverage */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            {/* Provider Utilization */}
            <div className="border border-border rounded-lg overflow-hidden flex flex-col">
              <div className="px-3.5 py-2.5 border-b border-border bg-muted/40 shrink-0">
                <p className="text-[11px] font-semibold">Provider Utilization</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  <span className={
                    data.utilization.aggregate.utilizationPct >= 75 ? "text-emerald-600 font-medium" :
                    data.utilization.aggregate.utilizationPct >= 50 ? "text-amber-600 font-medium" :
                    "text-rose-600 font-medium"
                  }>{data.utilization.aggregate.utilizationPct}%</span>
                  {" overall · "}
                  {fmtHours(data.utilization.aggregate.totalScheduled)} of {fmtHours(data.utilization.aggregate.totalAvailable)} scheduled
                  {data.utilization.aggregate.hoursLeftOnTable > 0 && (
                    <span className="text-amber-600 font-medium"> · {data.utilization.aggregate.hoursLeftOnTable}h unclaimed</span>
                  )}
                </p>
              </div>
              <div className="divide-y divide-border overflow-y-auto">
                {data.utilization.allProviders.length === 0 ? (
                  <p className="px-3.5 py-3 text-xs text-muted-foreground italic">No providers found.</p>
                ) : (
                  data.utilization.allProviders.map((r) => (
                    <div key={r.name} className="px-3.5 py-2.5">
                      <div className="flex items-baseline justify-between mb-1">
                        <div className="flex items-center gap-1.5 min-w-0 mr-2">
                          <span className="text-xs font-medium truncate">{r.name}</span>
                          <span className={`shrink-0 text-[9px] font-semibold px-1 py-0.5 rounded uppercase tracking-wide ${
                            r.scoredInUtilization
                              ? "bg-blue-100 text-blue-700"
                              : "bg-muted text-muted-foreground"
                          }`}>{r.position}</span>
                        </div>
                        <span className={`text-xs font-semibold tabular-nums shrink-0 ${
                          !r.scoredInUtilization ? "text-muted-foreground" :
                          r.utilizationPct >= 90 ? "text-emerald-600" :
                          r.utilizationPct >= 75 ? "text-green-600" :
                          r.utilizationPct >= 50 ? "text-amber-600" : "text-rose-600"
                        }`}>{r.utilizationPct}%</span>
                      </div>
                      <Bar pct={r.scoredInUtilization ? r.utilizationPct : 0} />
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {fmtHours(r.scheduledHours)} scheduled · {fmtHours(r.availableHours)} available
                        {r.gapHours > 0 && r.scoredInUtilization && <span className="text-amber-600"> · {r.gapHours}h gap</span>}
                        {!r.scoredInUtilization && <span className="italic"> · not scored</span>}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Client Coverage */}
            <div className="border border-border rounded-lg overflow-hidden flex flex-col">
              <div className="px-3.5 py-2.5 border-b border-border bg-muted/40 shrink-0">
                <p className="text-[11px] font-semibold">Client Coverage</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  <span className="text-emerald-600 font-medium">{data.coverage.summary.fullyCovered} fully covered</span>
                  {data.coverage.summary.underServed > 0 && (
                    <span className="text-rose-600 font-medium"> · {data.coverage.summary.underServed} under-served</span>
                  )}
                  {data.coverage.summary.expiringAuths > 0 && (
                    <span className="text-amber-600 font-medium"> · {data.coverage.summary.expiringAuths} auth expiring</span>
                  )}
                  {data.coverage.summary.clientsNoAuth > 0 && (
                    <span className="text-muted-foreground"> · {data.coverage.summary.clientsNoAuth} no auth</span>
                  )}
                </p>
              </div>
              <div className="divide-y divide-border overflow-y-auto">
                {data.coverage.clients.length === 0 ? (
                  <p className="px-3.5 py-3 text-xs text-muted-foreground italic">No clients with active authorizations found.</p>
                ) : (
                  data.coverage.clients.map((c) => (
                    <div key={c.name} className="px-3.5 py-2.5">
                      <div className="flex items-baseline justify-between mb-1">
                        <span className="text-xs font-medium truncate mr-2">{c.name}</span>
                        <span className={`text-xs font-semibold tabular-nums shrink-0 ${
                          c.coveragePct >= 90 ? "text-emerald-600" :
                          c.coveragePct >= 70 ? "text-amber-600" : "text-rose-600"
                        }`}>{c.coveragePct}%</span>
                      </div>
                      <Bar pct={c.coveragePct} />
                      <div className="flex flex-wrap items-center gap-x-2 mt-0.5">
                        <p className="text-[10px] text-muted-foreground">
                          {fmtHours(c.scheduledHours)} / {fmtHours(c.authorizedWeekly)} auth&apos;d
                        </p>
                        {c.flags.map((f, i) => (
                          <span key={i} className="text-[10px] text-rose-600">{f}</span>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>

          {/* Compliance */}
          <div className={`rounded-lg border px-4 py-3 flex items-start gap-2.5 ${
            data.compliance.result === "PASS"
              ? "border-emerald-200 bg-emerald-50"
              : "border-rose-200 bg-rose-50"
          }`}>
            {data.compliance.result === "PASS" ? (
              <CheckCircle size={14} className="text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle size={14} className="text-rose-600 shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <p className={`text-xs font-semibold ${
                data.compliance.result === "PASS" ? "text-emerald-700" : "text-rose-700"
              }`}>
                Compliance: {data.compliance.result === "PASS"
                  ? "PASS — No violations found"
                  : `FAIL — ${data.compliance.violations.length} violation${data.compliance.violations.length !== 1 ? "s" : ""} found`
                }
              </p>
              {data.compliance.violations.map((v, i) => (
                <p key={i} className="text-xs text-rose-700 mt-1">
                  {v.detail}
                  <span className="ml-1 font-semibold">[{v.severity}]</span>
                </p>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
