import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// ─── Legacy color system (kept for backward compat) ───────────────────────────
// DRIVE_TIME_COLOR is still used for drive block rendering in ResourceTimeline.
export const DRIVE_TIME_COLOR = "#64748b"; // slate-500

const SESSION_TYPE_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#06b6d4",
  "#f97316", "#ec4899", "#84cc16", "#14b8a6", "#a855f7",
  "#4f46e5", "#0ea5e9", "#22c55e", "#d946ef", "#fb923c", "#38bdf8",
];

export function getSessionTypeColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return SESSION_TYPE_COLORS[hash % SESSION_TYPE_COLORS.length];
}

// ─── V2 OKLCH color system ────────────────────────────────────────────────────
// Session types are identified by hue only (perceptually uniform via OKLCH).
// Hue values from design/schedule-data.jsx. Unknown names get a hash-derived hue.
const SESSION_TYPE_HUES: Record<string, number> = {
  "admin":                215,
  "assessment":           195,
  "break":                145,
  "direct therapy":       265,
  "direct therapy home":  230,
  "drive time":            35,
  "lunch":                 90,
  "nap":                  280,
  "parent training":      320,
  "supervision":          175,
};

export function getSessionTypeHue(name: string): number {
  const key = name.toLowerCase().trim();
  if (key in SESSION_TYPE_HUES) return SESSION_TYPE_HUES[key];
  // Fallback: spread unknown types evenly around the color wheel
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return hash % 360;
}

/** 2px left-border accent on a session block */
export function getSessionTypeAccent(name: string): string {
  return `oklch(58% 0.12 ${getSessionTypeHue(name)})`;
}

/** Light-tone swatch background for the palette */
export function getSessionTypeSwatchBg(name: string): string {
  return `oklch(95% 0.022 ${getSessionTypeHue(name)})`;
}

/** Swatch border for the palette */
export function getSessionTypeSwatchBorder(name: string): string {
  return `oklch(58% 0.13 ${getSessionTypeHue(name)})`;
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ─── Week Boundaries ──────────────────────────────────────────────────────────
// Returns the start (Sunday midnight) and end (next Sunday midnight) of the
// calendar week containing `date`, expressed as UTC timestamps but anchored to
// the practice's local timezone.
//
// WHY: insurance payers enforce weekly hour limits against the practice's local
// calendar week, not UTC. A session at 11 pm ET on Saturday is still that week
// in ET even though it falls in the next UTC week.
//
// Algorithm: find Sunday midnight in the target timezone by computing the UTC
// offset at noon UTC of that Sunday (noon avoids DST transitions, which occur
// at 2 am), then subtracting that offset from noon UTC to land on local midnight.

const CANCELLATION_REASON_LABELS: Record<string, string> = {
  SICK:               "Sick",
  FAMILY_EMERGENCY:   "Family emergency",
  TRANSPORTATION:     "Transportation",
  VACATION:           "Vacation / travel",
  PROVIDER_CALLOUT:   "Provider call-out",
  WEATHER:            "Weather",
  SCHOOL_CONFLICT:    "School conflict",
  NO_SHOW:            "No Show",
  REST_OF_DAY:        "Rest of day cancelled",
  CLIENT_DEACTIVATED: "Client deactivated",
  OTHER:              "Other",
};

// Converts stored cancellation reason values (e.g. "SICK", "NO_SHOW") to
// human-readable labels. Handles already-formatted values gracefully.
export function formatCancellationReason(reason: string): string {
  return CANCELLATION_REASON_LABELS[reason.toUpperCase().replace(/ /g, "_")]
    ?? reason.charAt(0).toUpperCase() + reason.slice(1).toLowerCase().replace(/_/g, " ");
}

export function getWeekBoundaries(
  date: Date,
  timezone: string
): { weekStart: Date; weekEnd: Date } {
  // Step 1: Get the calendar date of `date` in the target timezone ("YYYY-MM-DD")
  const localDateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

  // Step 2: Find the day of week (0 = Sunday) for that local date.
  // Use noon UTC of the date string — safe across all real-world timezone offsets.
  const noonForDate = new Date(localDateStr + "T12:00:00Z");
  const dayOfWeek = noonForDate.getUTCDay();

  // Step 3: Compute the date string for the Sunday that starts this week.
  const sundayNoon = new Date(noonForDate);
  sundayNoon.setUTCDate(sundayNoon.getUTCDate() - dayOfWeek);
  const sundayDateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(sundayNoon); // "YYYY-MM-DD" of Sunday in UTC (same date as sundayNoon)

  // Step 4: Find the UTC time that equals midnight of Sunday in the target timezone.
  // At noon UTC of Sunday, the local time is HH:MM:SS. Subtracting that offset
  // from noon UTC gives local midnight.
  const sundayNoonUTC = new Date(sundayDateStr + "T12:00:00Z");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(sundayNoonUTC);

  const h = parseInt(parts.find((p) => p.type === "hour")!.value);
  const m = parseInt(parts.find((p) => p.type === "minute")!.value);
  const s = parseInt(parts.find((p) => p.type === "second")!.value);
  const offsetMs = (h === 24 ? 0 : h) * 3_600_000 + m * 60_000 + s * 1_000;

  const weekStart = new Date(sundayNoonUTC.getTime() - offsetMs);
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 3_600_000);

  return { weekStart, weekEnd };
}
