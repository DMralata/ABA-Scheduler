"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, XCircle, Sparkles, Clock, ChevronDown, ChevronUp } from "lucide-react";
import { approveProposedSession, rejectProposedSession } from "@/lib/actions/scheduler";

// This component handles both:
// 1. Triggering the AI scheduler (when centerId + weekOf are provided but no proposals exist)
// 2. Displaying pending proposals for review

interface Proposal {
  id: string;
  clientId: string;
  client: { id: string; firstName: string; lastName: string };
  provider: { id: string; firstName: string; lastName: string; position: string };
  sessionType: { name: string };
  authorization: { approvedHoursPerWeek: number; fundingSource: string | null } | null;
  startTime: Date;
  endTime: Date;
  timezone: string | null;
  reasoning: string | null;
  status: string;
}

interface ProposalViewProps {
  weekOf?: string;
  centerId?: string;
  timezone?: string;
  initialProposals?: Proposal[];
}

function formatLocalTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function sessionDurationHours(start: Date, end: Date): string {
  const mins = (end.getTime() - start.getTime()) / 60_000;
  if (mins % 60 === 0) return `${mins / 60}h`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function ProposalCard({
  proposal,
  timezone,
  isPending,
  onApprove,
  onReject,
}: {
  proposal: Proposal;
  timezone: string;
  isPending: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const [showReasoning, setShowReasoning] = useState(false);

  const startTime = new Date(proposal.startTime);
  const endTime = new Date(proposal.endTime);

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold">
              {proposal.client.lastName}, {proposal.client.firstName}
            </span>
            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {proposal.sessionType.name}
            </span>
          </div>

          <p className="text-xs text-muted-foreground mb-1">
            Provider: {proposal.provider.lastName}, {proposal.provider.firstName}{" "}
            <span className="text-muted-foreground/60">({proposal.provider.position})</span>
          </p>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock size={11} />
              {formatLocalTime(startTime, timezone)}
            </span>
            <span>·</span>
            <span>{sessionDurationHours(startTime, endTime)}</span>
            {proposal.authorization?.fundingSource && (
              <>
                <span>·</span>
                <span>{proposal.authorization.fundingSource}</span>
              </>
            )}
          </div>

          {proposal.reasoning && (
            <button
              onClick={() => setShowReasoning((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-2 transition-colors"
            >
              {showReasoning ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              {showReasoning ? "Hide reasoning" : "Show reasoning"}
            </button>
          )}

          {showReasoning && proposal.reasoning && (
            <p className="mt-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-3 leading-relaxed">
              {proposal.reasoning}
            </p>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onReject(proposal.id)}
            disabled={isPending}
            title="Reject"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-destructive border border-destructive/30 hover:bg-destructive/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <XCircle size={13} />
            Reject
          </button>
          <button
            onClick={() => onApprove(proposal.id)}
            disabled={isPending}
            title="Approve"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-green-600 hover:bg-green-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <CheckCircle size={13} />
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProposalView({ weekOf, centerId, timezone = "America/New_York", initialProposals }: ProposalViewProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [proposals, setProposals] = useState<Proposal[]>(initialProposals ?? []);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());
  const [rejectedIds, setRejectedIds] = useState<Set<string>>(new Set());
  // Per-proposal in-flight tracking — prevents double-submit on approve/reject
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const weekOfDate = weekOf ? new Date(weekOf) : null;

  async function handleGenerate() {
    if (!centerId || !weekOf) {
      setGenerateError("Missing centerId or weekOf — cannot generate schedule.");
      return;
    }

    setGenerating(true);
    setGenerateError(null);

    try {
      const res = await fetch("/api/scheduler/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: weekOf, centerId }),
      });

      const data = await res.json();
      if (!res.ok) {
        setGenerateError(data.error ?? "Failed to generate schedule.");
        return;
      }

      // Refresh proposals from server
      router.refresh();

      // After generating, load proposals
      const refreshed = await fetch(
        `/api/scheduler/proposals?weekOf=${weekOf}`,
        { cache: "no-store" }
      );
      if (refreshed.ok) {
        const refreshedData = await refreshed.json();
        setProposals(refreshedData.proposals ?? []);
      }
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setGenerating(false);
    }
  }

  function handleApprove(proposalId: string) {
    setPendingIds((prev) => new Set([...prev, proposalId]));
    approveProposedSession(proposalId)
      .then((result) => {
        if (result.success) {
          setApprovedIds((prev) => new Set([...prev, proposalId]));
          setProposals((prev) => prev.filter((p) => p.id !== proposalId));
        } else {
          setActionErrors((prev) => ({ ...prev, [proposalId]: result.error }));
        }
      })
      .catch(() => {
        setActionErrors((prev) => ({ ...prev, [proposalId]: "Failed to approve. Please try again." }));
      })
      .finally(() => {
        setPendingIds((prev) => { const s = new Set(prev); s.delete(proposalId); return s; });
      });
  }

  function handleReject(proposalId: string) {
    setPendingIds((prev) => new Set([...prev, proposalId]));
    rejectProposedSession(proposalId)
      .then((result) => {
        if (result.success) {
          setRejectedIds((prev) => new Set([...prev, proposalId]));
          setProposals((prev) => prev.filter((p) => p.id !== proposalId));
        } else {
          setActionErrors((prev) => ({ ...prev, [proposalId]: result.error }));
        }
      })
      .catch(() => {
        setActionErrors((prev) => ({ ...prev, [proposalId]: "Failed to reject. Please try again." }));
      })
      .finally(() => {
        setPendingIds((prev) => { const s = new Set(prev); s.delete(proposalId); return s; });
      });
  }

  // Process approvals sequentially so each ATI re-check inside the transaction
  // sees the committed state of the previous approval — prevents concurrent
  // requests from both passing the weekly hours check on stale data.
  async function handleApproveAll() {
    setIsPending(true);
    for (const proposal of [...proposals]) {
      const result = await approveProposedSession(proposal.id);
      if (result.success) {
        setApprovedIds((prev) => new Set([...prev, proposal.id]));
        setProposals((prev) => prev.filter((p) => p.id !== proposal.id));
      } else {
        setActionErrors((prev) => ({ ...prev, [proposal.id]: result.error }));
      }
    }
    setIsPending(false);
  }

  const pendingCount = proposals.length;
  const doneCount = approvedIds.size + rejectedIds.size;

  // No weekOf provided
  if (!weekOfDate) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center">
        Select a week from the Schedule page to generate or review proposals.
      </div>
    );
  }

  const weekLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(weekOfDate);

  return (
    <div className="space-y-4">
      {/* Week header + generate button */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Week of</p>
          <p className="text-sm font-medium">{weekLabel}</p>
        </div>
        {centerId && proposals.length === 0 && doneCount === 0 && (
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            <Sparkles size={14} />
            {generating ? "Generating…" : "Generate with AI"}
          </button>
        )}
        {proposals.length > 1 && (
          <button
            onClick={handleApproveAll}
            disabled={isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-60"
          >
            <CheckCircle size={14} />
            Approve all ({pendingCount})
          </button>
        )}
      </div>

      {generateError && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
          {generateError}
        </div>
      )}

      {generating && (
        <div className="text-center py-12">
          <Sparkles size={24} className="text-primary mx-auto mb-3 animate-pulse" />
          <p className="text-sm text-muted-foreground">
            AI is building your schedule — this may take 15–30 seconds…
          </p>
        </div>
      )}

      {!generating && proposals.length === 0 && doneCount === 0 && !centerId && (
        <div className="text-sm text-muted-foreground py-8 text-center">
          No pending proposals for this week.
        </div>
      )}

      {!generating && proposals.length === 0 && doneCount > 0 && (
        <div className="text-center py-8">
          <CheckCircle size={24} className="text-green-600 mx-auto mb-3" />
          <p className="text-sm font-medium">All proposals reviewed</p>
          <p className="text-xs text-muted-foreground mt-1">
            {approvedIds.size} approved · {rejectedIds.size} rejected
          </p>
        </div>
      )}

      {proposals.map((proposal) => (
        <div key={proposal.id}>
          {actionErrors[proposal.id] && (
            <div className="mb-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive">
              {actionErrors[proposal.id]}
            </div>
          )}
          <ProposalCard
            proposal={proposal}
            timezone={timezone}
            isPending={pendingIds.has(proposal.id)}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        </div>
      ))}

      {pendingCount > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          {pendingCount} proposal{pendingCount !== 1 ? "s" : ""} remaining
        </p>
      )}
    </div>
  );
}
