"use client";

import { useState } from "react";
import {
  PhoneIncoming,
  Voicemail,
  MessageSquare,
  CheckCircle2,
  AlertCircle,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { OutboundDraftCard } from "@/components/communications/OutboundDraftCard";
import { markMessageActioned } from "@/lib/actions/communications";
import type { InboundMessage, Client, Provider, OutboundMessage } from "@prisma/client";

type FullMessage = InboundMessage & {
  client: Pick<Client, "id" | "firstName" | "lastName"> | null;
  provider: Pick<Provider, "id" | "firstName" | "lastName"> | null;
  outboundMessages: OutboundMessage[];
};

interface Props {
  message: FullMessage;
}

export function MessageDetailView({ message }: Props) {
  const [actioned, setActioned] = useState(message.status === "ACTIONED");
  const [actionPending, setActionPending] = useState(false);

  const senderName = message.client
    ? `${message.client.firstName} ${message.client.lastName}`
    : message.provider
    ? `${message.provider.firstName} ${message.provider.lastName}`
    : message.fromName
    ?? (message.messageType === "ZOOM_CHAT" ? "Unknown" : message.fromNumber);

  const senderType = message.client
    ? "Client"
    : message.provider
    ? "Provider"
    : null;

  const cancelReplyDrafts = message.outboundMessages.filter(
    (m) => m.outreachReason === "CANCELLATION_REPLY"
  );

  const outreachDrafts = message.outboundMessages.filter(
    (m) => m.outreachReason === "SCHEDULE_CHANGE_OUTREACH"
  );

  async function handleMarkActioned() {
    setActionPending(true);
    const result = await markMessageActioned(message.id);
    if (result.success) setActioned(true);
    setActionPending(false);
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Header card */}
      <div className="rounded-lg border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-semibold">{senderName}</h2>
              {senderType && (
                <Badge variant="outline" className="text-xs">
                  {senderType}
                </Badge>
              )}
              {message.isCancellation && (
                <Badge variant="destructive" className="text-xs">
                  <AlertCircle size={10} className="mr-1" />
                  Cancellation
                </Badge>
              )}
              {actioned && (
                <Badge
                  variant="secondary"
                  className="text-xs text-green-700 bg-green-100"
                >
                  <CheckCircle2 size={10} className="mr-1" />
                  Actioned
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {/* For Zoom Chat, suppress raw user ID — show resolved name in header instead */}
              {message.messageType !== "ZOOM_CHAT" && `${message.fromNumber} · `}
              {new Date(message.receivedAt).toLocaleString([], {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {message.messageType === "VOICEMAIL" ? (
              <Voicemail size={16} className="text-muted-foreground" />
            ) : message.messageType === "ZOOM_CHAT" ? (
              <MessageSquare size={16} className="text-muted-foreground" />
            ) : (
              <PhoneIncoming size={16} className="text-muted-foreground" />
            )}
            <span className="text-xs text-muted-foreground">
              {message.messageType === "VOICEMAIL"
                ? "Voicemail"
                : message.messageType === "ZOOM_CHAT"
                ? "Zoom Chat"
                : "SMS"}
            </span>
          </div>
        </div>

        <Separator className="my-4" />

        {/* AI Summary */}
        {message.aiSummary && (
          <div className="space-y-1 mb-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              AI Summary
            </p>
            <p className="text-sm">{message.aiSummary}</p>
          </div>
        )}

        {/* Raw message */}
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Original Message
          </p>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap rounded bg-muted/40 p-3">
            {message.rawBody}
          </p>
        </div>

        {!actioned && message.isCancellation && (
          <div className="mt-4 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={handleMarkActioned}
              disabled={actionPending}
            >
              <CheckCircle2 size={14} />
              Mark as Actioned
            </Button>
          </div>
        )}
      </div>

      {/* Step 1: Reply to canceller */}
      {cancelReplyDrafts.length > 0 && (
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">Reply to Sender</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              AI-drafted reply — review and edit before sending
            </p>
          </div>
          {cancelReplyDrafts.map((draft) => (
            <OutboundDraftCard key={draft.id} outbound={draft} messageType={message.messageType} />
          ))}
        </div>
      )}

      {/* Step 2: Outreach to affected parties */}
      {outreachDrafts.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Users size={15} className="text-muted-foreground" />
            <div>
              <h3 className="text-sm font-semibold">Outreach to Affected Parties</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Schedule change notifications — review and send to each party
              </p>
            </div>
          </div>
          {outreachDrafts.map((draft) => (
            <OutboundDraftCard key={draft.id} outbound={draft} messageType={message.messageType} />
          ))}
        </div>
      )}
    </div>
  );
}
