"use client";

import { useState, useEffect, useRef } from "react";
import { CalendarPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { bookSession, suggestProviders } from "@/lib/actions/sessions";
import type { SuggestedProvider } from "@/lib/actions/sessions";

export interface SessionDraft {
  start: Date;
  end: Date;
  sessionTypeId?: string;
  clientId?: string;
  providerId?: string;
}

interface SessionType { id: string; name: string; billable: boolean; requiresBcba: boolean }
interface Client { id: string; firstName: string; lastName: string; street: string | null; city: string | null; state: string | null; zip: string | null }
interface Provider { id: string; firstName: string; lastName: string; position: string }
interface Center { id: string; name: string }

interface SessionModalProps {
  draft: SessionDraft;
  sessionTypes: SessionType[];
  clients: Client[];
  providers: Provider[];
  centers: Center[];
  timezone: string;
  onClose: () => void;
  onSaved: () => void;
}

function toLocalDatetimeInput(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const h = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${h}:${get("minute")}`;
}

function fromLocalDatetimeInput(value: string, timezone: string): Date {
  const [datePart, timePart] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hours, minutes] = timePart.split(":").map(Number);

  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const localNoon = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(probe);
  const localHour = parseInt(localNoon.find((p) => p.type === "hour")?.value ?? "12");
  const localMinute = parseInt(localNoon.find((p) => p.type === "minute")?.value ?? "0");

  return new Date(
    Date.UTC(year, month - 1, day, 12 - (localHour === 24 ? 0 : localHour) + hours, minutes - localMinute)
  );
}

function buildAutoName(type: SessionType | undefined, client: Client | undefined): string {
  return [
    type?.name,
    client ? `${client.lastName}, ${client.firstName}` : null,
  ].filter(Boolean).join(" – ");
}

export function SessionModal({
  draft,
  sessionTypes,
  clients,
  providers,
  centers,
  timezone,
  onClose,
  onSaved,
}: SessionModalProps) {
  // Use plain useState for pending — React 18 doesn't properly track
  // async functions passed to startTransition (isPending resets immediately).
  const [isPending, setIsPending] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestedProvider[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const [sessionTypeId, setSessionTypeId] = useState(draft.sessionTypeId ?? "");
  const [clientId, setClientId] = useState(draft.clientId ?? "");
  const [providerId, setProviderId] = useState(draft.providerId ?? "");
  const [locationType, setLocationType] = useState<"HOME" | "CENTER" | "SCHOOL">("CENTER");
  const [centerId, setCenterId] = useState(() => centers.length === 1 ? centers[0].id : "");
  const [startStr, setStartStr] = useState(toLocalDatetimeInput(draft.start, timezone));
  const [endStr, setEndStr] = useState(toLocalDatetimeInput(draft.end, timezone));
  const [notes, setNotes] = useState("");

  const selectedType = sessionTypes.find((t) => t.id === sessionTypeId);
  const selectedClient = clients.find((c) => c.id === clientId);
  const selectedProvider = providers.find((p) => p.id === providerId);
  const providerIsBcba = selectedProvider?.position === "BCBA" || selectedProvider?.position === "BCaBA";
  const bcbaConflict = selectedType?.requiresBcba && providerId && !providerIsBcba;

  // ── Session name: auto-populated from type + client, editable ──────────────
  const [sessionName, setSessionName] = useState(() =>
    buildAutoName(
      sessionTypes.find((t) => t.id === draft.sessionTypeId),
      clients.find((c) => c.id === draft.clientId)
    )
  );
  // Track whether the user has manually changed the name away from the auto value.
  // If not, keep it in sync as type/client selections change.
  const lastAutoName = useRef(buildAutoName(
    sessionTypes.find((t) => t.id === draft.sessionTypeId),
    clients.find((c) => c.id === draft.clientId)
  ));

  useEffect(() => {
    const next = buildAutoName(selectedType, selectedClient);
    // Only auto-update if the user hasn't deviated from the generated name
    if (sessionName === lastAutoName.current) {
      setSessionName(next);
    }
    lastAutoName.current = next;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionTypeId, clientId]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setWarnings([]);

    if (!sessionTypeId) { setError("Session type is required."); return; }

    const startTime = fromLocalDatetimeInput(startStr, timezone);
    const endTime = fromLocalDatetimeInput(endStr, timezone);
    if (endTime <= startTime) { setError("End time must be after start time."); return; }

    if (!providerId) {
      // No provider selected — show AI suggestions instead of a hard error
      setError(null);
      setSuggestionsLoading(true);
      setSuggestions([]);
      suggestProviders({
        clientId: clientId || null,
        sessionTypeId,
        startTime,
        endTime,
        timezone,
        locationType,
      }).then((result) => {
        setSuggestionsLoading(false);
        if (!result.success) {
          setError(result.error);
        } else if (result.providers.length === 0) {
          setError("No eligible providers found for this session. Check constraints (BCBA requirement, approved list, etc.).");
        } else {
          setSuggestions(result.providers);
        }
      }).catch(() => {
        setSuggestionsLoading(false);
        setError("Could not load provider suggestions.");
      });
      return;
    }

    const name = sessionName.trim() || buildAutoName(selectedType, selectedClient) || "Session";

    setIsPending(true);
    bookSession({
      name,
      sessionTypeId,
      providerId,
      clientId: clientId || null,
      startTime,
      endTime,
      billable: selectedType?.billable ?? true,
      locationType: clientId ? locationType : undefined,
      centerId: locationType === "CENTER" ? (centerId || null) : null,
      timezone,
      notes: notes || null,
    }).then((result) => {
      setIsPending(false);
      if (!result.success) {
        // Show each specific failure reason, not just the generic message
        const detail = "failures" in result && result.failures?.length
          ? result.failures.map((f) => f.reason).join("\n")
          : result.error;
        setError(detail);
        return;
      }
      if ("warnings" in result && result.warnings.length > 0) {
        setWarnings(result.warnings.map((w) => w.reason));
        // Don't close — let the user acknowledge warnings first (Continue button shown below)
        return;
      }
      onSaved();
    }).catch(() => {
      setIsPending(false);
      setError("Failed to book session. Please try again.");
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(6, 21, 41, 0.58)", backdropFilter: "blur(2px)", padding: 24 }}
    >
      <div
        className="w-full mx-4"
        style={{
          maxWidth: 560,
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
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start", minWidth: 0 }}>
            <span
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: "var(--ata-blue-50)",
                color: "var(--ata-blue-600)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flex: "0 0 auto",
              }}
              aria-hidden
            >
              <CalendarPlus size={20} />
            </span>
            <div style={{ minWidth: 0 }}>
              <h2
                style={{
                  fontSize: 20,
                  lineHeight: "28px",
                  fontWeight: 700,
                  color: "var(--ata-gray-900)",
                  margin: 0,
                }}
              >
                New Session
              </h2>
              <p
                style={{
                  fontSize: 14,
                  lineHeight: "20px",
                  color: "var(--ata-gray-600)",
                  margin: "4px 0 0",
                }}
              >
                Create a new session on the schedule
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

        <form
          onSubmit={handleSubmit}
          style={{
            padding: "0 28px 24px",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive space-y-0.5">
              {error.split("\n").map((line, i) => (
                <p key={i}>{i > 0 ? `• ${line}` : line}</p>
              ))}
            </div>
          )}
          {warnings.length > 0 && (
            <div className="space-y-2">
              {warnings.map((w, i) => (
                <div key={i} className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                  {w}
                </div>
              ))}
              <div className="flex items-center gap-2 pt-1">
                <Button type="button" className="flex-1" onClick={onSaved}>
                  Continue anyway
                </Button>
                <Button type="button" variant="outline" onClick={() => setWarnings([])}>
                  Go back
                </Button>
              </div>
            </div>
          )}

          {/* Session Type */}
          <div className="space-y-1.5">
            <Label>Session Type</Label>
            <Select value={sessionTypeId} onValueChange={(v) => setSessionTypeId(v ?? "")}>
              <SelectTrigger><SelectValue placeholder="Select type…" /></SelectTrigger>
              <SelectContent>
                {sessionTypes.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <span className="flex items-center gap-2">
                      {t.name}
                      {t.requiresBcba && <span className="text-[10px] font-semibold text-violet-600">BCBA only</span>}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Client */}
          <div className="space-y-1.5">
            <Label>Client <span className="text-muted-foreground font-normal">(optional for non-billable)</span></Label>
            <Select value={clientId} onValueChange={(v) => setClientId(v ?? "")}>
              <SelectTrigger><SelectValue placeholder="Select client…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">— None —</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.lastName}, {c.firstName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Session Name — auto-populated from type + client, editable */}
          <div className="space-y-1.5">
            <Label>Session Name</Label>
            <Input
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder="Auto-generated from session type and client"
            />
          </div>

          {/* Location — only shown when a client is selected */}
          {clientId && (
            <div className="space-y-1.5">
              <Label>Location</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setLocationType("CENTER")}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border text-xs font-medium transition-colors ${
                    locationType === "CENTER"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card hover:bg-muted text-foreground"
                  }`}
                >
                  <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="1" y="6" width="14" height="9" rx="1" />
                    <path d="M5 15V10h6v5" />
                    <path d="M0 6l8-5 8 5" />
                  </svg>
                  Center
                </button>
                <button
                  type="button"
                  onClick={() => setLocationType("HOME")}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border text-xs font-medium transition-colors ${
                    locationType === "HOME"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card hover:bg-muted text-foreground"
                  }`}
                >
                  <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 6l7-5 7 5v9a1 1 0 01-1 1H2a1 1 0 01-1-1V6z" />
                    <path d="M5 15V9h6v6" />
                  </svg>
                  Client Home
                </button>
                <button
                  type="button"
                  onClick={() => setLocationType("SCHOOL")}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border text-xs font-medium transition-colors ${
                    locationType === "SCHOOL"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card hover:bg-muted text-foreground"
                  }`}
                >
                  <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="5" width="10" height="9" rx="1" />
                    <path d="M5 5V3h6v2" />
                    <path d="M6 9h4" />
                  </svg>
                  School
                </button>
              </div>

              {/* Center selector — shown when CENTER is active */}
              {locationType === "CENTER" && centers.length > 0 && (
                <Select value={centerId} onValueChange={(v) => setCenterId(v ?? "")}>
                  <SelectTrigger><SelectValue placeholder="Select center…" /></SelectTrigger>
                  <SelectContent>
                    {centers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {/* Client home address */}
              {locationType === "HOME" && selectedClient && (selectedClient.street || selectedClient.city) && (
                <p className="text-[11px] text-muted-foreground px-0.5">
                  {[selectedClient.street, selectedClient.city, selectedClient.state, selectedClient.zip].filter(Boolean).join(", ")}
                </p>
              )}
              {locationType === "HOME" && selectedClient && !selectedClient.street && !selectedClient.city && (
                <p className="text-[11px] text-amber-600 px-0.5">No address on file for this client.</p>
              )}
            </div>
          )}

          {/* Provider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Provider</Label>
              <button
                type="button"
                disabled={!sessionTypeId || suggestionsLoading || isPending}
                onClick={() => {
                  if (!sessionTypeId) { setError("Select a session type first."); return; }
                  setSuggestionsLoading(true);
                  setSuggestions([]);
                  setError(null);
                  suggestProviders({
                    clientId: clientId || null,
                    sessionTypeId,
                    startTime: fromLocalDatetimeInput(startStr, timezone),
                    endTime: fromLocalDatetimeInput(endStr, timezone),
                    timezone,
                    locationType,
                  }).then((result) => {
                    setSuggestionsLoading(false);
                    if (!result.success) setError(result.error);
                    else if (result.providers.length === 0) setError("No eligible providers found.");
                    else setSuggestions(result.providers);
                  }).catch(() => {
                    setSuggestionsLoading(false);
                    setError("Could not load suggestions.");
                  });
                }}
                className="text-[11px] text-primary hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {suggestionsLoading ? "Finding…" : "Find best match"}
              </button>
            </div>
            <Select value={providerId} onValueChange={(v) => { setProviderId(v ?? ""); setSuggestions([]); }}>
              <SelectTrigger><SelectValue placeholder="Select provider…" /></SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.lastName}, {p.firstName} <span className="text-muted-foreground">({p.position})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Provider suggestions */}
            {suggestions.length > 0 && (
              <div className="space-y-1 pt-1">
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Suggested matches</p>
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => { setProviderId(s.id); setSuggestions([]); }}
                    className="w-full text-left px-2.5 py-2 rounded-md border border-border hover:bg-muted transition-colors"
                  >
                    <div className="text-xs font-medium">{s.lastName}, {s.firstName} <span className="text-muted-foreground font-normal">({s.position})</span></div>
                    {s.reason && <div className="text-[10px] text-muted-foreground mt-0.5">{s.reason}</div>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {bcbaConflict && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
              {selectedType?.name} requires a BCBA or BCaBA. The selected provider is not qualified for this session type.
            </div>
          )}

          {/* Times */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Start</Label>
              <Input
                type="datetime-local"
                value={startStr}
                onChange={(e) => setStartStr(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>End</Label>
              <Input
                type="datetime-local"
                value={endStr}
                onChange={(e) => setEndStr(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label>Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any notes…"
            />
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" disabled={isPending} className="flex-1">
              {isPending ? "Saving…" : "Book Session"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
