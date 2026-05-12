"use client";

import { useEffect, useRef, useState } from "react";
import { ProfileSheet } from "./ProfileSheet";

// Centralized color tokens for inline styles — hex values live here only
const WEEK_GRID_COLORS = {
  cancelledBorder: "rgba(15,15,12,0.20)", // neutral, matches new token system
};

interface WeekEvent {
  id: string;
  proposalId?: string;
  start: string;
  end: string;
  clientId: string | null;
  clientName: string | null;
  providerId: string;
  providerName: string;
  sessionTypeId: string;
  sessionTypeName: string;
  color: string;
  type: "session" | "proposal";
  status: string;
  cancelledBy: string | null;
  locationType: string;
}

export interface WeekGridEntity {
  id: string;
  type: "client" | "provider";
  firstName: string;
  lastName: string;
  position?: string;
}

interface WeekGridProps {
  weekDates: Date[];           // Mon–Fri noon UTC
  entities: WeekGridEntity[];
  timezone: string;
  centerId: string | null;
  refreshKey: number;
  onDayClick: (date: Date) => void;
  onSessionClick?: (ev: WeekEvent, entityType: "client" | "provider") => void;
  onProposalApproved?: () => void;
}

const DAY_ABBREVS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

function formatTime(isoStr: string, tz: string): string {
  const d = new Date(isoStr);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true,
  }).formatToParts(d);
  const h    = parts.find(p => p.type === "hour")?.value ?? "";
  const m    = parts.find(p => p.type === "minute")?.value ?? "00";
  const ampm = (parts.find(p => p.type === "dayPeriod")?.value ?? "")
    .replace(/\./g, "").toLowerCase();
  return m === "00" ? `${h}${ampm}` : `${h}:${m}${ampm}`;
}

export function WeekGrid({
  weekDates, entities, timezone, centerId, refreshKey, onDayClick, onSessionClick, onProposalApproved,
}: WeekGridProps) {
  const [events, setEvents] = useState<WeekEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [approveError, setApproveError] = useState<string | null>(null);
  // Section collapse state — mirrors the day view's clientsOpen/providersOpen.
  const [clientsOpen, setClientsOpen] = useState(true);
  const [providersOpen, setProvidersOpen] = useState(true);
  // Track the last week+center we fully loaded so re-fetches (refreshKey bumps)
  // don't flash the loading screen — only week/center navigation does.
  const loadedWeekRef = useRef<string | null>(null);

  async function handleApproveProposal(proposalId: string) {
    // Optimistic: remove the proposal immediately so the UI feels instant.
    setEvents(prev => prev.filter(ev => ev.proposalId !== proposalId));
    setApproveError(null);
    const { approveProposedSession } = await import("@/lib/actions/scheduler");
    const result = await approveProposedSession(proposalId);
    if (!result.success) {
      setApproveError(result.error);
      // Revert by triggering a real refresh.
      onProposalApproved?.();
    } else {
      // Silent background refresh to confirm true state.
      onProposalApproved?.();
    }
  }

  // Monday YYYY-MM-DD in center timezone — used as the API key
  const weekOf = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(weekDates[0]);
  const weekCenterKey = `${weekOf}|${centerId}`;

  useEffect(() => {
    if (!centerId) { setLoading(false); return; }
    // Only show the loading screen when navigating to a new week or center.
    // Proposal approvals bump refreshKey but keep the same week — stay silent.
    if (loadedWeekRef.current !== weekCenterKey) {
      setLoading(true);
    }
    const params = new URLSearchParams({ weekOf, centerId, _k: String(refreshKey) });
    fetch(`/api/schedule/sessions/week?${params}`)
      .then(r => r.json())
      .then(data => {
        setEvents((data.events as WeekEvent[]) ?? []);
        setLoading(false);
        loadedWeekRef.current = weekCenterKey;
      })
      .catch(() => setLoading(false));
  }, [weekOf, centerId, refreshKey]);

  // YYYY-MM-DD strings for each column so we can bucket events
  const dayStrs = weekDates.map(d =>
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(d)
  );

  // Build lookup: entityId → (dateStr → events[])
  // Each event is indexed under BOTH the provider and the client so each party's row shows it.
  const byEntity = new Map<string, Map<string, WeekEvent[]>>();
  function addToMap(entityId: string, dateStr: string, ev: WeekEvent) {
    if (!byEntity.has(entityId)) byEntity.set(entityId, new Map());
    const dm = byEntity.get(entityId)!;
    if (!dm.has(dateStr)) dm.set(dateStr, []);
    dm.get(dateStr)!.push(ev);
  }

  for (const ev of events) {
    const evDate = new Intl.DateTimeFormat("en-CA", { timeZone: timezone })
      .format(new Date(ev.start));
    addToMap(ev.providerId, evDate, ev);
    if (ev.clientId) addToMap(ev.clientId, evDate, ev);
  }

  const providers = entities.filter(e => e.type === "provider");
  const clients   = entities.filter(e => e.type === "client");

  function renderCell(entityId: string, entityType: "client" | "provider", dateStr: string, onSessionClickInner?: (ev: WeekEvent, et: "client" | "provider") => void) {
    const evs = (byEntity.get(entityId)?.get(dateStr) ?? [])
      // In provider rows hide CLIENT-cancelled sessions (freed time) — matches day view behaviour.
      // In client rows hide PROVIDER-cancelled sessions for the same reason.
      .filter(ev => {
        if (ev.status !== "CANCELLED") return true;
        if (entityType === "provider" && ev.cancelledBy === "CLIENT") return false;
        if (entityType === "client"   && ev.cancelledBy === "PROVIDER") return false;
        return true;
      });

    if (evs.length === 0) {
      return <td key={dateStr} className="border-r align-top p-1" style={{ minWidth: 130, borderColor: "rgba(15,15,12,0.04)" }} />;
    }

    return (
      <td key={dateStr} className="border-r align-top p-1" style={{ minWidth: 130, borderColor: "rgba(15,15,12,0.04)" }}>
        <div className="flex flex-col gap-0.5">
          {evs.map(ev => {
            const isProposal  = ev.type === "proposal";
            const isCancelled = ev.status === "CANCELLED";
            const counterpart = entityType === "provider" ? ev.clientName : ev.providerName;
            const counterpartId = entityType === "provider" ? ev.clientId : ev.providerId;
            const timeRange   = `${formatTime(ev.start, timezone)}–${formatTime(ev.end, timezone)}`;

            const isClickable = (isCancelled && !!onSessionClickInner) || (isProposal && !!ev.proposalId);

            return (
              <div
                key={ev.id}
                title={`${counterpart ?? ev.sessionTypeName} · ${timeRange}${isProposal ? " (proposed — click to accept)" : ""}${isCancelled ? " (cancelled — click to restore)" : ""}`}
                onClick={
                  isProposal && ev.proposalId ? () => handleApproveProposal(ev.proposalId!) :
                  isCancelled && onSessionClickInner ? () => onSessionClickInner(ev, entityType) :
                  undefined
                }
                className={`rounded px-1.5 py-0.5 text-[10px] leading-none flex items-center gap-1 overflow-hidden${isClickable ? " cursor-pointer hover:opacity-80" : ""}`}
                style={{
                  background: isCancelled
                    ? "transparent"
                    : ev.color + (isProposal ? "28" : "22"),
                  border: isCancelled
                    ? `1px dashed ${WEEK_GRID_COLORS.cancelledBorder}`
                    : isProposal
                    ? `1px dashed ${ev.color}`
                    : `1px solid ${ev.color}44`,
                  opacity: isCancelled ? 0.6 : 1,
                }}
              >
                <span className="font-medium truncate shrink min-w-0">
                  {counterpart && counterpartId ? (
                    <ProfileSheet
                      entityId={counterpartId}
                      entityType={entityType === "provider" ? "client" : "provider"}
                    >
                      {counterpart}
                    </ProfileSheet>
                  ) : (counterpart ?? ev.sessionTypeName)}
                </span>
                <span className="text-muted-foreground whitespace-nowrap shrink-0">{timeRange}</span>
              </div>
            );
          })}
        </div>
      </td>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        Loading week…
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto flex flex-col">
      {approveError && (
        <div className="px-4 py-2 text-xs text-destructive bg-destructive/10 border-b border-destructive/20 shrink-0 flex items-center justify-between">
          <span>{approveError}</span>
          <button onClick={() => setApproveError(null)} className="ml-3 font-medium hover:underline">Dismiss</button>
        </div>
      )}
      <div className="flex-1 overflow-auto">
      <table className="border-collapse text-xs" style={{ width: "100%", minWidth: 1040, tableLayout: "fixed" }}>

        {/* ── Sticky header ── */}
        <thead className="sticky top-0 z-10 bg-background">
          <tr className="border-b border-border">
            <th
              className="text-left px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wide border-r border-border sticky left-0 bg-background"
              style={{ width: 160, minWidth: 160 }}
            >
              Name
            </th>
            {weekDates.map((d, i) => {
              const dateLabel = new Intl.DateTimeFormat("en-US", {
                timeZone: timezone, month: "numeric", day: "numeric",
              }).format(d);
              return (
                <th
                  key={i}
                  onClick={() => onDayClick(d)}
                  className="px-2 py-1.5 border-r border-border cursor-pointer hover:bg-muted/60 transition-colors text-center"
                  style={{ minWidth: 130 }}
                >
                  <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                    {DAY_ABBREVS[i]}
                  </div>
                  <div className="text-[11px] font-semibold text-foreground">{dateLabel}</div>
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {/* ── Clients section header — mirrors ResourceTimeline.renderSection */}
          <tr
            onClick={() => setClientsOpen((o) => !o)}
            className="cursor-pointer select-none"
            style={{
              background: "var(--ata-gray-100)",
              borderTop: "1px solid rgba(15,15,12,0.08)",
              borderBottom: "1px solid rgba(15,15,12,0.08)",
            }}
          >
            <td
              colSpan={6}
              style={{
                padding: "0 16px",
                height: 28,
                position: "sticky",
                left: 0,
                background: "var(--ata-gray-100)",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <svg
                  width="9" height="9" viewBox="0 0 24 24" fill="currentColor"
                  style={{ color: "var(--ata-gray-500)", flexShrink: 0, transform: clientsOpen ? "none" : "rotate(-90deg)", transition: "transform 0.15s" }}
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
                <span style={{ fontSize: 11, fontWeight: 500, color: "var(--ata-gray-900)" }}>
                  Clients
                </span>
                <span style={{ fontSize: 11, color: "var(--ata-gray-400)", fontVariantNumeric: "tabular-nums" }}>
                  {clients.length}
                </span>
              </span>
            </td>
          </tr>
          {clientsOpen && clients.map((entity, i) => (
            <tr key={entity.id} className="border-b hover:bg-muted/10 transition-colors" style={{ borderColor: "rgba(15,15,12,0.04)", background: i % 2 === 1 ? "rgba(15,15,12,0.025)" : "transparent" }}>
              <td
                className="px-3 pt-1.5 pb-2 font-medium text-[11px] sticky left-0 border-r border-border whitespace-nowrap align-middle"
                style={{ minWidth: 160, background: i % 2 === 1 ? "var(--ata-gray-50)" : "var(--background)" }}
              >
                <ProfileSheet entityId={entity.id} entityType="client">
                  {entity.lastName}, {entity.firstName}
                </ProfileSheet>
              </td>
              {dayStrs.map(dateStr => renderCell(entity.id, "client", dateStr, onSessionClick))}
            </tr>
          ))}

          {/* ── Providers section header */}
          <tr
            onClick={() => setProvidersOpen((o) => !o)}
            className="cursor-pointer select-none"
            style={{
              background: "var(--ata-gray-100)",
              borderTop: "1px solid rgba(15,15,12,0.08)",
              borderBottom: "1px solid rgba(15,15,12,0.08)",
            }}
          >
            <td
              colSpan={6}
              style={{
                padding: "0 16px",
                height: 28,
                position: "sticky",
                left: 0,
                background: "var(--ata-gray-100)",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <svg
                  width="9" height="9" viewBox="0 0 24 24" fill="currentColor"
                  style={{ color: "var(--ata-gray-500)", flexShrink: 0, transform: providersOpen ? "none" : "rotate(-90deg)", transition: "transform 0.15s" }}
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
                <span style={{ fontSize: 11, fontWeight: 500, color: "var(--ata-gray-900)" }}>
                  Providers
                </span>
                <span style={{ fontSize: 11, color: "var(--ata-gray-400)", fontVariantNumeric: "tabular-nums" }}>
                  {providers.length}
                </span>
              </span>
            </td>
          </tr>
          {providersOpen && providers.map((entity, i) => (
            <tr key={entity.id} className="border-b hover:bg-muted/10 transition-colors" style={{ borderColor: "rgba(15,15,12,0.04)", background: i % 2 === 1 ? "rgba(15,15,12,0.025)" : "transparent" }}>
              <td
                className="px-3 pt-1.5 pb-2 font-medium text-[11px] sticky left-0 border-r border-border whitespace-nowrap align-middle"
                style={{ minWidth: 160, background: i % 2 === 1 ? "var(--ata-gray-50)" : "var(--background)" }}
              >
                <ProfileSheet entityId={entity.id} entityType="provider">
                  <span className="truncate leading-none">
                    {entity.lastName}, {entity.firstName}
                    {entity.position && (
                      <span className="font-normal text-[8px] text-muted-foreground ml-1">{entity.position}</span>
                    )}
                  </span>
                </ProfileSheet>
              </td>
              {dayStrs.map(dateStr => renderCell(entity.id, "provider", dateStr, onSessionClick))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
