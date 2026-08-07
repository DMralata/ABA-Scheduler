"use client";

import { useState } from "react";
import { UserMinus, AlertTriangle } from "lucide-react";
import { deactivateClient } from "@/lib/actions/clients";
import { navigateAfterSave } from "@/lib/navigateAfterSave";

interface DischargeClientButtonProps {
  clientId: string;
  clientName: string;
  /** Upcoming scheduled sessions that will be cancelled — shown in the confirm dialog. */
  upcomingSessionCount: number;
}

export function DischargeClientButton({
  clientId,
  clientName,
  upcomingSessionCount,
}: DischargeClientButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDischarge() {
    setPending(true);
    setError(null);
    try {
      const result = await deactivateClient(clientId);
      if (!result.success) {
        setError(result.error);
        setPending(false);
        return;
      }
      // Full reload so the status badge, session list and roster counts all reflect
      // the discharge (see navigateAfterSave for why this isn't router.push).
      navigateAfterSave(`/clients/${clientId}`);
    } catch {
      setError("Something went wrong. Please try again.");
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="ata-btn ata-btn--secondary"
        style={{ color: "var(--ata-danger, #DC2626)", borderColor: "rgba(220,38,38,0.35)" }}
        onClick={() => setConfirming(true)}
      >
        <UserMinus size={16} />
        Discharge
      </button>

      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="discharge-title"
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(6, 21, 41, 0.58)", backdropFilter: "blur(2px)", padding: 24 }}
          onClick={() => !pending && setConfirming(false)}
        >
          <div
            className="w-full mx-4"
            style={{
              maxWidth: 460,
              background: "#FFFFFF",
              borderRadius: 20,
              boxShadow: "var(--shadow-modal)",
              padding: 24,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                style={{
                  display: "inline-flex",
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(220,38,38,0.10)",
                  color: "#DC2626",
                  flex: "0 0 auto",
                }}
              >
                <AlertTriangle size={20} />
              </span>
              <div style={{ minWidth: 0 }}>
                <h2 id="discharge-title" className="text-base font-semibold">
                  Discharge {clientName}?
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  This sets their termination date to today and:
                </p>
                <ul className="text-sm text-muted-foreground mt-2 space-y-1 list-disc pl-5">
                  <li>
                    cancels{" "}
                    <strong>
                      {upcomingSessionCount} upcoming session
                      {upcomingSessionCount === 1 ? "" : "s"}
                    </strong>
                  </li>
                  <li>ends their approved home-provider assignments</li>
                  <li>rejects any pending AI schedule proposals</li>
                </ul>
                <p className="text-sm text-muted-foreground mt-3">
                  Their history is kept. You can undo this by clearing the termination date
                  on the Edit page.
                </p>
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-destructive/30 bg-red-50 px-3 py-2 text-sm text-destructive mt-4">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 mt-5">
              <button
                type="button"
                className="ata-btn ata-btn--secondary"
                onClick={() => setConfirming(false)}
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ata-btn"
                style={{ background: "#DC2626", color: "#FFFFFF", borderColor: "#DC2626" }}
                onClick={handleDischarge}
                disabled={pending}
              >
                {pending ? "Discharging…" : "Yes, discharge"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
