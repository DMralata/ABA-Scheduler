"use client";

import { useState } from "react";
import { Copy, RefreshCw, CheckCircle2, AlertCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { OutboundMessage } from "@prisma/client";

interface Props {
  outbound: OutboundMessage;
  messageType?: "SMS" | "VOICEMAIL" | "ZOOM_CHAT";
  onCopied?: (id: string) => void;
}

export function OutboundDraftCard({ outbound, messageType, onCopied }: Props) {
  const [body, setBody] = useState(outbound.editedBody ?? outbound.draftBody);
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(outbound.status === "SENT");
  const [error, setError] = useState<string | null>(null);

  const isZoomChat = messageType === "ZOOM_CHAT";
  const recipientLabel =
    outbound.recipientType === "CLIENT" ? "Client" : "Provider";

  async function handleCopy() {
    await navigator.clipboard.writeText(body);
    setCopied(true);
    onCopied?.(outbound.id);
    setTimeout(() => setCopied(false), 2500);
  }

  async function handleRegenerate() {
    setRegenerating(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/communications/outbound/${outbound.id}/regenerate`,
        { method: "POST" }
      );
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to regenerate");
      }
      const data = (await res.json()) as { draftBody: string };
      setBody(data.draftBody);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to regenerate");
    } finally {
      setRegenerating(false);
    }
  }

  async function handleSend() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/communications/outbound/${outbound.id}/send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            body !== outbound.draftBody ? { editedBody: body } : {}
          ),
        }
      );
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to send");
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  // For Zoom Chat: show Zoom User ID only if no resolved name (raw ID is not readable)
  const recipientDisplay = isZoomChat ? recipientLabel : `${recipientLabel} · ${outbound.toNumber}`;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <Badge variant="outline" className="text-xs">
          To: {recipientDisplay}
        </Badge>
        {!isZoomChat && (
          <span className="text-xs text-muted-foreground">
            {body.length}/1600
          </span>
        )}
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        {...(!isZoomChat ? { maxLength: 1600 } : {})}
        rows={4}
        disabled={sent}
        className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
      />

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 justify-end">
        {!sent && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRegenerate}
            disabled={regenerating || sending}
          >
            <RefreshCw size={14} className={regenerating ? "animate-spin" : ""} />
            Regenerate
          </Button>
        )}

        {isZoomChat ? (
          <Button
            size="sm"
            onClick={handleSend}
            disabled={sending || sent || !body.trim()}
            variant={sent ? "outline" : "default"}
          >
            {sent ? (
              <CheckCircle2 size={14} className="text-green-600" />
            ) : (
              <Send size={14} />
            )}
            {sent ? "Sent" : sending ? "Sending…" : "Send via Zoom Chat"}
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={handleCopy}
            disabled={!body.trim()}
            variant={copied ? "outline" : "default"}
          >
            {copied ? (
              <CheckCircle2 size={14} className="text-green-600" />
            ) : (
              <Copy size={14} />
            )}
            {copied ? "Copied!" : "Copy to clipboard"}
          </Button>
        )}
      </div>

      {!isZoomChat && copied && (
        <p className="text-xs text-muted-foreground text-right">
          Paste into Zoom Phone to send to {recipientLabel.toLowerCase()}
        </p>
      )}
    </div>
  );
}
