"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ChevronRight, Loader2, Phone, Sparkles, X } from "lucide-react";

type ActionStep = {
  step: number;
  action: string;
  detail: string | null;
  contactName: string | null;
  contactPhone: string | null;
};

const COLLAPSED_WIDTH = 56;
const EXPANDED_WIDTH = 320;

export function AISuggestionsPanel() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [steps, setSteps] = useState<ActionStep[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());

  const params = useParams<{ id?: string }>();
  const threadKey = params?.id ? decodeURIComponent(params.id) : null;

  // Reset state when active thread changes.
  useEffect(() => {
    setSteps(null);
    setError(null);
    setChecked(new Set());
  }, [threadKey]);

  function handleToggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (threadKey && steps == null && !loading) {
      fetchSteps(threadKey);
    }
  }

  function handleRefresh() {
    if (!threadKey) return;
    fetchSteps(threadKey);
  }

  function fetchSteps(key: string) {
    setLoading(true);
    setError(null);
    fetch("/api/communications/threads/action-steps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadKey: key }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to generate suggestions");
        const data = (await res.json()) as { steps: ActionStep[] };
        setSteps(data.steps ?? []);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to generate");
        setSteps([]);
      })
      .finally(() => setLoading(false));
  }

  function toggleChecked(step: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(step)) next.delete(step);
      else next.add(step);
      return next;
    });
  }

  return (
    <aside
      style={{
        width: open ? EXPANDED_WIDTH : COLLAPSED_WIDTH,
        flex: `0 0 ${open ? EXPANDED_WIDTH : COLLAPSED_WIDTH}px`,
        height: "100vh",
        background: "#FFFFFF",
        borderLeft: "1px solid var(--ata-gray-200)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        transition: "width 180ms ease, flex-basis 180ms ease",
      }}
      aria-label="AI suggestions"
    >
      {!open ? (
        <button
          type="button"
          onClick={handleToggle}
          aria-label="Open AI suggestions"
          title="AI suggestions"
          style={{
            border: 0,
            background: "transparent",
            color: "var(--ata-purple-600)",
            cursor: "pointer",
            height: 72,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "0 0 auto",
            borderBottom: "1px solid var(--ata-gray-100)",
          }}
        >
          <Sparkles size={20} />
        </button>
      ) : (
        <header
          style={{
            height: 72,
            padding: "0 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid var(--ata-gray-100)",
            flex: "0 0 auto",
          }}
        >
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <Sparkles size={18} color="var(--ata-purple-600)" />
            <h2
              style={{
                fontSize: 16,
                lineHeight: "22px",
                fontWeight: 800,
                color: "var(--ata-gray-900)",
                margin: 0,
                letterSpacing: "-0.005em",
              }}
            >
              AI Suggestions
            </h2>
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: "0.06em",
                background: "var(--ata-purple-50)",
                color: "var(--ata-purple-600)",
                padding: "2px 7px",
                borderRadius: 9999,
                border: "1px solid var(--ata-purple-100)",
              }}
            >
              BETA
            </span>
          </div>
          <button
            type="button"
            onClick={handleToggle}
            aria-label="Close AI suggestions"
            style={{
              border: 0,
              background: "transparent",
              color: "var(--ata-gray-500)",
              padding: 6,
              borderRadius: 8,
              cursor: "pointer",
              display: "inline-flex",
            }}
          >
            <X size={16} />
          </button>
        </header>
      )}

      {open && (
        <>
          {!threadKey ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: 24,
                color: "var(--ata-gray-500)",
                fontSize: 13,
                textAlign: "center",
              }}
            >
              <ChevronRight size={20} style={{ transform: "rotate(180deg)", marginBottom: 8 }} />
              Open a conversation to see AI suggestions for it.
            </div>
          ) : loading ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                color: "var(--ata-gray-500)",
                fontSize: 13,
              }}
            >
              <Loader2 size={14} className="animate-spin" />
              Analyzing conversation…
            </div>
          ) : error ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: 12,
                padding: 16,
                color: "var(--ata-gray-500)",
                fontSize: 13,
              }}
            >
              <p style={{ margin: 0 }}>{error}</p>
              <button
                type="button"
                onClick={handleRefresh}
                className="ata-btn ata-btn--secondary ata-btn--sm"
              >
                Try again
              </button>
            </div>
          ) : steps && steps.length === 0 ? (
            <div
              style={{
                flex: 1,
                padding: 16,
                color: "var(--ata-gray-500)",
                fontSize: 13,
              }}
            >
              No specific action steps suggested for this thread.
            </div>
          ) : steps ? (
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {steps.map((s) => {
                const done = checked.has(s.step);
                return (
                  <article
                    key={s.step}
                    style={{
                      padding: 14,
                      borderRadius: 14,
                      border: "1px solid var(--ata-gray-200)",
                      background: "#FFFFFF",
                      boxShadow: "0 1px 2px rgba(16, 24, 40, 0.04)",
                      opacity: done ? 0.55 : 1,
                    }}
                  >
                    <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={done}
                        onChange={() => toggleChecked(s.step)}
                        style={{ marginTop: 2, accentColor: "var(--ata-blue-600)" }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <h3
                          style={{
                            fontSize: 14,
                            lineHeight: "20px",
                            fontWeight: 800,
                            color: "var(--ata-gray-900)",
                            margin: 0,
                            textDecoration: done ? "line-through" : undefined,
                          }}
                        >
                          {s.action}
                        </h3>
                        {s.detail && (
                          <p
                            style={{
                              fontSize: 13,
                              lineHeight: "18px",
                              color: "var(--ata-gray-600)",
                              margin: "6px 0 0",
                              textDecoration: done ? "line-through" : undefined,
                            }}
                          >
                            {s.detail}
                          </p>
                        )}
                        {s.contactPhone && (
                          <a
                            href={`tel:${s.contactPhone}`}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              fontSize: 12,
                              color: "var(--ata-blue-600)",
                              marginTop: 6,
                              textDecoration: "none",
                            }}
                          >
                            <Phone size={11} />
                            {s.contactName ? `${s.contactName}: ` : ""}
                            {s.contactPhone}
                          </a>
                        )}
                      </div>
                    </label>
                  </article>
                );
              })}
              <button
                type="button"
                onClick={handleRefresh}
                className="ata-btn ata-btn--ghost ata-btn--sm"
                style={{ alignSelf: "flex-start" }}
              >
                <Sparkles size={14} />
                Refresh suggestions
              </button>
            </div>
          ) : (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: 24,
                gap: 12,
                color: "var(--ata-gray-600)",
                fontSize: 13,
                textAlign: "center",
              }}
            >
              <Sparkles size={22} color="var(--ata-purple-600)" />
              <p style={{ margin: 0, maxWidth: 220 }}>
                Generate action-step suggestions for this conversation.
              </p>
              <button
                type="button"
                onClick={handleRefresh}
                className="ata-btn ata-btn--primary ata-btn--sm"
              >
                <Sparkles size={14} />
                Generate
              </button>
            </div>
          )}

          <footer
            style={{
              padding: "10px 20px",
              borderTop: "1px solid var(--ata-gray-100)",
              fontSize: 11,
              lineHeight: "16px",
              color: "var(--ata-gray-500)",
              flex: "0 0 auto",
            }}
          >
            Suggestions are previews and don&apos;t send anything automatically.
          </footer>
        </>
      )}
    </aside>
  );
}
