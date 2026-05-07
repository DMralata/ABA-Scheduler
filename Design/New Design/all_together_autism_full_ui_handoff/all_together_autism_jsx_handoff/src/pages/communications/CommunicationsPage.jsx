import React from "react";
import {
  Paperclip,
  Smile,
  Send,
  Sparkles,
  MoreHorizontal,
  Phone,
  UserRound,
  Search,
} from "lucide-react";
import { AppShell } from "../../components/app/AppShell";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { threads } from "../../data/sampleData";

function ThreadCard({ thread }) {
  return (
    <button
      type="button"
      style={{
        width: "100%",
        minHeight: 92,
        padding: 14,
        borderRadius: 14,
        border: thread.selected ? "1px solid var(--ata-blue-200)" : "1px solid transparent",
        background: thread.selected ? "var(--ata-blue-50)" : "#FFFFFF",
        boxShadow: thread.selected ? "inset 3px 0 0 var(--ata-blue-600)" : "none",
        display: "grid",
        gridTemplateColumns: "42px 1fr auto",
        gap: 12,
        textAlign: "left",
      }}
    >
      <span className="ata-avatar" style={{ width: 42, height: 42 }}>{thread.initials}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontWeight: 800, color: "var(--ata-gray-900)", fontSize: 14 }}>{thread.name}</span>
        <span style={{ display: "block", fontSize: 12, color: "var(--ata-gray-500)", marginBottom: 4 }}>{thread.role}</span>
        <span style={{ display: "block", fontSize: 13, lineHeight: "18px", color: "var(--ata-gray-600)" }}>{thread.preview}</span>
        <span style={{ display: "flex", gap: 6, marginTop: 8 }}>
          {thread.tags.map((tag) => <Chip key={tag} color={tag.includes("Coverage") ? "purple" : "default"}>{tag}</Chip>)}
        </span>
      </span>
      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
        <span style={{ fontSize: 12, color: "var(--ata-gray-500)", fontWeight: 600 }}>{thread.timestamp}</span>
        {thread.unreadCount > 0 && (
          <span style={{ minWidth: 22, height: 22, borderRadius: 9999, background: "var(--ata-blue-600)", color: "#fff", fontSize: 12, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            {thread.unreadCount}
          </span>
        )}
      </span>
    </button>
  );
}

function MessageBubble({ outbound, sender, time, children }) {
  return (
    <div style={{ display: "flex", justifyContent: outbound ? "flex-end" : "flex-start", marginBottom: 18 }}>
      <div style={{ maxWidth: 680 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ata-gray-700)", marginBottom: 4, textAlign: outbound ? "right" : "left" }}>
          {sender} <span style={{ fontWeight: 500, color: "var(--ata-gray-400)" }}>{time}</span>
        </div>
        <div style={{ padding: "12px 14px", borderRadius: 16, borderTopLeftRadius: outbound ? 16 : 6, borderTopRightRadius: outbound ? 6 : 16, background: outbound ? "var(--ata-blue-50)" : "#FFFFFF", border: outbound ? "1px solid var(--ata-blue-200)" : "1px solid var(--ata-gray-200)", boxShadow: outbound ? "none" : "var(--shadow-xs)", fontSize: 14, lineHeight: 1.45 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

export default function CommunicationsPage() {
  return (
    <AppShell activeNav="communications">
      <div style={{ display: "grid", gridTemplateColumns: "360px minmax(520px, 1fr) 320px", height: "100vh", background: "#FFFFFF", overflow: "hidden" }}>
        <aside style={{ borderRight: "1px solid var(--ata-gray-200)", display: "flex", flexDirection: "column", minWidth: 0 }}>
          <header style={{ padding: "20px 16px 16px", borderBottom: "1px solid var(--ata-gray-200)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h1 style={{ fontSize: 24, lineHeight: "32px", margin: 0 }}>Communications</h1>
                <p style={{ margin: "4px 0 0", color: "var(--ata-gray-600)", fontSize: 14 }}>Coordinate messages with providers and clients</p>
              </div>
              <Button size="sm">New</Button>
            </div>
          </header>

          <div style={{ padding: 16, borderBottom: "1px solid var(--ata-gray-100)" }}>
            <div className="ata-search">
              <Search className="ata-search-icon" size={18} />
              <input className="ata-input" placeholder="Search conversations..." style={{ width: "100%", height: 42 }} />
            </div>
            <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingTop: 12 }}>
              {["All", "Unread", "Providers", "Clients", "Urgent", "Coverage"].map((filter, index) => (
                <span key={filter} className={`ata-chip ${index === 0 ? "ata-chip--blue" : ""}`}>{filter}</span>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "var(--ata-gray-500)", padding: "14px 8px 8px" }}>TODAY</div>
            {threads.map((thread) => <ThreadCard key={thread.id} thread={thread} />)}
          </div>
        </aside>

        <section style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <header style={{ height: 104, padding: "18px 24px", borderBottom: "1px solid var(--ata-gray-200)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <span className="ata-avatar" style={{ width: 48, height: 48 }}>JS</span>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>Jordan Smith</div>
                <div style={{ fontSize: 13, color: "var(--ata-gray-500)" }}>RBT · Online</div>
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  <Chip color="blue">Client: Liam P.</Chip>
                  <Chip color="purple">Coverage needed</Chip>
                  <Chip color="warning">Awaiting reply</Chip>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="ata-icon-button"><Phone size={17} /></button>
              <button className="ata-icon-button"><UserRound size={17} /></button>
              <button className="ata-icon-button"><MoreHorizontal size={17} /></button>
            </div>
          </header>

          <div style={{ padding: "12px 24px", borderBottom: "1px solid var(--ata-gray-100)", background: "var(--ata-gray-25)", display: "flex", gap: 10 }}>
            {["Upcoming session: Tue 4:00 PM", "Assigned client: Liam P.", "Coverage risk: High"].map((item) => (
              <div key={item} style={{ height: 52, minWidth: 176, padding: "8px 12px", borderRadius: 12, background: "#FFFFFF", border: "1px solid var(--ata-gray-200)", display: "flex", alignItems: "center", fontSize: 13, fontWeight: 600 }}>
                {item}
              </div>
            ))}
          </div>

          <main style={{ flex: 1, overflowY: "auto", padding: 24, background: "linear-gradient(180deg, #FFFFFF 0%, #FBFCFE 100%)" }}>
            <div style={{ display: "flex", justifyContent: "center", margin: "8px 0 22px" }}>
              <span style={{ height: 24, padding: "0 12px", borderRadius: 9999, background: "var(--ata-gray-100)", color: "var(--ata-gray-600)", fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center" }}>Today</span>
            </div>
            <MessageBubble sender="Jordan Smith" time="10:02 AM">
              Hi! I received the schedule update. I’m currently booked for Tuesday at 4:00 PM with Liam. I won’t be able to make it due to a prior commitment. Can someone please cover this session?
            </MessageBubble>
            <MessageBubble outbound sender="You" time="10:05 AM">
              No problem, Jordan. Thanks for letting me know early. I’ll look for coverage and confirm with you as soon as I have someone.
            </MessageBubble>
            <MessageBubble sender="Jordan Smith" time="10:12 AM">
              Thanks so much. Let me know if you need any details about Liam’s session.
            </MessageBubble>
          </main>

          <div style={{ padding: "10px 24px 0", display: "flex", alignItems: "center", gap: 8, overflowX: "auto" }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: "var(--ata-gray-500)" }}>Smart replies</span>
            {["Check availability", "Propose time options", "Confirm coverage", "Thank you"].map((reply) => <Chip key={reply}>{reply}</Chip>)}
          </div>

          <footer style={{ borderTop: "1px solid var(--ata-gray-200)", background: "#FFFFFF", padding: "16px 24px 20px" }}>
            <div style={{ border: "1px solid var(--ata-gray-200)", borderRadius: 16, boxShadow: "var(--shadow-xs)", overflow: "hidden" }}>
              <textarea placeholder="Type a message..." style={{ width: "100%", minHeight: 84, padding: 14, border: 0, resize: "none", outline: "none", fontSize: 14 }} />
              <div style={{ height: 44, padding: "0 10px", borderTop: "1px solid var(--ata-gray-100)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", gap: 6 }}>
                  {[Paperclip, Smile, Sparkles].map((Icon, index) => (
                    <button key={index} className="ata-icon-button" style={{ width: 34, height: 34, border: 0 }}>
                      <Icon size={17} />
                    </button>
                  ))}
                </div>
                <Button size="sm" iconRight={<Send size={15} />}>Send</Button>
              </div>
            </div>
          </footer>
        </section>

        <aside style={{ borderLeft: "1px solid var(--ata-gray-200)", background: "#FFFFFF", display: "flex", flexDirection: "column" }}>
          <header style={{ height: 72, padding: "18px 20px", borderBottom: "1px solid var(--ata-gray-200)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2 style={{ fontSize: 18, margin: 0 }}>AI Suggestions</h2>
            <span className="ata-badge" style={{ background: "var(--ata-purple-50)", color: "var(--ata-purple-600)" }}>BETA</span>
          </header>
          <div style={{ flex: 1, overflowY: "auto", padding: "18px 16px" }}>
            {[
              ["Message summary", "Jordan needs coverage for Liam’s Tuesday 4:00 PM session."],
              ["Draft reply", "Generate a professional reply confirming next steps."],
              ["Check schedule conflicts", "Review available RBTs and overlapping sessions."],
              ["Create follow-up task", "Add a task to confirm coverage and notify caregiver."],
              ["Escalate to BCBA", "Notify supervising BCBA if coverage cannot be secured."],
            ].map(([title, description]) => (
              <div key={title} className="ata-card" style={{ padding: 14, marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 800 }}>{title}</div>
                <div style={{ fontSize: 13, color: "var(--ata-gray-600)", lineHeight: "18px", marginTop: 4 }}>{description}</div>
              </div>
            ))}
          </div>
          <div style={{ padding: "12px 16px", borderTop: "1px solid var(--ata-gray-100)", fontSize: 11, color: "var(--ata-gray-500)" }}>
            AI can make mistakes. Verify important details.
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
