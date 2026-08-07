"use client";

import { useState } from "react";
import { UserMinus, AlertTriangle } from "lucide-react";
import { deactivateProvider } from "@/lib/actions/providers";
import { navigateAfterSave } from "@/lib/navigateAfterSave";

interface DeactivateProviderButtonProps {
  providerId: string;
  providerName: string;
  /** Upcoming scheduled sessions that will be cancelled — shown in the confirm dialog. */
  upcomingSessionCount: number;
  /** Clients this provider is currently approved for — those approvals get ended. */
  approvedClientCount: number;
}

export function DeactivateProviderButton({
  providerId,
  providerName,
  upcomingSessionCount,
  approvedClientCount,
}: DeactivateProviderButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDeactivate() {
    setPending(true);
    setError(null);
    try {
      const result = await deactivateProvider(providerId);
      if (!result.success) {
        setError(result.error);
        setPending(false);
        return;
      }
      navigateAfterSave(`/providers/${providerId}`);
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
        Deactivate
      </button>

      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="deactivate-provider-title"
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
                <h2 id="deactivate-provider-title" className="text-base font-semibold">
                  Deactivate {providerName}?
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  They will no longer appear in scheduling. This also:
                </p>
                <ul className="text-sm text-muted-foreground mt-2 space-y-1 list-disc pl-5">
                  <li>
                    cancels{" "}
                    <strong>
                      {upcomingSessionCount} upcoming session
                      {upcomingSessionCount === 1 ? "" : "s"}
                    </strong>
                  </li>
                  <li>
                    ends their approval for{" "}
                    <strong>
                      {approvedClientCount} client{approvedClientCount === 1 ? "" : "s"}
                    </strong>
                  </li>
                  <li>clears their weekly availability and future time-off blocks</li>
                  <li>rejects any pending AI schedule proposals</li>
                </ul>
                <p className="text-sm text-muted-foreground mt-3">
                  Completed sessions and billing history are kept. You can bring them back by
                  setting their status to Active on the Edit page.
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
                onClick={handleDeactivate}
                disabled={pending}
              >
                {pending ? "Deactivating…" : "Yes, deactivate"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
