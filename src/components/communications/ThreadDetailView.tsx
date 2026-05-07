"use client";

import { useState, useRef } from "react";
import {
  AlertCircle,
  CheckCircle2,
  MoreHorizontal,
  Paperclip,
  Phone,
  Send,
  Smile,
  UserCircle,
} from "lucide-react";
import { markMessageActioned } from "@/lib/actions/communications";
import type {
  InboundMessage,
  Client,
  Provider,
  OutboundMessage,
} from "@prisma/client";

type FullMessage = InboundMessage & {
  client: Pick<Client, "id" | "firstName" | "lastName"> | null;
  provider: Pick<Provider, "id" | "firstName" | "lastName"> | null;
  outboundMessages: OutboundMessage[];
};

interface Props {
  messages: FullMessage[];
  senderName: string;
  senderRole: string | null;
  threadKey: string;
}

const SMART_REPLIES = [
  "Check availability",
  "Propose time options",
  "Confirm coverage",
  "Thank you",
];

function formatBubbleTime(d: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

function MessageBubble({
  outbound,
  sender,
  time,
  body,
  cancellation,
  actioned,
  onMarkActioned,
}: {
  outbound: boolean;
  sender: string;
  time: string;
  body: string;
  cancellation?: boolean;
  actioned?: boolean;
  onMarkActioned?: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: outbound ? "flex-end" : "flex-start",
        gap: 6,
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: "var(--ata-gray-700)",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span>{sender}</span>
        <span style={{ fontSize: 11, fontWeight: 500, color: "var(--ata-gray-400)" }}>
          {time}
        </span>
        {cancellation && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              fontWeight: 700,
              color: "var(--ata-danger-700)",
              background: "var(--ata-danger-50)",
              border: "1px solid var(--ata-danger-100)",
              padding: "2px 8px",
              borderRadius: 9999,
            }}
          >
            <AlertCircle size={10} />
            Cancellation
          </span>
        )}
        {actioned && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              fontWeight: 700,
              color: "var(--ata-success-700)",
              background: "var(--ata-success-50)",
              border: "1px solid var(--ata-success-100)",
              padding: "2px 8px",
              borderRadius: 9999,
            }}
          >
            <CheckCircle2 size={10} />
            Actioned
          </span>
        )}
      </div>
      <div
        style={{
          maxWidth: 680,
          padding: "12px 14px",
          borderRadius: 16,
          borderTopLeftRadius: outbound ? 16 : 6,
          borderTopRightRadius: outbound ? 6 : 16,
          background: outbound ? "var(--ata-blue-50)" : "#FFFFFF",
          border: `1px solid ${outbound ? "var(--ata-blue-100)" : "var(--ata-gray-200)"}`,
          color: "var(--ata-gray-900)",
          fontSize: 14,
          lineHeight: 1.45,
          whiteSpace: "pre-wrap",
          boxShadow: outbound ? "none" : "0 1px 2px rgba(16,24,40,0.04)",
        }}
      >
        {body}
      </div>
      {!outbound && cancellation && !actioned && onMarkActioned && (
        <button
          type="button"
          onClick={onMarkActioned}
          className="ata-btn ata-btn--secondary ata-btn--sm"
        >
          <CheckCircle2 size={14} />
          Mark as Actioned
        </button>
      )}
    </div>
  );
}

export function ThreadDetailView({
  messages,
  senderName,
  senderRole,
  threadKey,
}: Props) {
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentReplies, setSentReplies] = useState<string[]>([]);

  const [actionedIds, setActionedIds] = useState<Set<string>>(
    () =>
      new Set(messages.filter((m) => m.status === "ACTIONED").map((m) => m.id)),
  );

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const timeline: {
    type: "inbound" | "outbound";
    data: FullMessage | OutboundMessage;
    time: Date;
  }[] = [];
  for (const msg of messages) {
    timeline.push({ type: "inbound", data: msg, time: new Date(msg.receivedAt) });
    for (const out of msg.outboundMessages) {
      if (out.status === "SENT") {
        timeline.push({
          type: "outbound",
          data: out,
          time: new Date(out.sentAt ?? out.createdAt),
        });
      }
    }
  }
  timeline.sort((a, b) => a.time.getTime() - b.time.getTime());

  function handleMarkActioned(id: string) {
    markMessageActioned(id)
      .then((result) => {
        if (result.success) {
          setActionedIds((prev) => {
            const next = new Set(prev);
            next.add(id);
            return next;
          });
        }
      })
      .catch(() => {});
  }

  function handleSend() {
    if (!replyText.trim() || sending) return;
    setSending(true);
    setSendError(null);

    fetch("/api/communications/threads/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadKey, message: replyText }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          throw new Error(data.error ?? "Failed to send");
        }
        setSentReplies((prev) => [...prev, replyText]);
        setReplyText("");
      })
      .catch((err) => {
        setSendError(err instanceof Error ? err.message : "Failed to send");
      })
      .finally(() => setSending(false));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const initials =
    senderName
      ?.split(" ")
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      {/* Conversation header */}
      <header
        style={{
          height: 104,
          padding: "0 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--ata-gray-200)",
          flex: "0 0 auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
          <span
            style={{
              width: 48,
              height: 48,
              borderRadius: 9999,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--ata-blue-600)",
              color: "#FFFFFF",
              fontSize: 16,
              fontWeight: 800,
              flex: "0 0 auto",
            }}
            aria-hidden
          >
            {initials}
          </span>
          <div style={{ minWidth: 0 }}>
            <h1
              style={{
                fontSize: 18,
                lineHeight: "26px",
                fontWeight: 800,
                color: "var(--ata-gray-900)",
                margin: 0,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {senderName}
            </h1>
            <div style={{ fontSize: 13, color: "var(--ata-gray-500)" }}>
              {senderRole ? `${senderRole} · ` : ""}
              <span style={{ color: "var(--ata-success-600)", fontWeight: 600 }}>
                Online
              </span>
            </div>
          </div>
        </div>
        <div style={{ display: "inline-flex", gap: 8 }}>
          <button type="button" className="ata-icon-button" aria-label="Call">
            <Phone size={16} />
          </button>
          <button type="button" className="ata-icon-button" aria-label="Profile">
            <UserCircle size={16} />
          </button>
          <button type="button" className="ata-icon-button" aria-label="More">
            <MoreHorizontal size={16} />
          </button>
        </div>
      </header>

      {/* Timeline */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 18,
          background:
            "linear-gradient(180deg, #FFFFFF 0%, var(--ata-gray-25) 100%)",
        }}
      >
        {timeline.map((item, i) => {
          if (item.type === "inbound") {
            const m = item.data as FullMessage;
            return (
              <MessageBubble
                key={`in-${m.id}-${i}`}
                outbound={false}
                sender={senderName}
                time={formatBubbleTime(item.time)}
                body={m.rawBody}
                cancellation={m.isCancellation}
                actioned={actionedIds.has(m.id)}
                onMarkActioned={() => handleMarkActioned(m.id)}
              />
            );
          }
          const o = item.data as OutboundMessage;
          return (
            <MessageBubble
              key={`out-${o.id}-${i}`}
              outbound
              sender="You"
              time={formatBubbleTime(item.time)}
              body={o.sentBody ?? o.editedBody ?? o.draftBody ?? ""}
            />
          );
        })}

        {sentReplies.map((text, i) => (
          <MessageBubble
            key={`opt-${i}`}
            outbound
            sender="You"
            time="Just now"
            body={text}
          />
        ))}
      </div>

      {/* Smart replies */}
      <div
        style={{
          padding: "12px 24px 0",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          flex: "0 0 auto",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--ata-gray-500)",
          }}
        >
          Smart replies
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {SMART_REPLIES.map((reply) => (
            <button
              key={reply}
              type="button"
              onClick={() => setReplyText((prev) => (prev ? `${prev} ${reply}` : reply))}
              style={{
                height: 26,
                padding: "0 10px",
                borderRadius: 9999,
                fontSize: 12,
                fontWeight: 600,
                color: "var(--ata-gray-700)",
                background: "#FFFFFF",
                border: "1px solid var(--ata-gray-200)",
                cursor: "pointer",
              }}
            >
              {reply}
            </button>
          ))}
        </div>
      </div>

      {/* Composer */}
      <div
        style={{
          padding: "12px 24px 20px",
          flex: "0 0 auto",
        }}
      >
        {sendError && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              color: "var(--ata-danger-700)",
              marginBottom: 8,
            }}
          >
            <AlertCircle size={14} />
            {sendError}
          </div>
        )}
        <div
          style={{
            border: "1px solid var(--ata-gray-200)",
            borderRadius: 12,
            background: "#FFFFFF",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "10px 12px",
          }}
        >
          <textarea
            ref={textareaRef}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a reply…"
            rows={2}
            style={{
              width: "100%",
              minHeight: 60,
              maxHeight: 160,
              border: 0,
              outline: "none",
              resize: "none",
              fontSize: 14,
              lineHeight: 1.45,
              color: "var(--ata-gray-900)",
              background: "transparent",
            }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "inline-flex", gap: 6 }}>
              <button
                type="button"
                aria-label="Attach file"
                title="Attach file"
                style={iconBtnStyle}
              >
                <Paperclip size={16} />
              </button>
              <button
                type="button"
                aria-label="Insert emoji"
                title="Insert emoji"
                style={iconBtnStyle}
              >
                <Smile size={16} />
              </button>
            </div>
            <button
              type="button"
              className="ata-btn ata-btn--primary ata-btn--sm"
              onClick={handleSend}
              disabled={sending || !replyText.trim()}
            >
              <Send size={14} />
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const iconBtnStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 8,
  border: 0,
  background: "transparent",
  color: "var(--ata-gray-500)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};
