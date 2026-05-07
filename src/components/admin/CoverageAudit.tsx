"use client";

import { useState } from "react";
import { assignApprovedHomeProvider } from "@/lib/actions/clients";
import type { ClientAuditRow, ProviderAuditRow } from "@/lib/queries/coverage";
import { UserPlus, Check, AlertTriangle, TrendingDown } from "lucide-react";

function fmtHours(h: number): string {
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

function UtilBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    pct < 70 ? "bg-amber-500" : pct < 85 ? "bg-emerald-500" : "bg-blue-500";
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-xs tabular-nums w-8 text-right text-muted-foreground">{pct}%</span>
    </div>
  );
}

// ─── Provider Utilization Panel ────────────────────────────────────────────────

function ProviderUtilizationPanel({ providers }: { providers: ProviderAuditRow[] }) {
  const sorted = [...providers].sort((a, b) => a.utilization - b.utilization);

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-foreground">Provider Utilization</h2>
        <span className="text-xs text-muted-foreground">{providers.length} active</span>
      </div>
      <div className="space-y-3">
        {sorted.map((p) => (
          <div key={p.id}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2 min-w-0">
                {p.utilization < 0.70 && (
                  <TrendingDown size={13} className="text-amber-500 shrink-0" />
                )}
                <span className="text-sm font-medium truncate">
                  {p.lastName}, {p.firstName}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {p.position}{p.rbtLevel ? ` L${p.rbtLevel}` : ""}
                </span>
              </div>
              <span className="text-xs text-muted-foreground tabular-nums shrink-0 ml-2">
                {fmtHours(p.scheduledHoursThisWeek)} / {fmtHours(p.availableHoursPerWeek)}
                {" · "}{p.approvedClientCount} client{p.approvedClientCount !== 1 ? "s" : ""}
              </span>
            </div>
            <UtilBar value={p.utilization} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Client Coverage Card ──────────────────────────────────────────────────────

function ClientCoverageCard({ client }: { client: ClientAuditRow }) {
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const coveragePct = Math.round(client.coverage * 100);

  function handleAdd(providerId: string) {
    setError(null);
    setPendingId(providerId);
    assignApprovedHomeProvider(client.id, providerId)
      .then((result) => {
        setPendingId(null);
        if (!result.success) { setError(result.error); return; }
        setAddedIds((prev) => new Set([...prev, providerId]));
      })
      .catch(() => {
        setPendingId(null);
        setError("Failed to add provider.");
      });
  }

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-foreground">
            {client.lastName}, {client.firstName}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-muted-foreground capitalize">
              {client.preferredLocation.toLowerCase()}
            </span>
            {client.femaleProviderOnly && (
              <span className="text-xs bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 px-1.5 py-0.5 rounded">female only</span>
            )}
            {client.spanish && (
              <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 px-1.5 py-0.5 rounded">spanish</span>
            )}
            {client.minimumRbtLevel && (
              <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded">RBT L{client.minimumRbtLevel}+</span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0 ml-3">
          <p className={`text-sm font-bold tabular-nums ${coveragePct < 50 ? "text-destructive" : "text-amber-600"}`}>
            {coveragePct}%
          </p>
          <p className="text-xs text-muted-foreground">
            {fmtHours(client.scheduledHoursThisWeek)} / {fmtHours(client.authorizedWeeklyHours)}
          </p>
        </div>
      </div>

      {/* Coverage bar */}
      <div className="mb-4">
        <UtilBar value={client.coverage} />
      </div>

      {/* Approved count */}
      <p className="text-xs text-muted-foreground mb-3">
        {client.approvedProviderCount} provider{client.approvedProviderCount !== 1 ? "s" : ""} on approved list
      </p>

      {error && <p className="text-xs text-destructive mb-2">{error}</p>}

      {/* Suggested providers */}
      {client.suggestedProviders.length === 0 ? (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground py-2">
          <AlertTriangle size={13} className="text-amber-500" />
          No eligible providers with open capacity — check availability or constraints
        </div>
      ) : (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">Suggested additions</p>
          <div className="space-y-1.5">
            {client.suggestedProviders.map((p) => {
              const added = addedIds.has(p.id);
              const pending = pendingId === p.id;
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-2 py-1.5 px-2.5 rounded-lg bg-muted/50"
                >
                  <div className="min-w-0">
                    <span className="text-xs font-medium">{p.lastName}, {p.firstName}</span>
                    <span className="text-xs text-muted-foreground ml-1.5">
                      {p.position}{p.rbtLevel ? ` L${p.rbtLevel}` : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {Math.round(p.utilization * 100)}% util
                    </span>
                    {added ? (
                      <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                        <Check size={12} />
                        Added
                      </span>
                    ) : (
                      <button
                        onClick={() => handleAdd(p.id)}
                        disabled={!!pendingId}
                        className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium disabled:opacity-50 transition-colors"
                      >
                        <UserPlus size={12} />
                        {pending ? "Adding…" : "Add"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Export ───────────────────────────────────────────────────────────────

interface CoverageAuditProps {
  providers: ProviderAuditRow[];
  clients: ClientAuditRow[];
  weekLabel: string;
}

export function CoverageAudit({ providers, clients, weekLabel }: CoverageAuditProps) {
  const [tab, setTab] = useState<"clients" | "providers">("clients");

  const underServed = clients
    .filter((c) => c.coverage < 0.70 && c.authorizedWeeklyHours > 0)
    .sort((a, b) => a.coverage - b.coverage);

  const allClients = [...clients].sort((a, b) => a.coverage - b.coverage);

  const underUtilized = providers.filter((p) => p.utilization < 0.70);

  return (
    <div>
      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground">Under-served clients</p>
          <p className="text-2xl font-bold text-amber-600 mt-1">{underServed.length}</p>
          <p className="text-xs text-muted-foreground mt-0.5">below 70% of auth'd hours</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground">Underutilized providers</p>
          <p className="text-2xl font-bold text-amber-600 mt-1">{underUtilized.length}</p>
          <p className="text-xs text-muted-foreground mt-0.5">below 70% utilization</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground">Unclaimed hours</p>
          <p className="text-2xl font-bold text-foreground mt-1">
            {fmtHours(providers.reduce((sum, p) => sum + Math.max(0, p.availableHoursPerWeek - p.scheduledHoursThisWeek), 0))}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">across all providers · {weekLabel}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-border">
        {(["clients", "providers"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "clients" ? `Clients (${allClients.length})` : `Providers (${providers.length})`}
          </button>
        ))}
      </div>

      {tab === "clients" && (
        <div>
          {underServed.length > 0 && (
            <div className="mb-6">
              <h3 className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-3">
                Under-served — below 70%
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {underServed.map((c) => (
                  <ClientCoverageCard key={c.id} client={c} />
                ))}
              </div>
            </div>
          )}

          {allClients.filter((c) => c.coverage >= 0.70).length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Adequately covered — 70%+
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {allClients
                  .filter((c) => c.coverage >= 0.70)
                  .map((c) => (
                    <ClientCoverageCard key={c.id} client={c} />
                  ))}
              </div>
            </div>
          )}

          {allClients.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-12">
              No HOME or HYBRID clients found.
            </p>
          )}
        </div>
      )}

      {tab === "providers" && (
        <ProviderUtilizationPanel providers={providers} />
      )}
    </div>
  );
}
