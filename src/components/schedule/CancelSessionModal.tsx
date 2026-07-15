"use client";

import { useState } from "react";
import { X, AlertTriangle, CalendarX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cancelSession, cancelRestOfDay } from "@/lib/actions/cancellations";
import { removeSession, uncancelSession } from "@/lib/actions/sessions";

export interface CancelTarget {
  sessionId: string;
  title: string;        // e.g. "Smith, John"
  sessionTypeName: string;
  startLabel: string;   // pre-formatted local time string
  status: string;       // "SCHEDULED" | "CANCELLED" | etc.
  cancelledBy?: string | null;
  providerId?: string | null;
  clientId?: string | null;
  startTime?: string | null; // ISO string
  viewContext?: "CLIENT" | "PROVIDER" | null; // which entity row was clicked
}

// Reason taxonomy - values are stored on the session and aggregated by the
// dashboard, so they must stay stable codes (labels can change freely).
const CANCEL_REASONS: { value: string; label: string }[] = [
  { value: "SICK",             label: "Sick" },
  { value: "FAMILY_EMERGENCY", label: "Family emergency" },
  { value: "TRANSPORTATION",   label: "Transportation" },
  { value: "VACATION",         label: "Vacation / travel" },
  { value: "PROVIDER_CALLOUT", label: "Provider call-out" },
  { value: "WEATHER",          label: "Weather" },
  { value: "SCHOOL_CONFLICT",  label: "School conflict" },
  { value: "OTHER",            label: "Other" },
];

interface CancelSessionModalProps {
  target: CancelTarget;
  onClose: () => void;
  onCancelled: () => void;
  onRemoved: () => void;
  onRestored: () => void;
}

export function CancelSessionModal({ target, onClose, onCancelled, onRemoved, onRestored }: CancelSessionModalProps) {
  const [cancelledBy, setCancelledBy] = useState<"CLIENT" | "PROVIDER" | "">(target.viewContext ?? "");
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [isCancelDayPending, setIsCancelDayPending] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCancelled = target.status === "CANCELLED";
  const anyPending = isPending || isCancelDayPending || isRemoving || isRestoring;

  function handleRestore() {
    setError(null);
    setIsRestoring(true);
    uncancelSession(target.sessionId).then((result) => {
      setIsRestoring(false);
      if (!result.success) setError(result.error);
      else onRestored();
    }).catch(() => {
      setIsRestoring(false);
      setError("Failed to restore session. Please try again.");
    });
  }

  function handleConfirm() {
    if (!cancelledBy) { setError("Select who cancelled the session."); return; }
    if (!reason) { setError("Select a cancellation reason."); return; }
    setError(null);
    setIsPending(true);
    cancelSession(target.sessionId, cancelledBy as "CLIENT" | "PROVIDER", reason, note).then((result) => {
      setIsPending(false);
      if (!result.success) {
        setError(result.error);
      } else {
        onCancelled();
      }
    }).catch(() => {
      setIsPending(false);
      setError("Failed to cancel session. Please try again.");
    });
  }

  function handleCancelDay() {
    if (!cancelledBy) { setError("Select who cancelled before blocking the day."); return; }
    setError(null);
    setIsCancelDayPending(true);
    cancelRestOfDay(target.sessionId, cancelledBy as "CLIENT" | "PROVIDER").then((result) => {
      setIsCancelDayPending(false);
      if (!result.success) {
        setError(result.error);
      } else {
        onCancelled();
      }
    }).catch(() => {
      setIsCancelDayPending(false);
      setError("Failed to block rest of day. Please try again.");
    });
  }

  function handleRemove() {
    setError(null);
    setIsRemoving(true);
    removeSession(target.sessionId).then((result) => {
      setIsRemoving(false);
      if (!result.success) {
        setError(result.error);
      } else {
        onRemoved();
      }
    }).catch(() => {
      setIsRemoving(false);
      setError("Failed to remove session. Please try again.");
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(6, 21, 41, 0.58)", backdropFilter: "blur(2px)", padding: 24 }}
      onMouseDown={(e) => {
        if (anyPending) return;
        if (e.target === e.currentTarget) onClose();
      }}
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
                background: isCancelled ? "var(--ata-blue-50)" : "var(--ata-danger-50)",
                color: isCancelled ? "var(--ata-blue-600)" : "var(--ata-danger-600)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flex: "0 0 auto",
              }}
              aria-hidden
            >
              <AlertTriangle size={20} />
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
                {isCancelled ? "Cancelled Session" : "Cancel Session"}
              </h2>
              <p
                style={{
                  fontSize: 14,
                  lineHeight: "20px",
                  color: "var(--ata-gray-600)",
                  margin: "4px 0 0",
                }}
              >
                {isCancelled
                  ? "Restore the session, or remove it permanently."
                  : "Mark this session as cancelled and trigger any follow-up steps."}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={anyPending}
            aria-label="Close"
            className="ata-icon-button"
            style={{ opacity: anyPending ? 0.4 : 1 }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: "0 28px 24px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Session info */}
          <div
            style={{
              padding: "14px 16px",
              borderRadius: 14,
              background: "var(--ata-blue-25)",
              border: "1px solid var(--ata-blue-100)",
            }}
          >
            <p style={{ fontSize: 14, fontWeight: 700, color: "var(--ata-gray-900)", margin: 0 }}>
              {target.title}
            </p>
            <p style={{ fontSize: 12, color: "var(--ata-gray-600)", margin: "4px 0 0" }}>
              {target.sessionTypeName} · {target.startLabel}
            </p>
            {isCancelled && target.cancelledBy && (
              <p style={{ fontSize: 12, color: "var(--ata-warning-600)", margin: "4px 0 0", fontWeight: 600 }}>
                Cancelled by{" "}
                {{ CLIENT: "Client", PROVIDER: "Provider" }[target.cancelledBy] ?? target.cancelledBy}
              </p>
            )}
          </div>

          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {isCancelled ? (
            // ── Restore view ──────────────────────────────────────────────────
            <>
              <p className="text-xs text-muted-foreground">
                Restoring this session will mark it as scheduled again. The session type will be reset to Direct Therapy — verify the details after restoring.
              </p>
              <div className="flex items-center gap-3 pt-1">
                <Button
                  type="button"
                  disabled={isRestoring}
                  className="flex-1"
                  onClick={handleRestore}
                >
                  {isRestoring ? "Restoring…" : "Restore Session"}
                </Button>
                <Button type="button" variant="outline" onClick={onClose} disabled={isRestoring}>
                  Close
                </Button>
              </div>
              <div className="pt-1 border-t border-border">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={isRestoring || isRemoving}
                  className="w-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 text-xs"
                  onClick={handleRemove}
                >
                  {isRemoving ? "Removing…" : "Remove Session Permanently"}
                </Button>
              </div>
            </>
          ) : (
            // ── Cancel form ───────────────────────────────────────────────────
            <>
              {/* Cancelled by */}
              <div className="space-y-1.5">
                <Label>Cancelled by</Label>
                {/* viewContext only pre-selects - both options stay clickable so a
                    session opened from a client row can still be marked as a
                    provider cancellation (and vice versa). */}
                <div className="flex gap-2">
                    {(["CLIENT", "PROVIDER"] as const).map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setCancelledBy(val)}
                        className={`flex-1 py-2 rounded-md border text-xs font-medium transition-colors ${
                          cancelledBy === val
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-card hover:bg-muted text-foreground"
                        }`}
                      >
                        {val === "CLIENT" ? "Client" : "Provider"}
                      </button>
                    ))}
                </div>
              </div>

              {/* Reason */}
              <div className="space-y-1.5">
                <Label>Reason</Label>
                <Select value={reason} onValueChange={(v) => setReason((v as string) ?? "")}>
                  <SelectTrigger>
                    <span className={reason ? "" : "text-muted-foreground"}>
                      {CANCEL_REASONS.find((r) => r.value === reason)?.label ?? "Select reason…"}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {CANCEL_REASONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Optional note - stored on the session, not in the reason category */}
              <div className="space-y-1.5">
                <Label>Note <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="Any detail worth keeping (e.g. flu, car trouble)…"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                />
              </div>

              <div className="flex items-center gap-3 pt-1">
                <Button
                  type="button"
                  variant="destructive"
                  disabled={anyPending}
                  className="flex-1"
                  onClick={handleConfirm}
                >
                  {isPending ? "Cancelling…" : "Cancel Session"}
                </Button>
                <Button type="button" variant="outline" onClick={onClose} disabled={anyPending}>
                  Keep
                </Button>
              </div>

              {/* Cancel Day — only shown once cancelledBy is selected */}
              {cancelledBy && (
                <div className="pt-1 border-t border-border">
                  <Button
                    type="button"
                    disabled={anyPending}
                    onClick={handleCancelDay}
                    className="w-full bg-red-100 hover:bg-red-200 text-red-700 border border-red-200 text-xs font-medium flex items-center gap-2 justify-center"
                    variant="ghost"
                  >
                    <CalendarX size={13} />
                    {isCancelDayPending
                      ? "Blocking day…"
                      : `Cancel ${cancelledBy === "PROVIDER" ? "Provider's" : "Client's"} Rest of Day`}
                  </Button>
                  <p className="text-[10px] text-muted-foreground text-center mt-1">
                    Cancels all remaining sessions and blocks the schedule from this time forward
                  </p>
                </div>
              )}

              <div className="pt-1 border-t border-border">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={anyPending}
                  className="w-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 text-xs"
                  onClick={handleRemove}
                >
                  {isRemoving ? "Removing…" : "Remove Session Without Cancelling"}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
