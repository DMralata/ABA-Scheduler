import Link from "next/link";
import { PhoneIncoming, Voicemail, MessageSquare, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { InboundMessage, Client, Provider, OutboundMessage } from "@prisma/client";

type MessageWithRelations = InboundMessage & {
  client: Pick<Client, "id" | "firstName" | "lastName"> | null;
  provider: Pick<Provider, "id" | "firstName" | "lastName"> | null;
  outboundMessages: OutboundMessage[];
};

interface Props {
  message: MessageWithRelations;
}

export function MessageCard({ message }: Props) {
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

  const isUnread = message.status === "UNREAD";
  const hasDraft = message.outboundMessages.some((m) => m.status === "DRAFT");

  const receivedDate = new Date(message.receivedAt);
  const now = new Date();
  const TZ = "UTC";
  const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  const isToday = dateFmt.format(receivedDate) === dateFmt.format(now);
  const timeLabel = isToday
    ? new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true }).format(receivedDate)
    : new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" }).format(receivedDate);

  return (
    <Link
      href={`/communications/${message.id}`}
      className={cn(
        "block rounded-lg border p-4 hover:bg-muted/40 transition-colors",
        isUnread ? "bg-card border-primary/30" : "bg-card"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {isUnread && (
            <span className="shrink-0 h-2 w-2 rounded-full bg-primary mt-1" />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={cn("text-sm font-medium truncate", isUnread ? "text-foreground" : "text-foreground/80")}>
                {senderName}
              </span>
              {senderType && (
                <Badge variant="outline" className="text-[10px] shrink-0 py-0">
                  {senderType}
                </Badge>
              )}
              {message.isCancellation && (
                <Badge variant="destructive" className="text-[10px] shrink-0 py-0">
                  <AlertCircle size={9} className="mr-0.5" />
                  Cancellation
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
              {message.aiSummary ?? message.rawBody.slice(0, 120)}
            </p>
          </div>
        </div>

        <div className="shrink-0 flex flex-col items-end gap-1.5">
          <span className="text-xs text-muted-foreground">{timeLabel}</span>
          <div className="flex items-center gap-1">
            {message.messageType === "VOICEMAIL" ? (
              <Voicemail size={13} className="text-muted-foreground" />
            ) : message.messageType === "ZOOM_CHAT" ? (
              <MessageSquare size={13} className="text-muted-foreground" />
            ) : (
              <PhoneIncoming size={13} className="text-muted-foreground" />
            )}
            {hasDraft && (
              <Badge variant="secondary" className="text-[10px] py-0">
                Draft ready
              </Badge>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
