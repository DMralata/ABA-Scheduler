"use client";

import { useState, useRef, useEffect } from "react";
import { Sparkles, ChevronLeft, ChevronRight, Trash2, ChevronDown, BarChart2, Undo2, X, GripVertical, Check } from "lucide-react";
import { WeekAnalysisModal } from "./WeekAnalysisModal";
import type { AuditData } from "./WeekAnalysisModal";
import { clearDaySchedule, clearDayUnbillable, clearDayProposals, clearWeekProposals, listPendingProposalsInRange, approveAllProposedSessions } from "@/lib/actions/scheduler";
import { ResourceTimeline } from "./ResourceTimeline";
import { SessionTypePalette } from "./SessionTypePalette";
import { SessionModal } from "./SessionModal";
import type { SessionDraft } from "./SessionModal";
import { CancelSessionModal } from "./CancelSessionModal";
import type { CancelTarget } from "./CancelSessionModal";
import { DriveTimeSummaryModal } from "./DriveTimeSummaryModal";
import type { DriveTimeSummaryTarget } from "./DriveTimeSummaryModal";
import type { TimelineEntity } from "./ResourceTimeline";
import { EfficiencyBar } from "./EfficiencyBar";
import { WeekGrid } from "./WeekGrid";
import type { WeekGridEntity } from "./WeekGrid";
import { MakeupNotificationsDropdown } from "./MakeupNotificationsDropdown";

interface WorkspaceClient {
  id: string; firstName: string; lastName: string;
  street: string | null; city: string | null; state: string | null; zip: string | null;
  availability: { dayOfWeek: string; startTime: string; endTime: string }[];
  authorizations: { startDate: Date; endDate: Date }[];
}
interface WorkspaceProvider {
  id: string; firstName: string; lastName: string; position: string;
  availability: { dayOfWeek: string; startTime: string; endTime: string }[];
}
interface WorkspaceSessionType { id: string; name: string; billable: boolean; requiresBcba: boolean }
interface WorkspaceCenter { id: string; name: string }

interface ScheduleWorkspaceProps {
  clients: WorkspaceClient[];
  providers: WorkspaceProvider[];
  sessionTypes: WorkspaceSessionType[];
  centers: WorkspaceCenter[];
  centerId: string | null;
  timezone: string;
}

function fmtHours(h: number): string {
  const hrs = Math.floor(h);
  const min = Math.round((h - hrs) * 60);
  if (min === 0) return `${hrs}h`;
  return `${hrs}h ${min}m`;
}

function formatDate(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  }).format(d);
}

// Safe day offset: d is noon UTC of a calendar date, so ±24h always lands
// on the adjacent calendar date regardless of browser timezone or DST.
function addDays(d: Date, n: number) {
  return new Date(d.getTime() + n * 24 * 3_600_000);
}

// Returns noon UTC for the current calendar date in the given timezone.
// Noon UTC formats to the same calendar date in every timezone UTC-11..UTC+11,
// avoiding the browser-midnight drift that occurs when browser ≠ center timezone.
function centerNoon(tz: string): Date {
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  return new Date(`${todayStr}T12:00:00Z`);
}

// Returns noon-UTC dates for Mon–Fri of the week that contains `anyDate`.
function getWeekDates(anyDate: Date, tz: string): Date[] {
  const dateStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(anyDate);
  const [yr, mo, dy] = dateStr.split("-").map(Number);
  const noonUTC = new Date(Date.UTC(yr, mo - 1, dy, 12));
  const dowStr = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(noonUTC);
  const dow = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[dowStr] ?? 1;
  const monday = addDays(noonUTC, dow === 0 ? -6 : -(dow - 1));
  return [0, 1, 2, 3, 4].map(i => addDays(monday, i));
}

function formatWeekLabel(weekDates: Date[], tz: string): string {
  const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }).format(d);
  const monStr = fmt(weekDates[0], { month: "short", day: "numeric" });
  const friStr = fmt(weekDates[4], { month: "short", day: "numeric", year: "numeric" });
  return `${monStr} – ${friStr}`;
}

export function ScheduleWorkspace({ clients, providers, sessionTypes, centers, centerId, timezone }: ScheduleWorkspaceProps) {
  // Initialize to noon UTC of today in the center's timezone so the displayed
  // date, timeline fetch, and auto-complete all agree regardless of browser TZ.
  // Rehydrate from sessionStorage so navigating away from /schedule and back
  // (e.g., to /clients then back) lands on the day the user was last viewing
  // instead of snapping to today. sessionStorage is intentional: a brand-new
  // browser session starts on today.
  const [currentDate, setCurrentDate] = useState(() => {
    if (typeof window === "undefined") return centerNoon(timezone);
    try {
      const saved = sessionStorage.getItem("schedule_current_date");
      if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved)) {
        return new Date(`${saved}T12:00:00Z`);
      }
    } catch { /* sessionStorage may be unavailable (incognito strictness) */ }
    return centerNoon(timezone);
  });
  useEffect(() => {
    try {
      const dateStr = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(currentDate);
      sessionStorage.setItem("schedule_current_date", dateStr);
    } catch { /* ignore */ }
  }, [currentDate, timezone]);
  const [draft, setDraft] = useState<SessionDraft | null>(null);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [driveTimeTarget, setDriveTimeTarget] = useState<DriveTimeSummaryTarget | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoMessage, setAutoMessage] = useState<string | null>(null);
  const [autoSkips, setAutoSkips] = useState<{ name: string; reason: string }[]>([]);
  const [autoUnserved, setAutoUnserved] = useState<{ name: string; reason: string }[]>([]);
  const [autoWarnings, setAutoWarnings] = useState<string[]>([]);
  const [autoDialogOpen, setAutoDialogOpen] = useState(false);
  const [clearDayState, setClearDayState] = useState<"idle" | "confirming" | "clearing">("idle");
  const [clearMode, setClearMode] = useState<"all" | "unbillable" | "proposals">("all");
  const [clearWeekState, setClearWeekState] = useState<"idle" | "confirming" | "clearing">("idle");
  const [acceptAllRunning, setAcceptAllRunning] = useState(false);

  const makeupStorageKey = `makeup_notifications_${centerId ?? "default"}`;
  const [makeupSessionIds, setMakeupSessionIds] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(localStorage.getItem(`makeup_notifications_${centerId ?? "default"}`) ?? "[]") as string[];
    } catch { return []; }
  });

  function addMakeupSession(sessionId: string) {
    setMakeupSessionIds((prev) => {
      if (prev.includes(sessionId)) return prev;
      const next = [...prev, sessionId];
      localStorage.setItem(makeupStorageKey, JSON.stringify(next));
      return next;
    });
  }

  function dismissMakeupSession(sessionId: string) {
    setMakeupSessionIds((prev) => {
      const next = prev.filter((id) => id !== sessionId);
      localStorage.setItem(makeupStorageKey, JSON.stringify(next));
      return next;
    });
  }
  const [clearDropdownOpen, setClearDropdownOpen] = useState(false);
  const clearDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (clearDropdownRef.current && !clearDropdownRef.current.contains(e.target as Node)) {
        setClearDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const [auditData, setAuditData] = useState<AuditData | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [analysisData, setAnalysisData] = useState<AuditData | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisModalOpen, setAnalysisModalOpen] = useState(false);
  const [analysisSnapshotKey, setAnalysisSnapshotKey] = useState<number | null>(null);
  const [activeSessionTypeId, setActiveSessionTypeId] = useState<string>("");
  const [viewMode, setViewMode] = useState<"day" | "week">(() => {
    if (typeof window === "undefined") return "day";
    try {
      const saved = sessionStorage.getItem("schedule_view_mode");
      return saved === "week" ? "week" : "day";
    } catch { return "day"; }
  });
  useEffect(() => {
    try { sessionStorage.setItem("schedule_view_mode", viewMode); } catch { /* ignore */ }
  }, [viewMode]);
  const [autoDropdownOpen, setAutoDropdownOpen] = useState(false);
  const autoDropdownRef = useRef<HTMLDivElement>(null);
  const [undoDays, setUndoDays] = useState<Array<{ dayStart: Date; dayEnd: Date }>>([]);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Action dock drag state — lets the user move the floating dock if it covers a session.
  // Offset is added to the default centered-bottom position; persisted per-center to localStorage.
  const dockStorageKey = `schedule_dock_offset_${centerId ?? "default"}`;
  const [dockOffset, setDockOffset] = useState<{ x: number; y: number }>(() => {
    if (typeof window === "undefined") return { x: 0, y: 0 };
    try {
      const raw = localStorage.getItem(`schedule_dock_offset_${centerId ?? "default"}`);
      if (!raw) return { x: 0, y: 0 };
      const parsed = JSON.parse(raw);
      if (typeof parsed?.x !== "number" || typeof parsed?.y !== "number") return { x: 0, y: 0 };
      // Clamp persisted offsets to a reasonable range so a previously-dragged
      // dock can't end up off-screen with no way for the user to recover it.
      const x = Math.max(-600, Math.min(600, parsed.x));
      const y = Math.max(-600, Math.min(40, parsed.y));
      return { x, y };
    } catch { return { x: 0, y: 0 }; }
  });
  const dockDragRef = useRef<{ startX: number; startY: number; offsetX: number; offsetY: number } | null>(null);

  function handleDockPointerDown(e: React.PointerEvent<HTMLSpanElement>) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dockDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      offsetX: dockOffset.x,
      offsetY: dockOffset.y,
    };
  }

  function handleDockPointerMove(e: React.PointerEvent<HTMLSpanElement>) {
    if (!dockDragRef.current) return;
    const dx = e.clientX - dockDragRef.current.startX;
    const dy = e.clientY - dockDragRef.current.startY;
    setDockOffset({
      x: dockDragRef.current.offsetX + dx,
      y: dockDragRef.current.offsetY + dy,
    });
  }

  function handleDockPointerUp(e: React.PointerEvent<HTMLSpanElement>) {
    if (!dockDragRef.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dockDragRef.current = null;
    try { localStorage.setItem(dockStorageKey, JSON.stringify(dockOffset)); } catch {}
  }

  function resetDockPosition() {
    setDockOffset({ x: 0, y: 0 });
    try { localStorage.removeItem(dockStorageKey); } catch {}
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (autoDropdownRef.current && !autoDropdownRef.current.contains(e.target as Node)) {
        setAutoDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Auto-dismiss undo button after 30s
  useEffect(() => {
    if (undoDays.length === 0) return;
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => setUndoDays([]), 30_000);
    return () => { if (undoTimerRef.current) clearTimeout(undoTimerRef.current); };
  }, [undoDays]);

  const weekDates = getWeekDates(currentDate, timezone);

  const entities: TimelineEntity[] = [
    ...clients.map(c => ({ id: c.id, type: "client" as const, firstName: c.firstName, lastName: c.lastName, availability: c.availability })),
    ...providers.map(p => ({ id: p.id, type: "provider" as const, firstName: p.firstName, lastName: p.lastName, position: p.position, availability: p.availability })),
  ];

  function computeDayBoundaries(date: Date, tz: string) {
    const dateStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(date);
    const noonUTC = new Date(`${dateStr}T12:00:00Z`);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).formatToParts(noonUTC);
    const h = parseInt(parts.find(p => p.type === "hour")!.value);
    const m = parseInt(parts.find(p => p.type === "minute")!.value);
    const s = parseInt(parts.find(p => p.type === "second")!.value);
    const offsetMs = (h === 24 ? 0 : h) * 3_600_000 + m * 60_000 + s * 1_000;
    const dayStart = new Date(noonUTC.getTime() - offsetMs);
    return { dayStart, dayEnd: new Date(dayStart.getTime() + 24 * 3_600_000) };
  }

  async function handleUndo() {
    if (!centerId || undoDays.length === 0) return;
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    const days = undoDays;
    setUndoDays([]);
    setAutoMessage("Undoing…");
    for (const { dayStart, dayEnd } of days) {
      await clearDayProposals(dayStart, dayEnd, centerId);
    }
    setRefreshKey(k => k + 1);
    setAutoMessage("Undo complete — proposals cleared.");
  }

  async function handleAutoComplete(mode: "whole" | "rest" = "whole") {
    if (!centerId) { setAutoMessage("No center configured."); return; }
    setAutoRunning(true); setAutoMessage(null); setAutoSkips([]); setAutoUnserved([]); setAutoWarnings([]); setAuditData(null); setAuditLoading(false); setAutoDialogOpen(false); setUndoDays([]);

    const dateParam = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(currentDate);
    const notBefore = mode === "rest" ? new Date().toISOString() : undefined;

    try {
      const res = await fetch("/api/scheduler/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: dateParam, centerId, ...(notBefore ? { notBefore } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAutoMessage(data.error ?? "Scheduler failed.");
      } else {
        const scheduled = data.totalClientsScheduled as number;
        const unscheduled = data.totalClientsUnscheduled as number;
        const skipReasons = data.skipReasons as Record<string, string> | undefined;

        // Build per-client skip list with names
        const nameMap: Record<string, string> = {};
        for (const c of clients) nameMap[c.id] = `${c.lastName}, ${c.firstName}`;

        const skips: { name: string; reason: string }[] = [];
        if (skipReasons) {
          for (const [id, reason] of Object.entries(skipReasons)) {
            skips.push({ name: nameMap[id] ?? id, reason });
          }
          skips.sort((a, b) => a.name.localeCompare(b.name));
        }
        setAutoSkips(skips);

        const rosterMissed = (data.unservedRosterClients as Array<{ clientId: string; reason: string }> | undefined) ?? [];
        const unservedList = rosterMissed
          .map(({ clientId, reason }) => ({ name: nameMap[clientId] ?? clientId, reason }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setAutoUnserved(unservedList);
        setAutoWarnings((data.warnings as string[] | undefined) ?? []);

        const msg = `Scheduled ${scheduled} client${scheduled !== 1 ? "s" : ""}` +
          (unscheduled > 0 ? ` · ${unscheduled} unscheduled` : "");
        setAutoMessage(msg);
        setAutoDialogOpen(true);
        setRefreshKey(k => k + 1);
        setUndoDays([computeDayBoundaries(currentDate, timezone)]);

        // Run AUDIT_GOD four-pass audit for the week — surfaces score, utilization,
        // coverage gaps, and compliance violations in the details panel.
        setAuditLoading(true);
        fetch(`/api/schedule/audit?date=${dateParam}&centerId=${centerId}`)
          .then((r) => r.json())
          .then((audit) => { setAuditData(audit); setAuditLoading(false); })
          .catch(() => { setAuditLoading(false); }); // audit failure is non-blocking
      }
    } catch {
      setAutoMessage("Could not reach scheduler.");
    } finally {
      setAutoRunning(false);
    }
  }

  function handleClearDay() {
    if (!centerId) { setAutoMessage("No center configured."); setClearDayState("idle"); return; }
    setClearDayState("clearing");
    setAutoMessage(null); setAutoSkips([]); setAutoUnserved([]); setAutoWarnings([]); setAutoDialogOpen(false);
    const { dayStart, dayEnd } = computeDayBoundaries(currentDate, timezone);

    const action =
      clearMode === "unbillable" ? clearDayUnbillable(dayStart, dayEnd, centerId) :
      clearMode === "proposals"  ? clearDayProposals(dayStart, dayEnd, centerId) :
                                   clearDaySchedule(dayStart, dayEnd, centerId);

    action
      .then(result => {
        if (result.success) {
          const parts: string[] = [];
          if ("deletedSessions" in result && result.deletedSessions > 0)
            parts.push(`${result.deletedSessions} session${result.deletedSessions !== 1 ? "s" : ""}`);
          if ("deletedProposals" in result && result.deletedProposals > 0)
            parts.push(`${result.deletedProposals} proposal${result.deletedProposals !== 1 ? "s" : ""}`);
          setAutoMessage(parts.length > 0 ? `Cleared ${parts.join(" · ")}` : "Nothing to clear");
          setRefreshKey(k => k + 1);
        } else {
          setAutoMessage("Clear failed: " + result.error);
        }
      })
      .catch(() => setAutoMessage("Could not clear day."))
      .finally(() => setClearDayState("idle"));
  }

  function handleClearWeek() {
    if (!centerId) { setAutoMessage("No center configured."); setClearWeekState("idle"); return; }
    setClearWeekState("clearing");
    setAutoMessage(null); setAutoSkips([]); setAutoUnserved([]); setAutoWarnings([]); setAutoDialogOpen(false); setUndoDays([]);
    // Cutoff is "now" to the second, not midnight of today — past/in-progress
    // sessions must not be cleared. For future weeks, start from Monday.
    const { dayStart: mondayStart } = computeDayBoundaries(weekDates[0], timezone);
    const fromDate = new Date(Math.max(Date.now(), mondayStart.getTime()));
    const { dayEnd: weekEnd } = computeDayBoundaries(weekDates[4], timezone);
    clearWeekProposals(fromDate, weekEnd, centerId)
      .then(result => {
        if (result.success) {
          setAutoMessage(result.deletedProposals > 0 ? `Cleared ${result.deletedProposals} proposal${result.deletedProposals !== 1 ? "s" : ""}` : "Nothing to clear");
          setRefreshKey(k => k + 1);
        } else {
          setAutoMessage("Clear failed: " + result.error);
        }
      })
      .catch(() => setAutoMessage("Could not clear week."))
      .finally(() => setClearWeekState("idle"));
  }

  // Accept every PENDING proposal currently visible in the day or week view.
  // Chunked client-side so no single server request approaches Netlify's 10s
  // function timeout (one big batch was timing out, half-approving the set,
  // and leaving the UI stale). Each chunk preserves the ATI re-check invariant
  // server-side (serial per-proposal transactions inside the chunk).
  async function handleAcceptAll() {
    if (!centerId) { setAutoMessage("No center configured."); return; }
    setAcceptAllRunning(true);
    setAutoMessage(null); setAutoSkips([]); setAutoUnserved([]); setAutoWarnings([]); setAutoDialogOpen(false);
    const start = viewMode === "week"
      ? computeDayBoundaries(weekDates[0], timezone).dayStart
      : computeDayBoundaries(currentDate, timezone).dayStart;
    const end = viewMode === "week"
      ? computeDayBoundaries(weekDates[4], timezone).dayEnd
      : computeDayBoundaries(currentDate, timezone).dayEnd;
    try {
      const { ids } = await listPendingProposalsInRange(start, end, centerId);
      if (ids.length === 0) {
        setAutoMessage("No proposals to accept");
        setRefreshKey(k => k + 1);
        return;
      }
      const CHUNK_SIZE = 8;
      let okCount = 0;
      let failCount = 0;
      for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        const chunk = ids.slice(i, i + CHUNK_SIZE);
        const done = Math.min(i + CHUNK_SIZE, ids.length);
        setAutoMessage(`Accepting ${done} / ${ids.length}…`);
        const result = await approveAllProposedSessions(chunk);
        okCount += result.approved.length;
        failCount += result.failed.length;
        // Refresh between chunks so the user sees blocks turn from proposed
        // to scheduled as the batch progresses, not all at once at the end.
        setRefreshKey(k => k + 1);
      }
      const parts: string[] = [`${okCount} proposal${okCount !== 1 ? "s" : ""} accepted`];
      if (failCount > 0) parts.push(`${failCount} failed`);
      setAutoMessage(parts.join(" · "));
    } catch {
      setAutoMessage("Could not accept proposals.");
      setRefreshKey(k => k + 1);
    } finally {
      setAcceptAllRunning(false);
    }
  }

  async function handleAutoCompleteWeek() {
    if (!centerId) { setAutoMessage("No center configured."); return; }
    setAutoRunning(true);
    setAutoMessage(null);
    setAutoSkips([]);
    setAutoUnserved([]);
    setAutoWarnings([]);
    setAuditData(null);
    setAuditLoading(false);
    setAutoDialogOpen(false);
    setUndoDays([]);

    const days = getWeekDates(currentDate, timezone);
    const nameMap: Record<string, string> = {};
    for (const c of clients) nameMap[c.id] = `${c.lastName}, ${c.firstName}`;

    const allSkips: { name: string; reason: string }[] = [];
    const allWarnings: string[] = [];

    setAutoMessage("Scheduling week…");
    const weekStartParam = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(days[0]);

    try {
      const res = await fetch("/api/scheduler/propose-week", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekOf: weekStartParam, centerId, now: new Date().toISOString() }),
      });
      const data = await res.json();
      if (res.ok) {
        const totalScheduled   = (data.totalClientsScheduled   as number) ?? 0;
        const totalUnscheduled = (data.totalClientsUnscheduled as number) ?? 0;
        const totalProposals   = (data.totalProposals           as number) ?? totalScheduled;

        // Store week boundaries for undo (all 5 days)
        const scheduledDays = days.map((d) => computeDayBoundaries(d, timezone));
        if (scheduledDays.length > 0) setUndoDays(scheduledDays);

        const skipReasons = data.skipReasons as Record<string, string> | undefined;
        if (skipReasons) {
          for (const [id, reason] of Object.entries(skipReasons))
            allSkips.push({ name: nameMap[id] ?? id, reason });
        }
        const warnings = data.warnings as string[] | undefined;
        if (warnings) for (const w of warnings) allWarnings.push(w);

        allSkips.sort((a, b) => a.name.localeCompare(b.name));
        setAutoSkips(allSkips);
        setAutoWarnings(allWarnings);

        const msg = `Week scheduled: ${totalProposals} session${totalProposals !== 1 ? "s" : ""} across ${totalScheduled} client${totalScheduled !== 1 ? "s" : ""}` +
          (totalUnscheduled > 0 ? ` · ${totalUnscheduled} unscheduled` : "");
        setAutoMessage(msg);
        setAutoDialogOpen(true);
      } else {
        setAutoMessage("Scheduling failed — please try again or contact support.");
      }
    } catch {
      setAutoMessage("Scheduling failed — network error.");
    }

    setRefreshKey(k => k + 1);
    setAutoRunning(false);

    // Run audit for the week
    const auditWeekStart = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(days[0]);
    setAuditLoading(true);
    fetch(`/api/schedule/audit?date=${auditWeekStart}&centerId=${centerId}`)
      .then(r => r.json())
      .then(audit => { setAuditData(audit); setAuditLoading(false); })
      .catch(() => { setAuditLoading(false); });
  }

  function handleAnalyzeWeek() {
    if (!centerId) return;
    // Schedule hasn't changed since last analysis — just reopen the cached result.
    if (analysisData !== null && analysisSnapshotKey === refreshKey) {
      setAnalysisModalOpen(true);
      return;
    }
    const dateParam = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(currentDate);
    setAnalysisLoading(true);
    fetch(`/api/schedule/audit?date=${dateParam}&centerId=${centerId}`)
      .then(r => r.json())
      .then(data => {
        setAnalysisData(data);
        setAnalysisSnapshotKey(refreshKey);
        setAnalysisModalOpen(true);
        setAnalysisLoading(false);
      })
      .catch(() => { setAnalysisLoading(false); });
  }

  // ── Dock button style helpers ────────────────────────────────────────────────
  const dockBtn: React.CSSProperties = {
    height: 30, padding: "0 12px", borderRadius: 7,
    border: "none", background: "transparent", color: "inherit",
    fontSize: 12, fontWeight: 500, cursor: "pointer",
    display: "inline-flex", alignItems: "center", gap: 6,
  };
  const dockBtnPrimary: React.CSSProperties = {
    ...dockBtn, background: "#ffffff", color: "var(--ata-gray-900)",
  };
  const dockBtnAmber: React.CSSProperties = {
    ...dockBtn,
    background: "rgba(251,191,36,0.15)", color: "#d97706",
  };

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 2rem)" }}>
      {/* ── Slim toolbar ─────────────────────────────────────────────────────── */}
      <div style={{
        height: 56, display: "flex", alignItems: "center", gap: 14,
        padding: "0 18px", flexShrink: 0,
        background: "#ffffff",
        borderBottom: "1px solid rgba(15,15,12,0.08)",
        fontSize: 13, color: "var(--ata-gray-900)",
      }}>
        {/* Date navigation */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            onClick={() => { setCurrentDate(d => addDays(d, viewMode === "week" ? -7 : -1)); setClearDayState("idle"); setAutoMessage(null); setAutoSkips([]); setAutoUnserved([]); setAuditData(null); setAuditLoading(false); setAutoDialogOpen(false); setAnalysisData(null); setAnalysisModalOpen(false); setAnalysisSnapshotKey(null); }}
            aria-label={viewMode === "week" ? "Previous week" : "Previous day"}
            style={{ height: 28, width: 28, borderRadius: 6, border: "none", background: "transparent", color: "var(--ata-gray-900)", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={() => { setCurrentDate(centerNoon(timezone)); setClearDayState("idle"); setAutoMessage(null); setAutoSkips([]); setAutoUnserved([]); setAuditData(null); setAuditLoading(false); setAutoDialogOpen(false); setAnalysisData(null); setAnalysisModalOpen(false); setAnalysisSnapshotKey(null); }}
            style={{ height: 28, padding: "0 10px", borderRadius: 6, border: "none", background: "transparent", color: "var(--ata-gray-900)", cursor: "pointer", fontSize: 12, fontWeight: 500 }}
          >
            Today
          </button>
          <button
            onClick={() => { setCurrentDate(d => addDays(d, viewMode === "week" ? 7 : 1)); setClearDayState("idle"); setAutoMessage(null); setAutoSkips([]); setAutoUnserved([]); setAuditData(null); setAuditLoading(false); setAutoDialogOpen(false); setAnalysisData(null); setAnalysisModalOpen(false); setAnalysisSnapshotKey(null); }}
            aria-label={viewMode === "week" ? "Next week" : "Next day"}
            style={{ height: 28, width: 28, borderRadius: 6, border: "none", background: "transparent", color: "var(--ata-gray-900)", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
          >
            <ChevronRight size={14} />
          </button>
        </div>

        {/* Vertical divider */}
        <div style={{ width: 1, height: 18, background: "var(--ata-gray-200)" }} />

        {/* Day / Week segmented toggle */}
        <div style={{ display: "inline-flex", padding: 2, borderRadius: 8, background: "var(--ata-gray-100)" }}>
          <button
            onClick={() => setViewMode("day")}
            style={{
              height: 24, padding: "0 12px", borderRadius: 6, border: "none",
              background: viewMode === "day" ? "#ffffff" : "transparent",
              boxShadow: viewMode === "day" ? "0 1px 2px rgba(0,0,0,0.06), 0 0 0 0.5px rgba(15,15,12,0.08)" : "none",
              color: viewMode === "day" ? "var(--ata-gray-900)" : "var(--ata-gray-500)",
              fontSize: 12, fontWeight: viewMode === "day" ? 500 : 400, cursor: "pointer",
            }}
          >
            Day
          </button>
          <button
            onClick={() => setViewMode("week")}
            style={{
              height: 24, padding: "0 12px", borderRadius: 6, border: "none",
              background: viewMode === "week" ? "#ffffff" : "transparent",
              boxShadow: viewMode === "week" ? "0 1px 2px rgba(0,0,0,0.06), 0 0 0 0.5px rgba(15,15,12,0.08)" : "none",
              color: viewMode === "week" ? "var(--ata-gray-900)" : "var(--ata-gray-500)",
              fontSize: 12, fontWeight: viewMode === "week" ? 500 : 400, cursor: "pointer",
            }}
          >
            Week
          </button>
        </div>

        {/* Date heading */}
        <div style={{ fontFamily: "Geist, Inter, sans-serif", fontSize: 15, fontWeight: 500, letterSpacing: "-0.015em" }}>
          {viewMode === "week" ? formatWeekLabel(weekDates, timezone) : formatDate(currentDate, timezone)}
        </div>

        <div style={{ flex: 1 }} />

        <EfficiencyBar centerId={centerId} currentDate={currentDate} refreshKey={refreshKey} />

        <MakeupNotificationsDropdown
          sessionIds={makeupSessionIds}
          onDismiss={dismissMakeupSession}
          onBooked={() => setRefreshKey((k) => k + 1)}
        />
      </div>


{/* Workspace */}
      <div className="flex flex-1 min-h-0" style={{ position: "relative" }}>
        {viewMode === "day" ? (
          <>
            {/* Left: session type palette — day view only */}
            <div style={{ flexShrink: 0 }}>
              <SessionTypePalette
                sessionTypes={sessionTypes}
                activeSessionTypeId={activeSessionTypeId}
                onSelect={setActiveSessionTypeId}
              />
            </div>

            {/* Timeline */}
            <div className="flex-1 min-w-0">
              <ResourceTimeline
                entities={entities}
                currentDate={currentDate}
                timezone={timezone}
                centerId={centerId ?? undefined}
                activeSessionTypeId={activeSessionTypeId || undefined}
                onDraftCreate={setDraft}
                onProposalApproved={() => setRefreshKey(k => k + 1)}
                onDriveTimeClick={(ev) => {
                  const startLocal = new Intl.DateTimeFormat("en-US", {
                    timeZone: timezone,
                    month: "short", day: "numeric",
                    hour: "numeric", minute: "2-digit", hour12: true,
                  }).format(new Date(ev.start));
                  const totalBlockMinutes = Math.round(
                    (new Date(ev.end).getTime() - new Date(ev.start).getTime()) / 60_000
                  );
                  setDriveTimeTarget({
                    sessionId: ev.id,
                    providerName: ev.extendedProps.providerName ?? "Provider",
                    startLabel: startLocal,
                    totalBlockMinutes,
                    notes: ev.extendedProps.notes ?? null,
                  });
                }}
                onSessionClick={(ev, entityType) => {
                  const startLocal = new Intl.DateTimeFormat("en-US", {
                    timeZone: timezone,
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: true,
                  }).format(new Date(ev.start));
                  setCancelTarget({
                    sessionId: ev.id,
                    title: ev.title,
                    sessionTypeName: ev.extendedProps.sessionTypeName,
                    startLabel: startLocal,
                    status: ev.extendedProps.status ?? "SCHEDULED",
                    cancelledBy: ev.extendedProps.cancelledBy ?? null,
                    providerId: ev.extendedProps.providerId ?? null,
                    clientId: ev.extendedProps.clientId ?? null,
                    startTime: ev.start ? new Date(ev.start).toISOString() : null,
                    viewContext: entityType === "client" ? "CLIENT" : "PROVIDER",
                  });
                }}
                refreshKey={refreshKey}
              />
            </div>
          </>
        ) : (
          /* Week grid — full width, no palette */
          <div className="flex-1 min-w-0">
            <WeekGrid
              weekDates={weekDates}
              entities={(entities as WeekGridEntity[])}
              timezone={timezone}
              centerId={centerId}
              refreshKey={refreshKey}
              onSessionClick={(ev, entityType) => {
                const startLocal = new Intl.DateTimeFormat("en-US", {
                  timeZone: timezone,
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  hour12: true,
                }).format(new Date(ev.start));
                setCancelTarget({
                  sessionId: ev.id,
                  title: ev.clientName ?? ev.providerName ?? ev.sessionTypeName,
                  sessionTypeName: ev.sessionTypeName,
                  startLabel: startLocal,
                  status: ev.status,
                  cancelledBy: ev.cancelledBy,
                  providerId: ev.providerId,
                  clientId: ev.clientId,
                  startTime: new Date(ev.start).toISOString(),
                  viewContext: entityType === "client" ? "CLIENT" : "PROVIDER",
                });
              }}
              onProposalApproved={() => setRefreshKey(k => k + 1)}
              onDayClick={(date) => {
                setCurrentDate(date);
                setViewMode("day");
                setAutoMessage(null);
                setAutoSkips([]);
                setAutoUnserved([]);
                setAuditData(null);
                setAuditLoading(false);
                setAutoDialogOpen(false);
              }}
            />
          </div>
        )}

        {/* ── Action Dock ─────────────────────────────────────────────────────
            Floating dark pill, default-centered over the schedule grid.
            Drag the grip handle on the left to move it out of the way of a session;
            double-click the grip to snap back to the default position.
        ──────────────────────────────────────────────────────────────────── */}
        <div style={{
          position: "fixed", bottom: 18, left: "50%",
          transform: `translate(calc(-50% + ${dockOffset.x}px), ${dockOffset.y}px)`,
          display: "flex", alignItems: "center", gap: 4,
          background: "var(--ata-gray-900)", color: "#ffffff",
          padding: 4, borderRadius: 11,
          boxShadow: "0 10px 28px rgba(15,15,12,0.22), 0 1px 3px rgba(15,15,12,0.10)",
          fontFamily: "Geist, Inter, sans-serif",
          zIndex: 40,
          whiteSpace: "nowrap",
          touchAction: "none", // prevents touch scroll while dragging on mobile
        }}>
          {/* Drag handle — grip to relocate the dock when it covers a session */}
          <span
            onPointerDown={handleDockPointerDown}
            onPointerMove={handleDockPointerMove}
            onPointerUp={handleDockPointerUp}
            onPointerCancel={handleDockPointerUp}
            onDoubleClick={resetDockPosition}
            title="Drag to move · double-click to reset"
            aria-label="Drag the action dock"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 18,
              height: 30,
              cursor: dockDragRef.current ? "grabbing" : "grab",
              color: "rgba(255,255,255,0.55)",
              flexShrink: 0,
            }}
          >
            <GripVertical size={13} />
          </span>

          {/* Add session */}
          <button
            onClick={() => {
              // Open session modal with a blank draft anchored to 9am today.
              // Build the start in the active display timezone (user pref or
              // center default) so the modal opens at the user's expected hour
              // regardless of which timezone the browser is in.
              const { dayStart } = computeDayBoundaries(currentDate, timezone);
              const start = new Date(dayStart.getTime() + 9 * 3_600_000);
              const end = new Date(dayStart.getTime() + 10 * 3_600_000);
              setDraft({ start, end });
            }}
            style={dockBtn}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
            Add session
          </button>

          {/* Clear day/week */}
          <div ref={clearDropdownRef} style={{ position: "relative" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              {clearDayState === "idle" && clearWeekState === "idle" && (
                <>
                  <button
                    onClick={() => { if (viewMode === "week") { setClearWeekState("confirming"); } else { setClearMode("all"); setClearDayState("confirming"); } setAutoMessage(null); setClearDropdownOpen(false); }}
                    disabled={autoRunning || !centerId}
                    style={{ ...dockBtn, opacity: (autoRunning || !centerId) ? 0.5 : 1 }}
                  >
                    {viewMode === "week" ? "Clear week" : "Clear day"}
                  </button>
                  {viewMode === "day" && (
                    <button
                      onClick={() => setClearDropdownOpen(o => !o)}
                      disabled={autoRunning || !centerId}
                      style={{ height: 30, width: 22, borderRadius: 7, border: "none", background: "transparent", color: "inherit", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", paddingLeft: 0, opacity: (autoRunning || !centerId) ? 0.5 : 1 }}
                    >
                      <ChevronDown size={10} />
                    </button>
                  )}
                </>
              )}
              {(clearDayState === "confirming" || clearWeekState === "confirming") && (
                <span style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 4px" }}>
                  <button
                    onClick={viewMode === "week" ? handleClearWeek : handleClearDay}
                    style={{ height: 28, padding: "0 10px", borderRadius: 7, border: "none", background: "var(--ata-danger-600)", color: "#fff", fontSize: 11, fontWeight: 500, cursor: "pointer" }}
                  >
                    {viewMode === "week" ? "Confirm clear week?" :
                     clearMode === "unbillable" ? "Confirm clear unbillable?" :
                     clearMode === "proposals"  ? "Confirm clear suggestions?" :
                                                  "Confirm clear all?"}
                  </button>
                  <button
                    onClick={() => { setClearDayState("idle"); setClearWeekState("idle"); }}
                    style={{ fontSize: 11, color: "rgba(232,234,240,0.55)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
                  >
                    cancel
                  </button>
                </span>
              )}
              {(clearDayState === "clearing" || clearWeekState === "clearing") && (
                <button disabled style={{ ...dockBtn, opacity: 0.5 }}>Clearing…</button>
              )}
            </div>
            {/* Clear dropdown — pops upward */}
            {clearDropdownOpen && (
              <div style={{
                position: "absolute", bottom: "100%", left: 0, marginBottom: 6,
                width: 228, background: "#ffffff", border: "1px solid var(--ata-gray-300)",
                borderRadius: 8, boxShadow: "0 8px 24px rgba(15,15,12,0.18)",
                overflow: "hidden", color: "var(--ata-gray-900)",
              }}>
                {[
                  { mode: "all" as const, label: "Clear All", desc: "Remove all sessions and proposals" },
                  { mode: "unbillable" as const, label: "Clear Unbillable", desc: "Keep Direct Therapy, remove Drive Time etc." },
                  { mode: "proposals" as const, label: "Clear Suggestions", desc: "Remove proposals, keep user-created sessions" },
                ].map(({ mode, label, desc }, i) => (
                  <button
                    key={mode}
                    onClick={() => { setClearMode(mode); setClearDropdownOpen(false); setClearDayState("confirming"); setAutoMessage(null); }}
                    style={{
                      width: "100%", textAlign: "left", padding: "8px 12px",
                      background: "none", border: "none", cursor: "pointer",
                      borderTop: i > 0 ? "1px solid rgba(15,15,12,0.06)" : "none",
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 500 }}>{label}</div>
                    <div style={{ fontSize: 11, color: "var(--ata-gray-500)", marginTop: 1 }}>{desc}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Analyze week */}
          <button
            onClick={handleAnalyzeWeek}
            disabled={analysisLoading || !centerId}
            style={{ ...dockBtn, opacity: (analysisLoading || !centerId) ? 0.5 : 1 }}
          >
            <BarChart2 size={12} />
            {analysisLoading ? "Analyzing…" : "Analyze week"}
          </button>

          {/* Accept all proposals — converts every PENDING proposal in the
              current day/week view into a real Session. */}
          <button
            onClick={handleAcceptAll}
            disabled={acceptAllRunning || autoRunning || clearDayState === "clearing" || clearWeekState === "clearing" || !centerId}
            style={{ ...dockBtn, opacity: (acceptAllRunning || autoRunning || !centerId) ? 0.5 : 1 }}
          >
            <Check size={12} />
            {acceptAllRunning ? "Accepting…" : viewMode === "week" ? "Accept all week" : "Accept all"}
          </button>

          {/* Vertical divider */}
          <div style={{ width: 1, height: 18, background: "rgba(255,255,255,0.16)", flexShrink: 0 }} />

          {/* Auto-complete */}
          <div ref={autoDropdownRef} style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <button
              onClick={() => viewMode === "week" ? handleAutoCompleteWeek() : handleAutoComplete("whole")}
              disabled={autoRunning || clearDayState === "clearing" || clearWeekState === "clearing" || !centerId}
              style={{ ...dockBtnPrimary, opacity: (autoRunning || !centerId) ? 0.7 : 1 }}
            >
              <Sparkles size={12} />
              {autoRunning ? (autoMessage || "Scheduling…") : viewMode === "week" ? "Auto schedule week" : "Auto-complete"}
            </button>
            {viewMode === "day" && (
              <button
                onClick={() => setAutoDropdownOpen(o => !o)}
                disabled={autoRunning || !centerId}
                style={{ height: 30, width: 22, borderRadius: 7, border: "none", background: "rgba(0,0,0,0.08)", color: "var(--ata-gray-900)", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", paddingLeft: 0, opacity: (autoRunning || !centerId) ? 0.5 : 1, marginLeft: 2 }}
              >
                <ChevronDown size={10} />
              </button>
            )}
            {autoDropdownOpen && (
              <div style={{
                position: "absolute", bottom: "100%", right: 0, marginBottom: 6,
                width: 210, background: "#ffffff", border: "1px solid var(--ata-gray-300)",
                borderRadius: 8, boxShadow: "0 8px 24px rgba(15,15,12,0.18)",
                overflow: "hidden", color: "var(--ata-gray-900)",
              }}>
                <button
                  onClick={() => { setAutoDropdownOpen(false); handleAutoComplete("whole"); }}
                  style={{ width: "100%", textAlign: "left", padding: "8px 12px", background: "none", border: "none", cursor: "pointer" }}
                >
                  <div style={{ fontSize: 12, fontWeight: 500 }}>Whole Day</div>
                  <div style={{ fontSize: 11, color: "var(--ata-gray-500)", marginTop: 1 }}>Schedule all available slots for the day</div>
                </button>
                <button
                  onClick={() => { setAutoDropdownOpen(false); handleAutoComplete("rest"); }}
                  style={{ width: "100%", textAlign: "left", padding: "8px 12px", background: "none", border: "none", cursor: "pointer", borderTop: "1px solid rgba(15,15,12,0.06)" }}
                >
                  <div style={{ fontSize: 12, fontWeight: 500 }}>Rest of Day</div>
                  <div style={{ fontSize: 11, color: "var(--ata-gray-500)", marginTop: 1 }}>Only schedule slots starting after now</div>
                </button>
              </div>
            )}
          </div>

          {/* Undo — conditional, amber tint */}
          {undoDays.length > 0 && (
            <button
              onClick={handleUndo}
              disabled={autoRunning}
              style={{ ...dockBtnAmber, opacity: autoRunning ? 0.5 : 1 }}
            >
              <Undo2 size={12} />
              Undo
            </button>
          )}
        </div>
      </div>

      {/* Session modal */}
      {draft && (
        <SessionModal
          draft={draft}
          sessionTypes={sessionTypes}
          clients={clients}
          providers={providers}
          centers={centers}
          timezone={timezone}
          onClose={() => setDraft(null)}
          onSaved={() => { setDraft(null); setRefreshKey(k => k + 1); }}
        />
      )}

      {cancelTarget && (
        <CancelSessionModal
          target={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onCancelled={() => {
            const sessionId = cancelTarget.sessionId;
            setCancelTarget(null);
            setRefreshKey(k => k + 1);
            addMakeupSession(sessionId);
          }}
          onRemoved={() => { setCancelTarget(null); setRefreshKey(k => k + 1); }}
          onRestored={() => { setCancelTarget(null); setRefreshKey(k => k + 1); }}
        />
      )}

      {driveTimeTarget && (
        <DriveTimeSummaryModal
          target={driveTimeTarget}
          onClose={() => setDriveTimeTarget(null)}
        />
      )}

      {analysisData && analysisModalOpen && (
        <WeekAnalysisModal
          data={analysisData}
          onClose={() => setAnalysisModalOpen(false)}
        />
      )}

      {/* Auto-schedule results dialog */}
      {autoDialogOpen && autoMessage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setAutoDialogOpen(false)}
        >
          <div
            className="bg-background border border-border rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between px-5 pt-5 pb-3 border-b border-border shrink-0">
              <div>
                <p className="text-sm font-semibold text-foreground">{autoMessage}</p>
                {auditData && (
                  <p className={`text-xs mt-0.5 font-medium ${
                    auditData.score >= 90 ? "text-emerald-600" :
                    auditData.score >= 75 ? "text-amber-600" :
                    auditData.score >= 60 ? "text-orange-600" : "text-rose-600"
                  }`}>
                    Schedule score: {auditData.score}/100 — {auditData.scoreLabel}
                  </p>
                )}
                {auditLoading && !auditData && (
                  <p className="text-xs mt-0.5 text-muted-foreground">Analyzing schedule quality…</p>
                )}
              </div>
              <button
                onClick={() => setAutoDialogOpen(false)}
                aria-label="Close"
                className="ml-4 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X size={15} />
              </button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto px-5 py-4 space-y-4">

              {/* Audit score breakdown */}
              {auditData && (
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                    Schedule quality — week of {auditData.weekOf}
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground mb-2">
                    <span>Compliance <strong className={auditData.scoreBreakdown.compliance === 100 ? "text-emerald-600" : "text-rose-600"}>{auditData.scoreBreakdown.compliance}/100</strong></span>
                    <span>RBT utilization <strong>{auditData.scoreBreakdown.utilization}/100</strong></span>
                    <span>Client coverage <strong>{auditData.scoreBreakdown.coverage}/100</strong></span>
                    <span>Consistency <strong>{auditData.scoreBreakdown.consistency}/100</strong></span>
                  </div>
                  {auditData.topActions.length > 0 && (
                    <div className="space-y-0.5">
                      {auditData.topActions.map((action, i) => (
                        <div key={i} className="text-xs text-foreground/80">
                          <span className="text-muted-foreground mr-1">{i + 1}.</span>{action}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Compliance violations */}
              {auditData && auditData.compliance.violations.length > 0 && (
                <div>
                  <p className="text-[10px] font-medium text-rose-600 uppercase tracking-wide mb-1">
                    Compliance violations ({auditData.compliance.violations.length})
                  </p>
                  <div className="space-y-0.5">
                    {auditData.compliance.violations.map((v, i) => (
                      <div key={i} className="text-xs text-rose-700">{v.detail}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* RBT utilization */}
              {auditData && auditData.utilization.rbtProviders.length > 0 && (
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
                    RBT utilization this week ({auditData.utilization.aggregate.utilizationPct}% overall · {auditData.utilization.aggregate.hoursLeftOnTable}h unclaimed)
                  </p>
                  <div className="space-y-0.5">
                    {auditData.utilization.rbtProviders.map((r) => (
                      <div key={r.name} className="flex items-baseline gap-2 text-xs">
                        <span className="font-medium shrink-0 w-40 truncate">{r.name}</span>
                        <span className={`shrink-0 ${r.utilizationPct >= 75 ? "text-emerald-600" : r.utilizationPct >= 50 ? "text-amber-600" : "text-rose-600"}`}>
                          {r.utilizationPct}%
                        </span>
                        <span className="text-muted-foreground">{fmtHours(r.scheduledHours)} / {fmtHours(r.availableHours)} available</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Under-served clients */}
              {auditData && auditData.coverage.summary.underServed > 0 && (
                <div>
                  <p className="text-[10px] font-medium text-amber-600 uppercase tracking-wide mb-1">
                    Under-served clients ({auditData.coverage.summary.underServed} below 70% of authorized hours)
                  </p>
                  <div className="space-y-0.5">
                    {auditData.coverage.clients.filter(c => c.coveragePct < 70).map((c) => (
                      <div key={c.name} className="flex items-baseline gap-2 text-xs">
                        <span className="font-medium shrink-0 w-40 truncate">{c.name}</span>
                        <span className="text-amber-700 shrink-0">{c.coveragePct}%</span>
                        <span className="text-muted-foreground">{fmtHours(c.scheduledHours)} / {fmtHours(c.authorizedWeekly)} auth&apos;d</span>
                        {c.flags.filter(f => f.includes("expires")).map((f, i) => (
                          <span key={i} className="text-rose-600 shrink-0">{f}</span>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Optimizer warnings */}
              {autoWarnings.length > 0 && (
                <div>
                  <p className="text-[10px] font-medium text-amber-600 uppercase tracking-wide mb-1">Scheduler warnings</p>
                  <div className="space-y-0.5">
                    {autoWarnings.map((w, i) => (
                      <div key={i} className="text-xs text-amber-700">{w}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Unserved roster clients */}
              {autoUnserved.length > 0 && (
                <div>
                  <p className="text-[10px] font-medium text-destructive uppercase tracking-wide mb-1">Needs attention — on today&apos;s roster, no provider found</p>
                  <div className="space-y-0.5">
                    {autoUnserved.map(({ name, reason }) => (
                      <div key={name} className="flex items-baseline gap-2 text-xs">
                        <span className="font-medium shrink-0 text-destructive">{name}</span>
                        <span className="text-muted-foreground">{reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Unscheduled clients */}
              {autoSkips.length > 0 && (
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Unscheduled clients</p>
                  <div className="space-y-0.5">
                    {autoSkips.map(({ name, reason }) => (
                      <div key={name} className="flex items-baseline gap-2 text-xs">
                        <span className="font-medium shrink-0">{name}</span>
                        <span className="text-muted-foreground">{reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-border shrink-0 flex justify-end">
              <button
                onClick={() => setAutoDialogOpen(false)}
                className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
