"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, CalendarPlus, Clock, ChevronDown, ChevronUp, X, Loader2, Check } from "lucide-react";
import { fetchMakeupSuggestions, bookMakeupSession } from "@/lib/actions/makeupSuggestions";
import type { MakeupSuggestionsResult, MakeupSuggestion } from "@/lib/queries/makeupSuggestions";

interface Props {
  sessionIds: string[];
  onDismiss: (sessionId: string) => void;
  onBooked?: () => void;
}

export function MakeupNotificationsDropdown({ sessionIds, onDismiss, onBooked }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`relative flex items-center justify-center w-7 h-7 rounded-lg border transition-colors ${
          sessionIds.length > 0
            ? "border-amber-300 hover:bg-amber-50 text-amber-700"
            : "border-border hover:bg-muted text-muted-foreground"
        }`}
        aria-label="Make-up hour suggestions"
      >
        <Bell size={13} />
        {sessionIds.length > 0 && (
          <span className="absolute -top-1 -right-1 flex items-center justify-center w-3.5 h-3.5 rounded-full bg-amber-500 text-[9px] font-bold text-white leading-none">
            {sessionIds.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 bg-popover border border-border rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-border flex items-center justify-between">
            <span className="text-xs font-medium">Make-up Hour Suggestions</span>
            <span className="text-[11px] text-muted-foreground">{sessionIds.length} pending</span>
          </div>
          <div className="max-h-[420px] overflow-y-auto divide-y divide-border">
            {sessionIds.length === 0 ? (
              <p className="px-3 py-4 text-xs text-muted-foreground text-center">
                No pending make-up suggestions
              </p>
            ) : (
              sessionIds.map((id) => (
                <NotificationItem key={id} sessionId={id} onDismiss={() => onDismiss(id)} onBooked={onBooked} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationItem({
  sessionId,
  onDismiss,
  onBooked,
}: {
  sessionId: string;
  onDismiss: () => void;
  onBooked?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<MakeupSuggestionsResult | null>(null);
  const [fetched, setFetched] = useState(false);

  function handleExpand() {
    if (!expanded && !fetched) {
      setLoading(true);
      fetchMakeupSuggestions(sessionId).then((r) => {
        setResult(r);
        setLoading(false);
        setFetched(true);
      });
    }
    setExpanded((v) => !v);
  }

  function handleBooked(suggestion: MakeupSuggestion) {
    // Optimistically refresh suggestions after a booking
    if (result) {
      setResult({ ...result, suggestions: result.suggestions.filter((s) => s !== suggestion) });
    }
    onBooked?.();
  }

  const clientName = result?.clientName ?? "Client";
  const suggestionCount = result?.suggestions.length ?? 0;

  return (
    <div className="px-3 py-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <button
          onClick={handleExpand}
          className="flex-1 flex items-center gap-2 text-left min-w-0"
        >
          <CalendarPlus size={12} className="text-amber-600 shrink-0" />
          <div className="flex-1 min-w-0">
            {loading ? (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 size={11} className="animate-spin" />
                Loading suggestions…
              </span>
            ) : fetched ? (
              <div>
                <p className="text-xs font-medium truncate">{clientName}</p>
                <p className="text-[11px] text-muted-foreground">
                  {suggestionCount > 0
                    ? `${suggestionCount} window${suggestionCount !== 1 ? "s" : ""} available this week`
                    : "No windows available this week"}
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Tap to load suggestions</p>
            )}
          </div>
          {fetched && suggestionCount > 0 && (
            <span className="text-muted-foreground shrink-0">
              {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </span>
          )}
        </button>
        <button
          onClick={onDismiss}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
          aria-label="Dismiss"
        >
          <X size={13} />
        </button>
      </div>

      {expanded && fetched && result && (
        <div className="space-y-1.5 pl-4">
          {result.authHeadroom <= 0 ? (
            <p className="text-[11px] text-muted-foreground">No auth headroom remaining this week.</p>
          ) : suggestionCount === 0 ? (
            <p className="text-[11px] text-muted-foreground">No available windows found.</p>
          ) : (
            result.suggestions.map((s, i) => (
              <SuggestionRow key={i} suggestion={s} result={result} onBooked={() => handleBooked(s)} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function SuggestionRow({
  suggestion,
  result,
  onBooked,
}: {
  suggestion: MakeupSuggestion;
  result: MakeupSuggestionsResult;
  onBooked: () => void;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const isNew = suggestion.type === "NEW_SESSION";
  const isExtend = suggestion.type === "EXTEND_LATER";

  function handleBook() {
    if (status !== "idle") return;
    setStatus("loading");
    setError(null);
    bookMakeupSession(result, suggestion).then((r) => {
      if (r.success) {
        setStatus("success");
        setTimeout(() => onBooked(), 800);
      } else {
        setStatus("error");
        setError(r.error ?? "Failed to book session.");
      }
    }).catch(() => {
      setStatus("error");
      setError("Failed to book session.");
    });
  }

  return (
    <button
      type="button"
      onClick={handleBook}
      disabled={status !== "idle"}
      className={`w-full text-left flex items-start gap-1.5 rounded px-2 py-1.5 transition-colors ${
        status === "success"
          ? "bg-green-50 border border-green-200"
          : status === "error"
          ? "bg-destructive/10 border border-destructive/20"
          : "bg-muted/60 hover:bg-muted border border-transparent hover:border-border cursor-pointer"
      }`}
    >
      {status === "loading" ? (
        <Loader2 size={11} className="text-muted-foreground mt-0.5 shrink-0 animate-spin" />
      ) : status === "success" ? (
        <Check size={11} className="text-green-600 mt-0.5 shrink-0" />
      ) : isNew ? (
        <CalendarPlus size={11} className="text-primary mt-0.5 shrink-0" />
      ) : (
        <Clock size={11} className="text-amber-600 mt-0.5 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium leading-snug">
          {status === "success"
            ? "Booked!"
            : isNew
            ? `Add session — ${suggestion.dayLabel}`
            : isExtend
            ? `Extend ${suggestion.dayLabel}'s session`
            : `Start earlier — ${suggestion.dayLabel}`}
        </p>
        {status === "error" && error ? (
          <p className="text-[10px] text-destructive leading-snug mt-0.5">{error}</p>
        ) : status !== "success" ? (
          <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">
            {suggestion.suggestionText.split("—").slice(1).join("—").trim()}
          </p>
        ) : null}
      </div>
      {status === "idle" && (
        <span className="text-[9px] text-primary font-medium shrink-0 mt-0.5 uppercase tracking-wide">
          Apply
        </span>
      )}
    </button>
  );
}
