"use client";

import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { ThreadCard } from "@/components/communications/ThreadCard";
import type { ThreadSummary } from "@/lib/queries/communications";

type Filter = "all" | "unread" | "providers" | "clients" | "urgent" | "coverage";

const filters: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "providers", label: "Providers" },
  { id: "clients", label: "Clients" },
  { id: "urgent", label: "Urgent" },
  { id: "coverage", label: "Coverage" },
];

interface Props {
  threads: ThreadSummary[];
}

type Group = "Today" | "Yesterday" | "Older";

function groupOf(received: Date, now: Date): Group {
  const dateFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const todayKey = dateFmt.format(now);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayKey = dateFmt.format(yesterday);
  const receivedKey = dateFmt.format(received);
  if (receivedKey === todayKey) return "Today";
  if (receivedKey === yesterdayKey) return "Yesterday";
  return "Older";
}

export function InboxClient({ threads }: Props) {
  const [active, setActive] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const filtered = threads.filter((t) => {
    if (active === "unread" && t.unreadCount === 0) return false;
    if (active === "providers" && t.senderType !== "Provider") return false;
    if (active === "clients" && t.senderType !== "Client") return false;
    if (active === "urgent" && !t.latestMessage.isCancellation) return false;
    if (active === "coverage" && !t.latestMessage.isCancellation) return false;
    if (query) {
      const q = query.toLowerCase();
      if (
        !t.senderName.toLowerCase().includes(q) &&
        !t.latestMessage.rawBody.toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });

  const now = new Date();
  const grouped: Record<Group, ThreadSummary[]> = {
    Today: [],
    Yesterday: [],
    Older: [],
  };
  for (const t of filtered) {
    grouped[groupOf(new Date(t.latestMessage.receivedAt), now)].push(t);
  }

  return (
    <aside
      style={{
        width: 360,
        flex: "0 0 360px",
        height: "100vh",
        background: "#FFFFFF",
        borderRight: "1px solid var(--ata-gray-200)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <header style={{ padding: "20px 16px 14px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h1
              style={{
                fontSize: 22,
                lineHeight: "28px",
                fontWeight: 800,
                color: "var(--ata-gray-900)",
                margin: 0,
                letterSpacing: "-0.01em",
              }}
            >
              Communications
            </h1>
            <p
              style={{
                fontSize: 13,
                lineHeight: "18px",
                color: "var(--ata-gray-500)",
                margin: "4px 0 0",
              }}
            >
              Coordinate messages with providers and clients
            </p>
          </div>
          <button
            type="button"
            className="ata-btn ata-btn--primary ata-btn--sm"
            disabled
            title="New message (coming soon)"
          >
            <Plus size={14} />
            New
          </button>
        </div>
      </header>

      <div style={{ padding: "0 16px 10px" }}>
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            height: 42,
          }}
        >
          <Search
            size={16}
            style={{
              position: "absolute",
              left: 12,
              color: "var(--ata-gray-400)",
              pointerEvents: "none",
            }}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations…"
            style={{
              width: "100%",
              height: 42,
              padding: "0 12px 0 36px",
              fontSize: 14,
              borderRadius: 10,
              border: "1px solid var(--ata-gray-200)",
              background: "#FFFFFF",
              color: "var(--ata-gray-900)",
              outline: "none",
            }}
          />
        </div>
      </div>

      <div
        style={{
          padding: "0 16px 12px",
          display: "flex",
          gap: 6,
          overflowX: "auto",
        }}
      >
        {filters.map((f) => {
          const isActive = active === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setActive(f.id)}
              style={{
                height: 30,
                padding: "0 12px",
                borderRadius: 9999,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
                border: `1px solid ${isActive ? "var(--ata-blue-200)" : "var(--ata-gray-200)"}`,
                background: isActive ? "var(--ata-blue-50)" : "#FFFFFF",
                color: isActive ? "var(--ata-blue-700)" : "var(--ata-gray-700)",
                flex: "0 0 auto",
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "0 12px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {filtered.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "40px 16px",
              color: "var(--ata-gray-500)",
              fontSize: 13,
            }}
          >
            {query
              ? "No conversations match your search."
              : "No messages yet — inbound messages will appear here automatically."}
          </div>
        ) : (
          (Object.keys(grouped) as Group[])
            .filter((g) => grouped[g].length > 0)
            .map((g) => (
              <div key={g} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--ata-gray-500)",
                    padding: "10px 6px 4px",
                  }}
                >
                  {g}
                </div>
                {grouped[g].map((t) => (
                  <ThreadCard key={t.threadKey} thread={t} />
                ))}
              </div>
            ))
        )}
      </div>

    </aside>
  );
}
