"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertCircle } from "lucide-react";
import type { ThreadSummary } from "@/lib/queries/communications";

interface Props {
  thread: ThreadSummary;
}

export function ThreadCard({ thread }: Props) {
  const params = useParams<{ id?: string }>();
  const activeKey = params?.id ? decodeURIComponent(params.id) : null;
  const isActive = activeKey === thread.threadKey;

  const { senderName, senderType, latestMessage, unreadCount } = thread;
  const isUnread = unreadCount > 0;

  const receivedDate = new Date(latestMessage.receivedAt);
  const now = new Date();
  const dateFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const isToday = dateFmt.format(receivedDate) === dateFmt.format(now);
  const timeLabel = isToday
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(receivedDate)
    : new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        month: "short",
        day: "numeric",
      }).format(receivedDate);

  const initials =
    senderName
      ?.split(" ")
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  const tags: { label: string; tone: "default" | "purple" | "danger" }[] = [];
  if (senderType) tags.push({ label: senderType, tone: "default" });
  if (latestMessage.isCancellation) tags.push({ label: "Cancellation", tone: "danger" });

  return (
    <Link
      href={`/communications/${encodeURIComponent(thread.threadKey)}`}
      style={{
        display: "grid",
        gridTemplateColumns: "42px 1fr auto",
        gap: 12,
        padding: 14,
        borderRadius: 14,
        minHeight: 92,
        textDecoration: "none",
        color: "inherit",
        transition: "background 120ms ease, border-color 120ms ease",
        border: `1px solid ${
          isActive
            ? "var(--ata-blue-200)"
            : isUnread
              ? "var(--ata-gray-200)"
              : "var(--ata-gray-100)"
        }`,
        background: isActive ? "var(--ata-blue-50)" : "#FFFFFF",
        boxShadow: isActive ? "inset 3px 0 0 var(--ata-blue-600)" : undefined,
      }}
    >
      <span
        style={{
          width: 42,
          height: 42,
          borderRadius: 9999,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          fontWeight: 700,
          color: "#FFFFFF",
          background: isUnread || isActive ? "var(--ata-blue-600)" : "var(--ata-gray-400)",
          position: "relative",
          flex: "0 0 auto",
        }}
        aria-hidden
      >
        {initials}
        <span
          style={{
            position: "absolute",
            right: -1,
            bottom: -1,
            width: 10,
            height: 10,
            borderRadius: 9999,
            background: "var(--ata-success-500)",
            border: "2px solid #FFFFFF",
          }}
        />
      </span>

      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span
            style={{
              fontSize: 14,
              lineHeight: "20px",
              fontWeight: 800,
              color: "var(--ata-gray-900)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              minWidth: 0,
            }}
          >
            {senderName}
          </span>
        </div>
        {tags.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {tags.map((tag) => (
              <span
                key={tag.label}
                style={{
                  height: 20,
                  padding: "0 8px",
                  borderRadius: 9999,
                  fontSize: 11,
                  fontWeight: 700,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  background:
                    tag.tone === "purple"
                      ? "var(--ata-purple-50)"
                      : tag.tone === "danger"
                        ? "var(--ata-danger-50)"
                        : "var(--ata-gray-50)",
                  color:
                    tag.tone === "purple"
                      ? "var(--ata-purple-600)"
                      : tag.tone === "danger"
                        ? "var(--ata-danger-700)"
                        : "var(--ata-gray-700)",
                  border: `1px solid ${
                    tag.tone === "purple"
                      ? "var(--ata-purple-100)"
                      : tag.tone === "danger"
                        ? "var(--ata-danger-100)"
                        : "var(--ata-gray-200)"
                  }`,
                }}
              >
                {tag.tone === "danger" && <AlertCircle size={10} />}
                {tag.label}
              </span>
            ))}
          </div>
        )}
        <p
          style={{
            fontSize: 13,
            lineHeight: "18px",
            color: "var(--ata-gray-600)",
            margin: 0,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {latestMessage.rawBody}
        </p>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 6,
          flex: "0 0 auto",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ata-gray-500)" }}>
          {timeLabel}
        </span>
        {unreadCount > 0 && (
          <span
            style={{
              minWidth: 22,
              height: 22,
              padding: "0 7px",
              borderRadius: 9999,
              background: "var(--ata-blue-600)",
              color: "#FFFFFF",
              fontSize: 12,
              fontWeight: 800,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {unreadCount}
          </span>
        )}
      </div>
    </Link>
  );
}
