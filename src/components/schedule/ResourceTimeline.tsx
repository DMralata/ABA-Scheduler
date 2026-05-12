"use client";

import { useRef, useState, useEffect, useCallback } from "react";
// getSessionTypeColor intentionally not imported here — session blocks use
// accentColor from the API response (OKLCH-based, name-keyed).
import { ProfileSheet } from "./ProfileSheet";
import type { SessionDraft } from "./SessionModal";
import { removeBlock } from "@/lib/actions/cancellations";

// ── Color constants — all hex/rgba values live here only ─────────────────────
const TIMELINE_COLORS = {
  // Block unavailability overlay (light red stripes)
  unavailableBg:       "rgba(196,50,26,0.06)",
  unavailableStripe:   "rgba(196,50,26,0.10)",
  // Cancelled sessions — diagonal danger-soft stripes
  cancelledBg:         "repeating-linear-gradient(135deg, #fdecea 0px 5px, #f7d8d4 5px 10px)",
  cancelledBorder:     "rgba(196,50,26,0.33)",
  cancelledText:       "#c4321a",
  // Free block (counterparty of a cancellation)
  cancelledTextFree:   "rgba(15,15,12,0.35)",
  cancelledBorderFree: "rgba(15,15,12,0.18)",
  // Normal confirmed sessions
  sessionBg:           "#ffffff",
  sessionBorder:       "var(--ata-gray-200)",
  sessionShadow:       "0 1px 2px rgba(15,15,12,0.04)",
  // Proposed sessions
  proposedBorder:      "#2563eb",
  proposedText:        "#2563eb",
};

// ── Constants ───────────────────────────────────────────────────────────────
const HOUR_START = 8;             // 8 am
const HOUR_END = 20;              // 8 pm
const HOURS = HOUR_END - HOUR_START;  // 12 hours
const HOUR_PX = 100;              // px per hour — 15-min snap = 25 px
const SNAP_MIN = 15;
const SNAP_PX = (SNAP_MIN / 60) * HOUR_PX; // 25 px at HOUR_PX=100
const ROW_H = 24;
const LABEL_W = 160;
const TOTAL_W = HOURS * HOUR_PX; // 720 px

// ── Time helpers ────────────────────────────────────────────────────────────
function getLocalHM(d: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const h = parseInt(parts.find(p => p.type === "hour")?.value ?? "0");
  const m = parseInt(parts.find(p => p.type === "minute")?.value ?? "0");
  return { h: h === 24 ? 0 : h, m };
}

function timeToX(d: Date, tz: string) {
  const { h, m } = getLocalHM(d, tz);
  return ((h - HOUR_START) * 60 + m) / 60 * HOUR_PX;
}

function xToDate(x: number, day: Date, tz: string): Date {
  const totalMin = HOUR_START * 60 + Math.round(Math.max(0, Math.min(x, TOTAL_W)) / SNAP_PX) * SNAP_MIN;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;

  const dateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(day);

  // Probe noon UTC to find the UTC offset for this timezone on this date.
  // Include minute component to handle sub-hour offsets (e.g. India +5:30).
  const probe = new Date(`${dateStr}T12:00:00Z`);
  const probeParts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(probe);
  const probeH = parseInt(probeParts.find(p => p.type === "hour")?.value ?? "12");
  const probeM = parseInt(probeParts.find(p => p.type === "minute")?.value ?? "0");

  // Local midnight UTC = noon UTC shifted by the local offset.
  // UTC time = local midnight UTC + h hours + m minutes.
  const [yr, mo, dy] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(yr, mo - 1, dy, 12 - (probeH === 24 ? 0 : probeH) + h, m - probeM));
}

function dayOfWeekName(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" })
    .format(d)
    .toUpperCase();
}

function formatTimeRange(start: Date, end: Date, tz: string): string {
  const fmt = (d: Date) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true,
    }).formatToParts(d);
    const h = parts.find(p => p.type === "hour")?.value ?? "";
    const m = parts.find(p => p.type === "minute")?.value ?? "00";
    const ampm = (parts.find(p => p.type === "dayPeriod")?.value ?? "").toLowerCase();
    return m === "00" ? `${h}${ampm}` : `${h}:${m}${ampm}`;
  };
  return `${fmt(start)}–${fmt(end)}`;
}

// ── Types ────────────────────────────────────────────────────────────────────
interface FetchedEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  backgroundColor: string;
  borderColor?: string;
  extendedProps: {
    type: "session" | "proposal" | "drive" | "block";
    sessionTypeName: string;
    clientId: string | null;
    providerId: string | null;
    blockParty?: "CLIENT" | "PROVIDER";
    proposalId?: string;
    locationType?: "HOME" | "CENTER" | "SCHOOL" | "DAYCARE";
    clientAddress?: string | null;
    status?: string;
    cancelledBy?: "CLIENT" | "PROVIDER" | null;
    driveMinutes?: number;
    notes?: string | null;
    providerName?: string;
  };
}

interface AvailWindow { dayOfWeek: string; startTime: string; endTime: string }

export interface TimelineEntity {
  id: string;
  type: "client" | "provider";
  firstName: string;
  lastName: string;
  position?: string;
  availability: AvailWindow[];
}

interface DragState {
  entityId: string;
  entityType: "client" | "provider";
  startX: number;
  currentX: number;
  rowLeft: number;
  sessionTypeId?: string;
}

interface MoveDragState {
  sessionId: string;
  entityId: string;
  origStartX: number;
  origWidth: number;
  clickOffsetX: number;
  currentLeft: number;
  rowLeft: number;
  backgroundColor: string;
}

interface ResizeDragState {
  sessionId: string;
  entityId: string;
  edge: "left" | "right";
  fixedX: number;   // the edge that doesn't move
  origX: number;    // starting position of the dragged edge
  currentX: number; // current snapped position of the dragged edge
  rowLeft: number;
  backgroundColor: string;
}

interface ResourceTimelineProps {
  entities: TimelineEntity[];
  currentDate: Date;
  timezone: string;
  centerId?: string;
  activeSessionTypeId?: string;
  onDraftCreate: (draft: SessionDraft) => void;
  onProposalApproved?: () => void;
  onSessionClick?: (ev: FetchedEvent, entityType: "client" | "provider") => void;
  onDriveTimeClick?: (ev: FetchedEvent) => void;
  refreshKey: number;
}

// ── Lane assignment ──────────────────────────────────────────────────────────
// When multiple events for the same entity overlap in time, assign each to a
// numbered vertical "lane" within the row (like Google Calendar). Lane 0 = top.
// Block-type events span the full row height and are excluded from lane math.

interface LaneResult { lane: number; numLanes: number }

function assignLanes(events: FetchedEvent[]): Map<string, LaneResult> {
  const timed = events
    .filter(ev => ev.extendedProps.type !== "block")
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  const laneEnds: number[] = [];   // laneEnds[i] = UTC ms of last event's end in lane i
  const rawLane = new Map<string, number>();

  for (const ev of timed) {
    const start = new Date(ev.start).getTime();
    const end   = new Date(ev.end).getTime();
    let lane = laneEnds.findIndex(endMs => endMs <= start);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(end); }
    else              { laneEnds[lane] = end; }
    rawLane.set(ev.id, lane);
  }

  const numLanes = Math.max(1, laneEnds.length);
  const result = new Map<string, LaneResult>();
  for (const [id, lane] of rawLane) result.set(id, { lane, numLanes });
  return result;
}

// ── Location icon ────────────────────────────────────────────────────────────
function LocationIcon({ type }: { type: "HOME" | "CENTER" | "SCHOOL" | "DAYCARE" }) {
  if (type === "HOME") {
    return (
      <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 shrink-0 opacity-90" fill="currentColor">
        <path d="M6 1L1 5v6h3.5V8h3v3H11V5L6 1z" />
      </svg>
    );
  }
  if (type === "SCHOOL") {
    // Backpack-ish icon to differentiate school from clinic
    return (
      <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 shrink-0 opacity-90" fill="currentColor">
        <path d="M3 3h6v1H3z" />
        <rect x="2" y="4" width="8" height="7" rx="1" />
        <rect x="4.5" y="6" width="3" height="2" fill="white" />
      </svg>
    );
  }
  if (type === "DAYCARE") {
    return (
      <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 shrink-0 opacity-90" fill="currentColor">
        <path d="M2 10V5l4-3 4 3v5z" />
        <circle cx="6" cy="7" r="1" fill="white" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 shrink-0 opacity-90" fill="currentColor">
      <rect x="1" y="4.5" width="10" height="7" rx="0.5" />
      <path d="M0 4.5L6 1l6 3.5" />
      <rect x="4" y="7" width="4" height="4.5" />
    </svg>
  );
}

// ── Drive block ──────────────────────────────────────────────────────────────
function DriveBlock({ ev, tz, topPx, heightPx, onDriveTimeClick }: { ev: FetchedEvent; tz: string; topPx: number; heightPx: number; onDriveTimeClick?: () => void }) {
  const start = new Date(ev.start);
  const end = new Date(ev.end);
  const left = Math.max(0, timeToX(start, tz));
  const right = Math.min(TOTAL_W, timeToX(end, tz));
  const width = Math.max(4, right - left);
  const driveMins = ev.extendedProps.driveMinutes ?? 0;
  const totalMins = Math.round((end.getTime() - start.getTime()) / 60_000);
  const bufferMins = Math.max(0, totalMins - driveMins);

  // Width of the actual drive portion vs. the parking/setup buffer
  const driveWidth = totalMins > 0 ? Math.round((driveMins / totalMins) * width) : width;
  const bufferWidth = width - driveWidth;

  const tooltip = bufferMins > 0
    ? `Drive · ${driveMins} min\nMisc. Setup and Parking Allocation · ${bufferMins} min`
    : `Drive · ${driveMins} min`;

  return (
    <div
      title={tooltip}
      onClick={onDriveTimeClick}
      className="absolute rounded overflow-hidden flex border border-dashed border-stone-300"
      style={{ left, width, top: topPx, height: heightPx, zIndex: 2, cursor: onDriveTimeClick ? "pointer" : "default" }}
    >
      {/* Drive portion */}
      <div
        className="flex items-center justify-center gap-0.5 text-stone-500 text-[8px] font-medium overflow-hidden shrink-0 bg-stone-100"
        style={{ width: driveWidth }}
      >
        <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 shrink-0" fill="currentColor">
          <path d="M9.5 4.5l-.9-2.7A.5.5 0 008.1 1.5H3.9a.5.5 0 00-.5.3L2.5 4.5H1.5A.5.5 0 001 5v3a.5.5 0 00.5.5H2v.5a.5.5 0 001 0V8.5h6v.5a.5.5 0 001 0V8.5h.5A.5.5 0 0011 8V5a.5.5 0 00-.5-.5H9.5zM4 6.5a.75.75 0 110-1.5.75.75 0 010 1.5zm4 0a.75.75 0 110-1.5.75.75 0 010 1.5zM3 4.5l.7-2h4.6l.7 2H3z"/>
        </svg>
        {driveWidth > 32 && <span className="truncate leading-none">{driveMins}m</span>}
      </div>
      {/* Misc. Setup and Parking Allocation buffer */}
      {bufferWidth > 0 && (
        <div
          className="flex items-center justify-center text-stone-400 text-[8px] font-medium overflow-hidden shrink-0 border-l border-dashed border-stone-200 bg-stone-50"
          style={{ width: bufferWidth }}
        >
          {bufferWidth > 28 && <span className="truncate leading-none px-0.5">P</span>}
        </div>
      )}
    </div>
  );
}

// ── Block overlay (rest-of-day block) ────────────────────────────────────────
function BlockOverlay({ ev, tz, onContextMenu }: { ev: FetchedEvent; tz: string; onContextMenu: (e: React.MouseEvent, ev: FetchedEvent) => void }) {
  const start = new Date(ev.start);
  const end = new Date(ev.end);
  const left = Math.max(0, timeToX(start, tz));
  const right = Math.min(TOTAL_W, timeToX(end, tz));
  const width = Math.max(4, right - left);
  const party = ev.extendedProps.blockParty === "CLIENT" ? "client" : "provider";

  return (
    <div
      className="absolute top-0 bottom-0 cursor-context-menu"
      title={`${party === "client" ? "Client" : "Provider"} unavailable — right-click to remove`}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(e, ev); }}
      style={{
        left,
        width,
        backgroundColor: TIMELINE_COLORS.unavailableBg,
        backgroundImage: `repeating-linear-gradient(-45deg, ${TIMELINE_COLORS.unavailableStripe} 0px, ${TIMELINE_COLORS.unavailableStripe} 3px, transparent 3px, transparent 12px)`,
        zIndex: 1,
      }}
    />
  );
}

// ── Session block ────────────────────────────────────────────────────────────
function SessionBlock({ ev, tz, entityId, topPx, heightPx, onApprove, onCancel, onDriveTimeClick, isGhost }: { ev: FetchedEvent; tz: string; entityId: string; topPx: number; heightPx: number; onApprove?: () => void; onCancel?: () => void; onDriveTimeClick?: () => void; isGhost?: boolean }) {
  const start = new Date(ev.start);
  const end = new Date(ev.end);
  const left = Math.max(0, timeToX(start, tz));
  const right = Math.min(TOTAL_W, timeToX(end, tz));
  const width = Math.max(6, right - left);
  const isProposal = ev.extendedProps.type === "proposal";
  const isCancelled = ev.extendedProps.status === "CANCELLED";
  const cancelledBy = ev.extendedProps.cancelledBy ?? null;
  const locationType = ev.extendedProps.locationType ?? "CENTER";
  const clientAddress = ev.extendedProps.clientAddress;
  const sessionTypeName = ev.extendedProps.sessionTypeName;

  // Determine whether this row belongs to the party that cancelled or the counterparty.
  // When cancelledBy is known: cancelling party sees dark red stripes; counterparty sees a free block.
  // When cancelledBy is unknown: both parties see dark red stripes (conservative).
  const isCancellingParty = isCancelled && cancelledBy !== null && (
    (cancelledBy === "CLIENT" && entityId === ev.extendedProps.clientId) ||
    (cancelledBy === "PROVIDER" && entityId === ev.extendedProps.providerId)
  );
  const isCounterparty = isCancelled && cancelledBy !== null && !isCancellingParty;

  const locationLabel = locationType === "HOME"
    ? clientAddress ? `Home · ${clientAddress}` : "Client Home"
    : locationType === "SCHOOL"
      ? "School"
      : "Center";
  const tooltipText = [
    `${ev.title} · ${sessionTypeName}`,
    locationLabel,
    isCancellingParty ? `(cancelled by ${cancelledBy === "CLIENT" ? "client" : "provider"})` : null,
    isCounterparty ? `(free — cancelled by ${cancelledBy === "CLIENT" ? "client" : "provider"})` : null,
    isProposal ? "(proposed — click to approve)" : null,
  ].filter(Boolean).join("\n");

  const accentColor = (ev.extendedProps as { accentColor?: string }).accentColor ?? ev.backgroundColor;

  // Free block: counterparty's slot opened up — clickable so the original session can be restored
  if (isCounterparty) {
    return (
      <div
        data-session-block="true"
        title={onCancel ? `${tooltipText}\n(click to restore)` : tooltipText}
        onClick={onCancel}
        className={`absolute rounded px-1 flex items-center gap-0.5 overflow-hidden text-[9px] font-semibold ${onCancel ? "cursor-pointer" : "cursor-default"}`}
        style={{
          left, width, top: topPx, height: heightPx, zIndex: 2,
          border: `1px dashed ${TIMELINE_COLORS.cancelledBorderFree}`,
          backgroundColor: "transparent",
          color: TIMELINE_COLORS.cancelledTextFree,
        }}
      >
        {width >= 32 && (
          <span className="truncate leading-none">Free</span>
        )}
      </div>
    );
  }

  const clickHandler = isCancelled
    ? (onCancel ?? undefined)
    : isProposal
    ? (onApprove ?? undefined)
    : (onDriveTimeClick ?? onCancel ?? undefined);

  // Moveable: non-cancelled, non-proposal, non-drive-time sessions
  const isMoveable = !isCancelled && !isProposal && sessionTypeName !== "Drive Time";

  // Label: show name · sessionType · timeRange; scale down gracefully
  const timeRange = formatTimeRange(start, end, tz);
  const fullLabel = `${ev.title} · ${sessionTypeName} · ${timeRange}`;
  const shortLabel = ev.title;

  // ── Per-status styles ──────────────────────────────────────────────────────
  let blockBg: string;
  let blockBorder: string;
  let blockBorderLeft: string | undefined;
  let blockShadow: string | undefined;
  let blockColor: string;
  let blockOpacity: string | undefined;

  if (isCancelled) {
    blockBg = TIMELINE_COLORS.cancelledBg;
    blockBorder = `1px solid ${TIMELINE_COLORS.cancelledBorder}`;
    blockBorderLeft = undefined;
    blockShadow = undefined;
    blockColor = TIMELINE_COLORS.cancelledText;
  } else if (isProposal) {
    blockBg = TIMELINE_COLORS.sessionBg;
    blockBorder = `1px dashed ${TIMELINE_COLORS.proposedBorder}`;
    blockBorderLeft = undefined;
    blockShadow = undefined;
    blockColor = TIMELINE_COLORS.proposedText;
    blockOpacity = "0.85";
  } else {
    blockBg = TIMELINE_COLORS.sessionBg;
    blockBorder = `1px solid ${TIMELINE_COLORS.sessionBorder}`;
    blockBorderLeft = `2px solid ${accentColor}`;
    blockShadow = TIMELINE_COLORS.sessionShadow;
    blockColor = "var(--ata-gray-900)";
  }

  return (
    <div
      data-session-block="true"
      data-session-moveable={isMoveable ? "true" : undefined}
      data-session-id={isMoveable ? ev.id : undefined}
      data-session-start-x={isMoveable ? String(left) : undefined}
      data-session-width={isMoveable ? String(width) : undefined}
      data-session-color={isMoveable ? accentColor : undefined}
      title={tooltipText}
      onClick={clickHandler}
      className={`absolute px-1 flex items-center gap-0.5 overflow-hidden text-[9px] font-semibold transition-opacity ${
        isGhost
          ? "opacity-30 pointer-events-none"
          : isCancelled
          ? "cursor-pointer hover:opacity-80"
          : isProposal
          ? "cursor-pointer hover:opacity-100"
          : isMoveable
          ? "cursor-grab active:cursor-grabbing hover:opacity-80"
          : "cursor-pointer hover:opacity-80"
      }`}
      style={{
        left,
        width,
        top: topPx,
        height: heightPx,
        borderRadius: 6,
        background: blockBg,
        border: blockBorder,
        borderLeft: blockBorderLeft ?? blockBorder,
        boxShadow: blockShadow,
        color: blockColor,
        opacity: blockOpacity,
        zIndex: 2,
      }}
    >
      {/* Resize handles — left and right edges for moveable sessions */}
      {isMoveable && (
        <>
          <div
            data-resize-handle="left"
            data-session-id={ev.id}
            data-fixed-x={String(left + width)}
            data-orig-x={String(left)}
            data-session-color={accentColor}
            className="absolute left-0 top-0 bottom-0 w-[7px] cursor-w-resize z-10 rounded-l hover:bg-black/5 transition-colors"
          />
          <div
            data-resize-handle="right"
            data-session-id={ev.id}
            data-fixed-x={String(left)}
            data-orig-x={String(left + width)}
            data-session-color={accentColor}
            className="absolute right-0 top-0 bottom-0 w-[7px] cursor-e-resize z-10 rounded-r hover:bg-black/5 transition-colors"
          />
        </>
      )}
      {!isCancelled && <LocationIcon type={locationType} />}
      {width < 48 ? null : (
        <span
          className="truncate leading-none"
          style={{ textDecoration: isCancelled ? "line-through" : undefined }}
        >
          {width >= 130 ? fullLabel : shortLabel}
        </span>
      )}
      {/* Time label — right-aligned, monospaced, tabular nums */}
      {width >= 100 && !isCancelled && (
        <span style={{
          marginLeft: "auto", fontFamily: "Geist Mono, monospace",
          fontSize: 9, color: "var(--ata-gray-500)",
          fontVariantNumeric: "tabular-nums", flexShrink: 0,
        }}>
          {timeRange}
        </span>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export function ResourceTimeline({ entities, currentDate, timezone, centerId, activeSessionTypeId, onDraftCreate, onProposalApproved, onSessionClick, onDriveTimeClick, refreshKey }: ResourceTimelineProps) {
  const [events, setEvents] = useState<FetchedEvent[]>([]);
  const [dragSel, setDragSel] = useState<{ entityId: string; left: number; width: number } | null>(null);
  const [dragAnnotation, setDragAnnotation] = useState<{ x: number; y: number; label: string } | null>(null);
  const [moveDragSel, setMoveDragSel] = useState<{ entityId: string; sessionId: string; left: number; width: number; backgroundColor: string } | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<boolean>(false);
  const [clientsOpen, setClientsOpen] = useState(true);
  const [providersOpen, setProvidersOpen] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const dragRef = useRef<DragState | null>(null);
  const moveDragRef = useRef<MoveDragState | null>(null);
  const resizeDragRef = useRef<ResizeDragState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [blockMenu, setBlockMenu] = useState<{ x: number; y: number; ev: FetchedEvent } | null>(null);
  const [blockMenuLoading, setBlockMenuLoading] = useState(false);

  const handleBlockContextMenu = useCallback((e: React.MouseEvent, ev: FetchedEvent) => {
    setBlockMenu({ x: e.clientX, y: e.clientY, ev });
  }, []);

  function doRemoveBlock(restoreSessions: boolean) {
    if (!blockMenu) return;
    const ev = blockMenu.ev;
    // ev.id is "provider-block-{dbId}" or "client-block-{dbId}"
    const rawId = ev.id.replace(/^(provider|client)-block-/, "");
    const party = ev.extendedProps.blockParty ?? "PROVIDER";
    setBlockMenuLoading(true);
    removeBlock(rawId, party, restoreSessions).then((result) => {
      setBlockMenuLoading(false);
      setBlockMenu(null);
      if (result.success) {
        // Trigger re-fetch by notifying parent via onProposalApproved (reuses the refresh path)
        onProposalApproved?.();
      }
    }).catch(() => {
      setBlockMenuLoading(false);
      setBlockMenu(null);
    });
  }

  // Keep the current-time indicator accurate — tick every 30 seconds
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Fetch sessions for current date.
  // Use the center's timezone to compute midnight boundaries — setHours() operates in
  // the browser's local timezone, which drifts for centers not matching the browser TZ.
  useEffect(() => {
    setFetchError(false);

    // Get the calendar date string in the center's timezone
    const dateStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(currentDate);

    // Find UTC offset at noon UTC of that date to compute local midnight in UTC
    const noonUTC = new Date(`${dateStr}T12:00:00Z`);
    const noonParts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(noonUTC);
    const nh = parseInt(noonParts.find(p => p.type === "hour")?.value ?? "12");
    const nm = parseInt(noonParts.find(p => p.type === "minute")?.value ?? "0");
    const offsetMs = (nh === 24 ? 0 : nh) * 3_600_000 + nm * 60_000;
    const dayStart = new Date(noonUTC.getTime() - offsetMs);
    const dayEnd   = new Date(dayStart.getTime() + 24 * 3_600_000 - 1);

    fetch(`/api/schedule/sessions?start=${dayStart.toISOString()}&end=${dayEnd.toISOString()}${centerId ? `&centerId=${centerId}` : ""}&_k=${refreshKey}`)
      .then(r => r.json())
      .then(d => { setFetchError(false); setEvents(d.events ?? []); })
      .catch(() => { setFetchError(true); });
  }, [currentDate, timezone, refreshKey]);

  // Global mouse move/up for drag-to-select
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const scrollLeft = scrollRef.current?.scrollLeft ?? 0;

      // Resize-drag: stretch/shrink a session from one edge
      if (resizeDragRef.current) {
        const { rowLeft, edge, fixedX, entityId, sessionId, backgroundColor } = resizeDragRef.current;
        const x = Math.max(0, Math.min(e.clientX - rowLeft + scrollLeft, TOTAL_W));
        const snappedX = Math.round(x / SNAP_PX) * SNAP_PX;
        // Clamp so there's always at least one snap unit (15 min) of duration
        const clampedX = edge === "left"
          ? Math.min(snappedX, fixedX - SNAP_PX)
          : Math.max(snappedX, fixedX + SNAP_PX);
        resizeDragRef.current.currentX = clampedX;
        const left = Math.min(fixedX, clampedX);
        const width = Math.abs(clampedX - fixedX);
        setMoveDragSel({ entityId, sessionId, left, width, backgroundColor });
        const startDate = xToDate(left, currentDate, timezone);
        const endDate = xToDate(left + width, currentDate, timezone);
        setDragAnnotation({ x: e.clientX, y: e.clientY, label: formatTimeRange(startDate, endDate, timezone) });
        return;
      }

      // Move-drag: reposition an existing session block
      if (moveDragRef.current) {
        const { rowLeft, clickOffsetX, origWidth, entityId, sessionId, backgroundColor } = moveDragRef.current;
        const x = Math.max(0, Math.min(e.clientX - rowLeft + scrollLeft, TOTAL_W));
        const rawLeft = x - clickOffsetX;
        const snappedLeft = Math.max(0, Math.min(Math.round(rawLeft / SNAP_PX) * SNAP_PX, TOTAL_W - origWidth));
        moveDragRef.current.currentLeft = snappedLeft;
        setMoveDragSel({ entityId, sessionId, left: snappedLeft, width: origWidth, backgroundColor });
        const startDate = xToDate(snappedLeft, currentDate, timezone);
        const endDate = xToDate(snappedLeft + origWidth, currentDate, timezone);
        setDragAnnotation({ x: e.clientX, y: e.clientY, label: formatTimeRange(startDate, endDate, timezone) });
        return;
      }

      if (!dragRef.current) return;
      const { rowLeft, startX, entityId } = dragRef.current;
      const x = Math.max(0, Math.min(e.clientX - rowLeft + scrollLeft, TOTAL_W));
      dragRef.current.currentX = x;

      // Snap both endpoints to the 15-min grid so the preview matches the final result
      const snappedStart = Math.round(startX / SNAP_PX) * SNAP_PX;
      const snappedEnd = Math.round(x / SNAP_PX) * SNAP_PX;
      const snappedLeft = Math.min(snappedStart, snappedEnd);
      const snappedWidth = Math.abs(snappedEnd - snappedStart);
      setDragSel({ entityId, left: snappedLeft, width: snappedWidth });

      // Cursor annotation — show snapped time range next to the cursor
      if (snappedWidth >= SNAP_PX) {
        const startDate = xToDate(snappedLeft, currentDate, timezone);
        const endDate = xToDate(snappedLeft + snappedWidth, currentDate, timezone);
        setDragAnnotation({ x: e.clientX, y: e.clientY, label: formatTimeRange(startDate, endDate, timezone) });
      } else {
        setDragAnnotation(null);
      }
    }

    function onUp() {
      // Resize-drag: commit reschedule if the edge actually moved
      if (resizeDragRef.current) {
        const { sessionId, edge, fixedX, origX, currentX } = resizeDragRef.current;
        resizeDragRef.current = null;
        setMoveDragSel(null);
        setDragAnnotation(null);

        const didChange = Math.abs(currentX - origX) >= SNAP_PX / 2;
        if (didChange) {
          function suppressClick(ev: MouseEvent) {
            ev.stopPropagation();
            window.removeEventListener("click", suppressClick, { capture: true });
          }
          window.addEventListener("click", suppressClick, { capture: true });

          const left = Math.min(fixedX, currentX);
          const width = Math.abs(currentX - fixedX);
          const newStart = xToDate(left, currentDate, timezone);
          const newEnd = xToDate(left + width, currentDate, timezone);
          setMoveError(null);
          import("@/lib/actions/sessions").then(({ rescheduleSession }) => {
            rescheduleSession(sessionId, { startTime: newStart, endTime: newEnd })
              .then(result => {
                if (!result.success) setMoveError(result.error ?? "Failed to resize session.");
                else onProposalApproved?.();
              })
              .catch(() => setMoveError("Failed to resize session."));
          });
        }
        return;
      }

      // Move-drag: commit reschedule if the block actually moved
      if (moveDragRef.current) {
        const { sessionId, origStartX, currentLeft, origWidth } = moveDragRef.current;
        moveDragRef.current = null;
        setMoveDragSel(null);
        setDragAnnotation(null);

        const didMove = Math.abs(currentLeft - origStartX) >= SNAP_PX / 2;
        if (didMove) {
          // Suppress the click event that fires immediately after mouseup on the block
          function suppressClick(ev: MouseEvent) {
            ev.stopPropagation();
            window.removeEventListener("click", suppressClick, { capture: true });
          }
          window.addEventListener("click", suppressClick, { capture: true });

          const newStart = xToDate(currentLeft, currentDate, timezone);
          const newEnd = xToDate(currentLeft + origWidth, currentDate, timezone);
          setMoveError(null);
          import("@/lib/actions/sessions").then(({ rescheduleSession }) => {
            rescheduleSession(sessionId, { startTime: newStart, endTime: newEnd })
              .then(result => {
                if (!result.success) setMoveError(result.error ?? "Failed to move session.");
                else onProposalApproved?.();
              })
              .catch(() => setMoveError("Failed to move session."));
          });
        }
        return;
      }

      if (!dragRef.current) return;
      const { entityId, entityType, startX, currentX, sessionTypeId } = dragRef.current;
      dragRef.current = null;
      setDragSel(null);
      setDragAnnotation(null);

      const left = Math.min(startX, currentX);
      const right = Math.max(startX, currentX);
      if (right - left < SNAP_PX) return;

      const draft: SessionDraft = {
        start: xToDate(left, currentDate, timezone),
        end: xToDate(right, currentDate, timezone),
        sessionTypeId,
      };
      if (entityType === "client") draft.clientId = entityId;
      else draft.providerId = entityId;

      onDraftCreate(draft);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [currentDate, timezone, onDraftCreate, onProposalApproved]);

  function startDrag(e: React.MouseEvent, entity: TimelineEntity) {
    if (e.button !== 0) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const scrollLeft = scrollRef.current?.scrollLeft ?? 0;
    const x = Math.max(0, e.clientX - rect.left + scrollLeft);

    // If clicking on a resize handle, start a resize drag
    const resizeEl = (e.target as HTMLElement).closest("[data-resize-handle]") as HTMLElement | null;
    if (resizeEl) {
      const edge = resizeEl.getAttribute("data-resize-handle") as "left" | "right";
      const sessionId = resizeEl.getAttribute("data-session-id")!;
      const fixedX = parseFloat(resizeEl.getAttribute("data-fixed-x")!);
      const origX = parseFloat(resizeEl.getAttribute("data-orig-x")!);
      const backgroundColor = resizeEl.getAttribute("data-session-color")!;
      resizeDragRef.current = { sessionId, entityId: entity.id, edge, fixedX, origX, currentX: origX, rowLeft: rect.left, backgroundColor };
      return;
    }

    // If clicking on a moveable session block, start a move drag instead
    const moveTarget = (e.target as HTMLElement).closest("[data-session-moveable='true']") as HTMLElement | null;
    if (moveTarget) {
      const sessionId = moveTarget.getAttribute("data-session-id")!;
      const origStartX = parseFloat(moveTarget.getAttribute("data-session-start-x")!);
      const origWidth = parseFloat(moveTarget.getAttribute("data-session-width")!);
      const backgroundColor = moveTarget.getAttribute("data-session-color")!;
      const clickOffsetX = Math.max(0, Math.min(x - origStartX, origWidth));
      moveDragRef.current = { sessionId, entityId: entity.id, origStartX, origWidth, clickOffsetX, currentLeft: origStartX, rowLeft: rect.left, backgroundColor };
      return;
    }

    // Bail on other non-moveable session blocks (proposals, cancelled, drive)
    if ((e.target as HTMLElement).closest("[data-session-block]")) return;

    // Start a create-drag on empty timeline space
    dragRef.current = { entityId: entity.id, entityType: entity.type, startX: x, currentX: x, rowLeft: rect.left, sessionTypeId: activeSessionTypeId };
  }

  function onDrop(e: React.DragEvent, entity: TimelineEntity) {
    e.preventDefault();
    const sessionTypeId = e.dataTransfer.getData("sessionTypeId");
    if (!sessionTypeId) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const scrollLeft = scrollRef.current?.scrollLeft ?? 0;
    const x = Math.max(0, e.clientX - rect.left + scrollLeft);
    const draft: SessionDraft = {
      start: xToDate(x, currentDate, timezone),
      end: xToDate(x + HOUR_PX, currentDate, timezone),
      sessionTypeId,
    };
    if (entity.type === "client") draft.clientId = entity.id;
    else draft.providerId = entity.id;
    onDraftCreate(draft);
  }

  // Group events by entity.
  // Sessions and proposals appear on both client and provider rows.
  // Drive blocks are provider-only (the client isn't in the car).
  const byEntity = new Map<string, FetchedEvent[]>();
  for (const ev of events) {
    if (ev.extendedProps.type === "drive") {
      const pid = ev.extendedProps.providerId;
      if (!pid) continue;
      if (!byEntity.has(pid)) byEntity.set(pid, []);
      byEntity.get(pid)!.push(ev);
      continue;
    }
    if (ev.extendedProps.type === "block") {
      // Blocks appear only on the row of the blocked party
      const eid = ev.extendedProps.blockParty === "PROVIDER"
        ? ev.extendedProps.providerId
        : ev.extendedProps.clientId;
      if (!eid) continue;
      if (!byEntity.has(eid)) byEntity.set(eid, []);
      byEntity.get(eid)!.push(ev);
      continue;
    }
    for (const id of [ev.extendedProps.clientId, ev.extendedProps.providerId]) {
      if (!id) continue;
      if (!byEntity.has(id)) byEntity.set(id, []);
      byEntity.get(id)!.push(ev);
    }
  }

  async function handleApproveProposal(proposalId: string) {
    setApproveError(null);
    try {
      const { approveProposedSession } = await import("@/lib/actions/scheduler");
      const result = await approveProposedSession(proposalId);
      if (!result.success) {
        setApproveError(result.error);
      } else {
        onProposalApproved?.();
      }
    } catch {
      setApproveError("Failed to approve session. Please try again.");
    }
  }

  const today = dayOfWeekName(currentDate, timezone);
  const clients = entities.filter(e => e.type === "client");
  const providers = entities.filter(e => e.type === "provider");

  const hourLabels = Array.from({ length: HOURS + 1 }, (_, i) => {
    const h = HOUR_START + i;
    const label = h === 12 ? "12pm" : h > 12 ? `${h - 12}pm` : `${h}am`;
    return { label, x: i * HOUR_PX };
  });

  function renderSection(label: string, rows: TimelineEntity[], bgClass: string, open: boolean, onToggle: () => void) {
    if (rows.length === 0) return null;
    return (
      <>
        {/* Section header — clickable to collapse/expand */}
        <div
          className="flex cursor-pointer select-none"
          style={{
            minWidth: LABEL_W + TOTAL_W,
            background: "var(--ata-gray-100)",
            borderBottom: "1px solid rgba(15,15,12,0.08)",
            borderTop: "1px solid rgba(15,15,12,0.08)",
            height: 28,
          }}
          onClick={onToggle}
        >
          <div
            className="sticky left-0 flex items-center gap-2"
            style={{ width: LABEL_W, minWidth: LABEL_W, padding: "0 16px", background: "var(--ata-gray-100)", borderRight: "1px solid rgba(15,15,12,0.08)" }}
          >
            <svg
              width="9" height="9" viewBox="0 0 24 24" fill="currentColor"
              style={{ color: "var(--ata-gray-500)", flexShrink: 0, transform: open ? "none" : "rotate(-90deg)", transition: "transform 0.15s" }}
            >
              <path d="M6 9l6 6 6-6"/>
            </svg>
            <span style={{ fontSize: 11, fontWeight: 500, color: "var(--ata-gray-900)" }}>
              {label}
            </span>
            <span style={{ fontSize: 11, color: "var(--ata-gray-400)", fontVariantNumeric: "tabular-nums" }}>
              {rows.length}
            </span>
          </div>
          <div style={{ width: TOTAL_W }} />
        </div>

        {/* Entity rows — hidden when collapsed */}
        {open && rows.map((entity, entityIdx) => {
          const entityEvents = byEntity.get(entity.id) ?? [];
          const isDragging = dragSel?.entityId === entity.id;
          const rowBg = entityIdx % 2 === 1 ? "rgba(15,15,12,0.025)" : "transparent";

          // Availability windows for today
          const availWindows = entity.availability
            .filter(w => w.dayOfWeek === today)
            .map(w => {
              const [sh, sm] = w.startTime.split(":").map(Number);
              const [eh, em] = w.endTime.split(":").map(Number);
              const startX = Math.max(0, ((sh - HOUR_START) * 60 + sm) / 60 * HOUR_PX);
              const endX = Math.min(TOTAL_W, ((eh - HOUR_START) * 60 + em) / 60 * HOUR_PX);
              return { startX, width: endX - startX };
            })
            .filter(w => w.width > 0);

          // Assign lanes so overlapping events don't render on top of each other.
          // Non-overlapping events share lane 0; each additional simultaneous event
          // gets its own lane, expanding the row height by ROW_H per extra lane.
          const laneMap = assignLanes(entityEvents);
          const numLanes = laneMap.size > 0
            ? Math.max(...Array.from(laneMap.values()).map(l => l.numLanes))
            : 1;
          const rowHeight = numLanes * ROW_H;

          return (
            <div key={entity.id} className="flex border-b" style={{ height: rowHeight, borderColor: "rgba(15,15,12,0.04)", background: rowBg }}>
              {/* Label — sticky left */}
              <div
                className="shrink-0 flex flex-col justify-center pb-1 px-2 border-r border-border sticky left-0 z-10"
                style={{ width: LABEL_W, minWidth: LABEL_W, background: entityIdx % 2 === 1 ? "var(--ata-gray-50)" : "var(--background)" }}
              >
                <ProfileSheet entityId={entity.id} entityType={entity.type}>
                  <span className="text-[10px] font-medium truncate leading-none">
                    {entity.lastName}, {entity.firstName}
                    {entity.position && (
                      <span className="font-normal text-[8px] text-muted-foreground ml-1">{entity.position}</span>
                    )}
                  </span>
                </ProfileSheet>
              </div>

              {/* Timeline row — transparent so the parent's alternating row background
                  shows through behind the availability shading and event overlays. */}
              <div
                className="relative cursor-crosshair select-none"
                style={{ width: TOTAL_W, minWidth: TOTAL_W }}
                onMouseDown={e => startDrag(e, entity)}
                onDragOver={e => e.preventDefault()}
                onDrop={e => onDrop(e, entity)}
              >
                {/* Vertical hour lines */}
                {Array.from({ length: HOURS }, (_, i) => (
                  <div key={i} className="absolute top-0 bottom-0 border-l" style={{ left: i * HOUR_PX, borderColor: "rgba(15,15,12,0.04)" }} />
                ))}
                {/* Half-hour lines (lighter) */}
                {Array.from({ length: HOURS }, (_, i) => (
                  <div key={`h-${i}`} className="absolute top-0 bottom-0 border-l" style={{ left: i * HOUR_PX + HOUR_PX / 2, borderColor: "rgba(15,15,12,0.02)" }} />
                ))}

                {/* Availability shading */}
                {availWindows.map((w, i) => (
                  <div key={i} className="absolute top-0 bottom-0 bg-emerald-50 dark:bg-emerald-950/30" style={{ left: w.startX, width: w.width }} />
                ))}

                {/* Session / proposal / drive / block overlays */}
                {entityEvents.map(ev => {
                  const laneInfo = laneMap.get(ev.id) ?? { lane: 0, numLanes: 1 };
                  const laneTopPx    = laneInfo.lane * ROW_H + 1;
                  const laneHeightPx = ROW_H - 2;

                  if (ev.extendedProps.type === "block") {
                    return <BlockOverlay key={ev.id} ev={ev} tz={timezone} onContextMenu={handleBlockContextMenu} />;
                  }
                  if (ev.extendedProps.type === "drive") {
                    return <DriveBlock key={ev.id} ev={ev} tz={timezone} topPx={laneTopPx} heightPx={laneHeightPx} onDriveTimeClick={ev.extendedProps.notes ? () => onDriveTimeClick?.(ev) : undefined} />;
                  }
                  const isDriveTimeSession = ev.extendedProps.sessionTypeName === "Drive Time";
                  return (
                    <SessionBlock
                      key={ev.id}
                      ev={ev}
                      tz={timezone}
                      entityId={entity.id}
                      topPx={laneTopPx}
                      heightPx={laneHeightPx}
                      isGhost={moveDragSel?.sessionId === ev.id}
                      onApprove={ev.extendedProps.type === "proposal"
                        ? () => handleApproveProposal(ev.extendedProps.proposalId!)
                        : undefined}
                      onCancel={ev.extendedProps.type === "session" && !isDriveTimeSession
                        ? () => onSessionClick?.(ev, entity.type)
                        : undefined}
                      onDriveTimeClick={isDriveTimeSession
                        ? () => onDriveTimeClick?.(ev)
                        : undefined}
                    />
                  );
                })}

                {/* Move-drag preview — solid block at the snapped target position */}
                {moveDragSel?.entityId === entity.id && (
                  <div
                    className="absolute top-1 bottom-1 rounded pointer-events-none opacity-80 ring-2 ring-white/60"
                    style={{ left: moveDragSel.left, width: moveDragSel.width, backgroundColor: moveDragSel.backgroundColor, zIndex: 4 }}
                  />
                )}

                {/* Create-drag selection preview */}
                {isDragging && dragSel && dragSel.width > 4 && (
                  <div
                    className="absolute top-1 bottom-1 bg-primary/20 border border-primary/50 rounded pointer-events-none"
                    style={{ left: dragSel.left, width: dragSel.width, zIndex: 3 }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {moveError && (
        <div className="px-4 py-2 text-xs text-destructive bg-destructive/10 border-b border-destructive/20 shrink-0 flex items-center justify-between">
          <span>{moveError}</span>
          <button onClick={() => setMoveError(null)} className="ml-3 font-medium hover:underline">Dismiss</button>
        </div>
      )}
      {approveError && (
        <div className="px-4 py-2 text-xs text-destructive bg-destructive/10 border-b border-destructive/20 shrink-0 flex items-center justify-between">
          <span>{approveError}</span>
          <button onClick={() => setApproveError(null)} className="ml-3 font-medium hover:underline">Dismiss</button>
        </div>
      )}
      <div ref={scrollRef} className="flex-1 overflow-auto relative">
        {fetchError && (
          <div className="px-4 py-2 text-xs text-destructive bg-destructive/10 border-b border-destructive/20 shrink-0 flex items-center justify-between">
            <span>Failed to load sessions. Refresh to try again.</span>
            <button onClick={() => setFetchError(false)} className="ml-3 font-medium hover:underline">Dismiss</button>
          </div>
        )}
        {/* Time header */}
        <div className="flex sticky top-0 z-20 bg-background border-b border-border" style={{ height: 28 }}>
          <div className="sticky left-0 z-30 bg-background border-r border-border" style={{ width: LABEL_W, minWidth: LABEL_W }} />
          <div className="relative" style={{ width: TOTAL_W, minWidth: TOTAL_W }}>
            {hourLabels.map(({ label, x }) => (
              <span
                key={x}
                className="absolute top-0 bottom-0 flex items-center text-[9px] text-muted-foreground pl-1 border-l"
                style={{ left: x, fontFamily: "Geist Mono, monospace", fontVariantNumeric: "tabular-nums", borderColor: "rgba(15,15,12,0.04)" }}
              >
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* Current time indicator — updates every 30 s via the `now` state tick */}
        {(() => {
          // Position the bar using the user's local browser timezone so it reflects
          // "what time is it for me right now", not the center's remote timezone.
          const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
          const tzDate = (d: Date, tz: string) => new Intl.DateTimeFormat("en-CA", {
            timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
          }).format(d);
          // currentDate is noon UTC of the center's today, so compare it in center TZ.
          // now is checked in local TZ — the user's calendar "today".
          const isSameDay = tzDate(now, localTz) === tzDate(currentDate, timezone);
          if (!isSameDay) return null;
          const x = timeToX(now, localTz);
          if (x < 0 || x > TOTAL_W) return null;
          return (
            <div
              className="absolute top-7 bottom-0 pointer-events-none z-30"
              style={{ left: LABEL_W + x, width: 2, backgroundColor: "#ef4444" }}
            >
              <div className="w-2 h-2 rounded-full bg-red-500 -ml-[3px] -mt-1" />
            </div>
          );
        })()}

        {renderSection("Clients", clients, "bg-background", clientsOpen, () => setClientsOpen(o => !o))}
        {renderSection("Providers", providers, "bg-muted/20", providersOpen, () => setProvidersOpen(o => !o))}

        {entities.length === 0 && (
          <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
            No active clients or providers. Add some to get started.
          </div>
        )}
      </div>

      {/* Drag cursor annotation — fixed position, follows the mouse */}
      {dragAnnotation && (
        <div
          className="fixed z-50 pointer-events-none bg-popover border border-border rounded px-2 py-1 text-xs font-medium shadow-md text-foreground"
          style={{ left: dragAnnotation.x + 14, top: dragAnnotation.y - 28 }}
        >
          {dragAnnotation.label}
        </div>
      )}

      {/* Block right-click context menu */}
      {blockMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setBlockMenu(null)} />
          <div
            className="fixed z-50 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[200px] text-sm"
            style={{ top: blockMenu.y, left: blockMenu.x }}
          >
            <div className="px-3 py-1.5 text-[11px] text-muted-foreground font-medium uppercase tracking-wide border-b border-border mb-1">
              {blockMenu.ev.extendedProps.blockParty === "CLIENT" ? "Client" : "Provider"} Block
            </div>
            <button
              className="w-full text-left px-3 py-2 hover:bg-muted disabled:opacity-50"
              disabled={blockMenuLoading}
              onClick={() => doRemoveBlock(true)}
            >
              Restore cancelled day
            </button>
            <button
              className="w-full text-left px-3 py-2 hover:bg-muted disabled:opacity-50 text-muted-foreground"
              disabled={blockMenuLoading}
              onClick={() => doRemoveBlock(false)}
            >
              Remove block only
            </button>
          </div>
        </>
      )}
    </div>
  );
}
