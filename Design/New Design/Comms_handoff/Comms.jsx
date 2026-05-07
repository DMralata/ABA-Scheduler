import React from "react";
import {
  Home,
  CalendarDays,
  Users,
  UserRound,
  ClipboardList,
  MessageCircle,
  BarChart3,
  Receipt,
  Settings,
  HelpCircle,
  Phone,
  MoreHorizontal,
  Search,
  Paperclip,
  Smile,
  Send,
  Sparkles,
  Plus,
  UserCircle,
} from "lucide-react";

/**
 * Comms.jsx
 * All Together Autism — Communications Page Reference Implementation
 *
 * Purpose:
 * - Provide Claude Code / IDE agent with a near 1:1 JSX representation of the approved Communications design.
 * - This file is intentionally self-contained: sample data, CSS, and components are included together.
 * - In the real codebase, extract shared pieces into AppShell, SidebarNav, ThreadCard, MessageBubble, etc.
 *
 * Dependencies:
 * - React
 * - lucide-react
 *
 * Branding:
 * - Use All Together Autism only.
 * - Pass logo assets with logoFullSrc and logoMarkSrc if available.
 */

const threads = [
  {
    id: "T-001",
    initials: "JS",
    name: "Jordan Smith",
    role: "RBT",
    preview: "Thanks for reaching out! I can cover Tuesday’s 4:00 PM session.",
    timestamp: "10:31 AM",
    unreadCount: 2,
    tags: ["RBT", "Coverage needed"],
    selected: true,
    online: true,
  },
  {
    id: "T-002",
    initials: "SJ",
    name: "Sarah Johnson",
    role: "Provider",
    preview: "I have a scheduling conflict on Wednesday at 4pm for Liam Parker.",
    timestamp: "10:24 AM",
    unreadCount: 1,
    tags: ["Coverage"],
    online: true,
  },
  {
    id: "T-003",
    initials: "MT",
    name: "Maria Torres",
    role: "Caregiver",
    preview: "Will the session still be at our home this week?",
    timestamp: "8:42 AM",
    unreadCount: 1,
    tags: ["Client"],
    online: false,
  },
  {
    id: "T-004",
    initials: "AC",
    name: "Ashley Chen",
    role: "RBT",
    preview: "Confirmed. I can keep the 9 AM session.",
    timestamp: "Yesterday",
    unreadCount: 0,
    tags: ["Provider"],
    online: true,
  },
  {
    id: "T-005",
    initials: "SP",
    name: "Sarah Patel",
    role: "BCBA",
    preview: "I reviewed the supervision notes and added the follow-up task.",
    timestamp: "Yesterday",
    unreadCount: 0,
    tags: ["Supervision"],
    online: false,
  },
  {
    id: "T-006",
    initials: "MR",
    name: "Marcos Rivera",
    role: "RBT",
    preview: "I will be out Friday morning. Can we adjust the client coverage?",
    timestamp: "Mon",
    unreadCount: 0,
    tags: ["Time off"],
    online: false,
  },
];

const navItems = [
  { key: "home", label: "Home", icon: Home },
  { key: "schedule", label: "Schedule", icon: CalendarDays },
  { key: "clients", label: "Clients", icon: Users },
  { key: "providers", label: "Providers", icon: UserRound },
  { key: "sessions", label: "Sessions", icon: ClipboardList },
  { key: "communications", label: "Communications", icon: MessageCircle },
  { key: "reports", label: "Reports", icon: BarChart3 },
  { key: "billing", label: "Billing", icon: Receipt },
  { key: "settings", label: "Settings", icon: Settings },
];

const aiCards = [
  {
    title: "Message summary",
    description: "Jordan needs coverage for Liam’s Tuesday 4:00 PM session due to a prior commitment.",
  },
  {
    title: "Draft reply",
    description: "Generate a professional reply confirming next steps and when Jordan can expect an update.",
  },
  {
    title: "Check schedule conflicts",
    description: "Review available RBTs and overlapping sessions for Tuesday at 4:00 PM.",
  },
  {
    title: "Create follow-up task",
    description: "Add a task to confirm coverage and notify the caregiver once assigned.",
  },
  {
    title: "Escalate to BCBA",
    description: "Notify the supervising BCBA if coverage cannot be secured before end of day.",
  },
];

const smartReplies = [
  "Check availability",
  "Propose time options",
  "Confirm coverage",
  "Thank you",
];

function Avatar({ initials, online = false, size = 42, className = "" }) {
  return (
    <span className={`comms-avatar ${className}`} style={{ width: size, height: size, fontSize: size >= 48 ? 16 : 14 }}>
      {initials}
      {online && <span className="comms-online-dot" />}
    </span>
  );
}

function AppSidebar({
  logoFullSrc = "/assets/all-together-autism-logo.svg",
  logoMarkSrc = "/assets/all-together-autism-mark.svg",
}) {
  return (
    <aside className="comms-sidebar">
      <div className="comms-logo-wrap">
        <img
          className="comms-logo-full"
          src={logoFullSrc}
          alt="All Together Autism"
          onError={(event) => {
            event.currentTarget.style.display = "none";
            const fallback = event.currentTarget.nextElementSibling;
            if (fallback) fallback.style.display = "flex";
          }}
        />
        <div className="comms-logo-fallback" aria-label="All Together Autism">
          <span className="comms-loop-mark">∞</span>
          <span className="comms-logo-text">All Together Autism</span>
        </div>
      </div>

      <nav className="comms-nav" aria-label="Primary navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = item.key === "communications";
          return (
            <button
              key={item.key}
              type="button"
              className={`comms-nav-item ${active ? "comms-nav-item-active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <Icon size={20} strokeWidth={1.85} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="comms-sidebar-footer">
        <button type="button" className="comms-nav-item">
          <HelpCircle size={20} strokeWidth={1.85} />
          <span>Help</span>
        </button>

        <div className="comms-profile">
          <Avatar initials="AK" online size={40} />
          <div className="comms-profile-copy">
            <div className="comms-profile-name">Alyssa Kim</div>
            <div className="comms-profile-role">
              <span className="comms-status-dot" />
              Online
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function Button({ children, variant = "primary", size = "md", iconLeft, iconRight, className = "", ...props }) {
  return (
    <button type="button" className={`comms-btn comms-btn-${variant} comms-btn-${size} ${className}`} {...props}>
      {iconLeft}
      {children}
      {iconRight}
    </button>
  );
}

function Chip({ children, color = "default" }) {
  return <span className={`comms-chip comms-chip-${color}`}>{children}</span>;
}

function ThreadCard({ thread }) {
  const tagColor = (tag) => {
    if (tag.toLowerCase().includes("coverage")) return "purple";
    if (tag.toLowerCase().includes("urgent")) return "danger";
    if (tag.toLowerCase().includes("client")) return "blue";
    return "default";
  };

  return (
    <button
      type="button"
      className={`comms-thread-card ${thread.selected ? "comms-thread-card-selected" : ""}`}
      aria-pressed={thread.selected}
    >
      <Avatar initials={thread.initials} online={thread.online} />
      <span className="comms-thread-main">
        <span className="comms-thread-name">{thread.name}</span>
        <span className="comms-thread-role">{thread.role}</span>
        <span className="comms-thread-preview">{thread.preview}</span>
        <span className="comms-thread-tags">
          {thread.tags.map((tag) => (
            <Chip key={tag} color={tagColor(tag)}>
              {tag}
            </Chip>
          ))}
        </span>
      </span>
      <span className="comms-thread-meta">
        <span className="comms-thread-time">{thread.timestamp}</span>
        {thread.unreadCount > 0 && <span className="comms-unread-badge">{thread.unreadCount}</span>}
      </span>
    </button>
  );
}

function ThreadListPanel() {
  return (
    <aside className="comms-thread-panel">
      <header className="comms-thread-header">
        <div>
          <h1 className="comms-page-title">Communications</h1>
          <p className="comms-page-subtitle">Coordinate messages with providers and clients</p>
        </div>
        <Button size="sm" iconLeft={<Plus size={15} />}>
          New
        </Button>
      </header>

      <div className="comms-thread-tools">
        <div className="comms-search">
          <Search className="comms-search-icon" size={18} />
          <input className="comms-search-input" placeholder="Search conversations..." />
        </div>

        <div className="comms-filter-row" aria-label="Conversation filters">
          {["All", "Unread", "Providers", "Clients", "Urgent", "Coverage"].map((filter, index) => (
            <button
              key={filter}
              type="button"
              className={`comms-filter-chip ${index === 0 ? "comms-filter-chip-active" : ""}`}
            >
              {filter}
            </button>
          ))}
        </div>
      </div>

      <div className="comms-thread-scroll">
        <div className="comms-thread-group-label">Today</div>
        {threads.slice(0, 3).map((thread) => (
          <ThreadCard key={thread.id} thread={thread} />
        ))}

        <div className="comms-thread-group-label">Yesterday</div>
        {threads.slice(3, 5).map((thread) => (
          <ThreadCard key={thread.id} thread={thread} />
        ))}

        <div className="comms-thread-group-label">Older</div>
        {threads.slice(5).map((thread) => (
          <ThreadCard key={thread.id} thread={thread} />
        ))}
      </div>
    </aside>
  );
}

function ConversationHeader() {
  return (
    <header className="comms-conversation-header">
      <div className="comms-conversation-identity">
        <Avatar initials="JS" online size={48} />
        <div className="comms-conversation-copy">
          <div className="comms-conversation-title">Jordan Smith</div>
          <div className="comms-conversation-subtitle">RBT · Online</div>
          <div className="comms-conversation-chips">
            <Chip color="blue">Client: Liam P.</Chip>
            <Chip color="purple">Coverage needed</Chip>
            <Chip color="warning">Awaiting reply</Chip>
          </div>
        </div>
      </div>

      <div className="comms-header-actions">
        <button type="button" className="comms-icon-btn" aria-label="Call Jordan Smith">
          <Phone size={17} />
        </button>
        <button type="button" className="comms-icon-btn" aria-label="Open profile">
          <UserCircle size={17} />
        </button>
        <button type="button" className="comms-icon-btn" aria-label="More actions">
          <MoreHorizontal size={17} />
        </button>
      </div>
    </header>
  );
}

function ContextRow() {
  return (
    <div className="comms-context-row">
      <div className="comms-context-card">
        <span className="comms-context-label">Upcoming session</span>
        <strong>Tue 4:00 PM</strong>
      </div>
      <div className="comms-context-card">
        <span className="comms-context-label">Assigned client</span>
        <strong>Liam P.</strong>
      </div>
      <div className="comms-context-card">
        <span className="comms-context-label">Coverage risk</span>
        <strong>High</strong>
      </div>
    </div>
  );
}

function DateDivider({ children }) {
  return (
    <div className="comms-date-divider">
      <span>{children}</span>
    </div>
  );
}

function MessageBubble({ outbound = false, sender, time, children }) {
  return (
    <div className={`comms-message-row ${outbound ? "comms-message-row-outbound" : ""}`}>
      <div className="comms-message-wrap">
        <div className={`comms-message-label ${outbound ? "comms-message-label-outbound" : ""}`}>
          {sender} <span>{time}</span>
        </div>
        <div className={`comms-message-bubble ${outbound ? "comms-message-bubble-outbound" : "comms-message-bubble-inbound"}`}>
          {children}
        </div>
      </div>
    </div>
  );
}

function MessageTimeline() {
  return (
    <main className="comms-message-timeline">
      <DateDivider>Today</DateDivider>

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
  );
}

function SmartReplies() {
  return (
    <div className="comms-smart-replies">
      <span className="comms-smart-label">Smart replies</span>
      {smartReplies.map((reply) => (
        <button key={reply} type="button" className="comms-smart-chip">
          {reply}
        </button>
      ))}
    </div>
  );
}

function MessageComposer() {
  return (
    <footer className="comms-composer-wrap">
      <div className="comms-composer">
        <textarea className="comms-composer-textarea" placeholder="Type a message..." aria-label="Message body" />
        <div className="comms-composer-toolbar">
          <div className="comms-composer-left">
            <button type="button" className="comms-tool-btn" aria-label="Attach file">
              <Paperclip size={17} />
            </button>
            <button type="button" className="comms-tool-btn" aria-label="Emoji">
              <Smile size={17} />
            </button>
            <button type="button" className="comms-tool-btn" aria-label="AI assist">
              <Sparkles size={17} />
            </button>
          </div>
          <Button size="sm" iconRight={<Send size={15} />}>
            Send
          </Button>
        </div>
      </div>
    </footer>
  );
}

function ConversationPanel() {
  return (
    <section className="comms-conversation-panel">
      <ConversationHeader />
      <ContextRow />
      <MessageTimeline />
      <SmartReplies />
      <MessageComposer />
    </section>
  );
}

function AISuggestionsPanel() {
  return (
    <aside className="comms-ai-panel" aria-label="AI Suggestions">
      <header className="comms-ai-header">
        <h2>AI Suggestions</h2>
        <span className="comms-beta-badge">BETA</span>
      </header>

      <div className="comms-ai-scroll">
        {aiCards.map((card) => (
          <article key={card.title} className="comms-ai-card">
            <div className="comms-ai-card-title">{card.title}</div>
            <p className="comms-ai-card-description">{card.description}</p>
          </article>
        ))}

        <article className="comms-ai-reply-preview">
          <div className="comms-ai-card-title">Suggested reply preview</div>
          <p>
            Thanks for letting me know, Jordan. I’m checking availability now and will confirm coverage for Liam’s Tuesday 4:00 PM session shortly.
          </p>
          <Button size="sm" className="comms-ai-use-btn">
            Use this reply
          </Button>
        </article>
      </div>

      <footer className="comms-ai-disclaimer">
        AI can make mistakes. Verify important details.
      </footer>
    </aside>
  );
}

export default function CommsPage(props) {
  return (
    <>
      <CommsStyles />
      <div className="comms-shell">
        <AppSidebar {...props} />
        <ThreadListPanel />
        <ConversationPanel />
        <AISuggestionsPanel />
      </div>
    </>
  );
}

function CommsStyles() {
  return (
    <style>{`
      :root {
        --ata-blue-25: #F5F9FF;
        --ata-blue-50: #EFF6FF;
        --ata-blue-100: #DBEAFE;
        --ata-blue-200: #BFDBFE;
        --ata-blue-500: #3B82F6;
        --ata-blue-600: #2563EB;
        --ata-blue-700: #1D4ED8;
        --ata-blue-800: #1E40AF;
        --ata-navy-950: #061529;
        --ata-navy-900: #08203D;
        --ata-navy-850: #0A2A50;
        --ata-white: #FFFFFF;
        --ata-bg: #F8FAFC;
        --ata-gray-25: #FCFCFD;
        --ata-gray-50: #F9FAFB;
        --ata-gray-100: #F2F4F7;
        --ata-gray-200: #EAECF0;
        --ata-gray-300: #D0D5DD;
        --ata-gray-400: #98A2B3;
        --ata-gray-500: #667085;
        --ata-gray-600: #475467;
        --ata-gray-700: #344054;
        --ata-gray-800: #1D2939;
        --ata-gray-900: #101828;
        --ata-success-50: #ECFDF3;
        --ata-success-100: #D1FADF;
        --ata-success-500: #12B76A;
        --ata-success-600: #039855;
        --ata-success-700: #027A48;
        --ata-warning-50: #FFFAEB;
        --ata-warning-100: #FEF0C7;
        --ata-warning-500: #F79009;
        --ata-warning-600: #DC6803;
        --ata-danger-50: #FEF3F2;
        --ata-danger-100: #FEE4E2;
        --ata-danger-600: #D92D20;
        --ata-danger-700: #B42318;
        --ata-purple-50: #F4F3FF;
        --ata-purple-100: #EBE9FE;
        --ata-purple-600: #6938EF;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      .comms-shell {
        display: grid;
        grid-template-columns: 184px 360px minmax(560px, 1fr) 320px;
        height: 100vh;
        width: 100%;
        overflow: hidden;
        background: #FFFFFF;
        color: var(--ata-gray-900);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      button,
      input,
      textarea {
        font: inherit;
      }

      button {
        cursor: pointer;
      }

      button:focus-visible,
      input:focus-visible,
      textarea:focus-visible {
        outline: 2px solid var(--ata-blue-500);
        outline-offset: 2px;
      }

      .comms-sidebar {
        width: 184px;
        height: 100vh;
        background: linear-gradient(180deg, #061529 0%, #08203D 52%, #061529 100%);
        color: #FFFFFF;
        border-right: 1px solid rgba(255,255,255,0.06);
        display: flex;
        flex-direction: column;
        padding: 20px 12px 16px;
        min-width: 0;
      }

      .comms-logo-wrap {
        height: 52px;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 18px;
      }

      .comms-logo-full {
        max-width: 144px;
        max-height: 44px;
        object-fit: contain;
      }

      .comms-logo-fallback {
        display: none;
        align-items: center;
        gap: 8px;
        color: #FFFFFF;
      }

      .comms-loop-mark {
        width: 34px;
        height: 34px;
        border-radius: 12px;
        background: var(--ata-blue-600);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-weight: 900;
        font-size: 22px;
      }

      .comms-logo-text {
        font-size: 13px;
        font-weight: 800;
        line-height: 1.1;
        max-width: 98px;
      }

      .comms-nav {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .comms-nav-item {
        width: 100%;
        height: 44px;
        border-radius: 12px;
        padding: 0 12px;
        display: flex;
        align-items: center;
        gap: 12px;
        border: 0;
        background: transparent;
        color: rgba(255,255,255,0.82);
        font-size: 14px;
        font-weight: 500;
        text-align: left;
      }

      .comms-nav-item:hover {
        background: rgba(255,255,255,0.08);
        color: #FFFFFF;
      }

      .comms-nav-item-active {
        background: linear-gradient(180deg, #2563EB 0%, #1D4ED8 100%);
        color: #FFFFFF;
        box-shadow: 0 8px 20px rgba(37, 99, 235, 0.34);
      }

      .comms-sidebar-footer {
        margin-top: auto;
        padding-top: 14px;
        border-top: 1px solid rgba(255,255,255,0.12);
      }

      .comms-profile {
        margin-top: 12px;
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .comms-profile-name {
        font-size: 13px;
        font-weight: 800;
      }

      .comms-profile-role {
        margin-top: 2px;
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: rgba(255,255,255,0.72);
      }

      .comms-status-dot {
        width: 8px;
        height: 8px;
        border-radius: 9999px;
        background: var(--ata-success-500);
      }

      .comms-thread-panel {
        height: 100vh;
        background: #FFFFFF;
        border-right: 1px solid var(--ata-gray-200);
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      .comms-thread-header {
        padding: 20px 16px 16px;
        border-bottom: 1px solid var(--ata-gray-200);
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
      }

      .comms-page-title {
        margin: 0;
        font-size: 24px;
        line-height: 32px;
        font-weight: 800;
        color: var(--ata-gray-900);
      }

      .comms-page-subtitle {
        margin: 4px 0 0;
        font-size: 14px;
        line-height: 20px;
        color: var(--ata-gray-600);
      }

      .comms-btn {
        border: 1px solid transparent;
        border-radius: 10px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        font-size: 14px;
        font-weight: 800;
        white-space: nowrap;
      }

      .comms-btn-primary {
        background: var(--ata-blue-600);
        color: #FFFFFF;
      }

      .comms-btn-primary:hover {
        background: var(--ata-blue-700);
      }

      .comms-btn-secondary {
        background: #FFFFFF;
        border-color: var(--ata-gray-200);
        color: var(--ata-gray-800);
      }

      .comms-btn-sm {
        height: 36px;
        padding: 0 12px;
        border-radius: 8px;
      }

      .comms-btn-md {
        height: 44px;
        padding: 0 18px;
      }

      .comms-thread-tools {
        padding: 14px 16px;
        border-bottom: 1px solid var(--ata-gray-100);
      }

      .comms-search {
        position: relative;
        display: flex;
        align-items: center;
      }

      .comms-search-icon {
        position: absolute;
        left: 12px;
        color: var(--ata-gray-400);
      }

      .comms-search-input {
        height: 42px;
        width: 100%;
        border-radius: 10px;
        border: 1px solid var(--ata-gray-200);
        background: #FFFFFF;
        padding: 0 12px 0 38px;
        font-size: 14px;
        color: var(--ata-gray-900);
      }

      .comms-search-input::placeholder {
        color: var(--ata-gray-400);
      }

      .comms-filter-row {
        margin-top: 12px;
        display: flex;
        gap: 8px;
        overflow-x: auto;
        scrollbar-width: none;
      }

      .comms-filter-row::-webkit-scrollbar {
        display: none;
      }

      .comms-filter-chip {
        height: 30px;
        padding: 0 12px;
        border-radius: 9999px;
        font-size: 13px;
        font-weight: 700;
        border: 1px solid var(--ata-gray-200);
        background: #FFFFFF;
        color: var(--ata-gray-600);
        white-space: nowrap;
      }

      .comms-filter-chip-active {
        background: var(--ata-blue-50);
        border-color: var(--ata-blue-200);
        color: var(--ata-blue-700);
      }

      .comms-thread-scroll {
        flex: 1;
        overflow-y: auto;
        padding: 10px;
      }

      .comms-thread-group-label {
        padding: 14px 8px 8px;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: .04em;
        text-transform: uppercase;
        color: var(--ata-gray-500);
      }

      .comms-thread-card {
        width: 100%;
        min-height: 92px;
        padding: 14px;
        border-radius: 14px;
        display: grid;
        grid-template-columns: 42px 1fr auto;
        gap: 12px;
        border: 1px solid transparent;
        background: #FFFFFF;
        text-align: left;
        margin-bottom: 4px;
      }

      .comms-thread-card:hover {
        background: var(--ata-gray-50);
        border-color: var(--ata-gray-200);
      }

      .comms-thread-card-selected {
        background: var(--ata-blue-50);
        border-color: var(--ata-blue-200);
        box-shadow: inset 3px 0 0 var(--ata-blue-600);
      }

      .comms-avatar {
        position: relative;
        border-radius: 9999px;
        background: var(--ata-blue-600);
        color: #FFFFFF;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-weight: 800;
        flex: 0 0 auto;
      }

      .comms-online-dot {
        position: absolute;
        right: 0;
        bottom: 0;
        width: 10px;
        height: 10px;
        border-radius: 9999px;
        background: var(--ata-success-500);
        border: 2px solid #FFFFFF;
      }

      .comms-thread-main {
        min-width: 0;
      }

      .comms-thread-name {
        display: block;
        font-size: 14px;
        line-height: 20px;
        font-weight: 800;
        color: var(--ata-gray-900);
      }

      .comms-thread-role {
        display: block;
        font-size: 12px;
        line-height: 16px;
        color: var(--ata-gray-500);
        margin-bottom: 4px;
      }

      .comms-thread-preview {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        font-size: 13px;
        line-height: 18px;
        color: var(--ata-gray-600);
      }

      .comms-thread-tags {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        margin-top: 8px;
      }

      .comms-thread-meta {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 8px;
      }

      .comms-thread-time {
        font-size: 12px;
        line-height: 16px;
        font-weight: 700;
        color: var(--ata-gray-500);
        white-space: nowrap;
      }

      .comms-unread-badge {
        min-width: 22px;
        height: 22px;
        padding: 0 7px;
        border-radius: 9999px;
        background: var(--ata-blue-600);
        color: #FFFFFF;
        font-size: 12px;
        font-weight: 800;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .comms-chip {
        height: 24px;
        padding: 0 9px;
        border-radius: 9999px;
        display: inline-flex;
        align-items: center;
        border: 1px solid var(--ata-gray-200);
        background: #FFFFFF;
        color: var(--ata-gray-600);
        font-size: 12px;
        font-weight: 700;
        white-space: nowrap;
      }

      .comms-chip-blue {
        background: var(--ata-blue-50);
        border-color: var(--ata-blue-100);
        color: var(--ata-blue-700);
      }

      .comms-chip-purple {
        background: var(--ata-purple-50);
        border-color: var(--ata-purple-100);
        color: var(--ata-purple-600);
      }

      .comms-chip-warning {
        background: var(--ata-warning-50);
        border-color: var(--ata-warning-100);
        color: var(--ata-warning-600);
      }

      .comms-chip-danger {
        background: var(--ata-danger-50);
        border-color: var(--ata-danger-100);
        color: var(--ata-danger-700);
      }

      .comms-conversation-panel {
        height: 100vh;
        display: flex;
        flex-direction: column;
        background: #FFFFFF;
        min-width: 0;
      }

      .comms-conversation-header {
        height: 104px;
        padding: 18px 24px;
        border-bottom: 1px solid var(--ata-gray-200);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 20px;
        background: rgba(255,255,255,0.96);
      }

      .comms-conversation-identity {
        display: flex;
        align-items: center;
        gap: 14px;
        min-width: 0;
      }

      .comms-conversation-copy {
        min-width: 0;
      }

      .comms-conversation-title {
        font-size: 18px;
        line-height: 26px;
        font-weight: 800;
        color: var(--ata-gray-900);
      }

      .comms-conversation-subtitle {
        font-size: 13px;
        line-height: 18px;
        color: var(--ata-gray-500);
      }

      .comms-conversation-chips {
        margin-top: 6px;
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }

      .comms-header-actions {
        display: flex;
        gap: 8px;
      }

      .comms-icon-btn,
      .comms-tool-btn {
        border: 0;
        background: transparent;
        color: var(--ata-gray-600);
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .comms-icon-btn {
        width: 40px;
        height: 40px;
        border-radius: 10px;
        border: 1px solid var(--ata-gray-200);
        background: #FFFFFF;
      }

      .comms-icon-btn:hover,
      .comms-tool-btn:hover {
        background: var(--ata-gray-50);
      }

      .comms-context-row {
        padding: 12px 24px;
        border-bottom: 1px solid var(--ata-gray-100);
        background: var(--ata-gray-25);
        display: flex;
        gap: 10px;
        overflow-x: auto;
      }

      .comms-context-card {
        height: 52px;
        min-width: 176px;
        padding: 8px 12px;
        border-radius: 12px;
        background: #FFFFFF;
        border: 1px solid var(--ata-gray-200);
        display: flex;
        flex-direction: column;
        justify-content: center;
      }

      .comms-context-label {
        font-size: 11px;
        font-weight: 800;
        text-transform: uppercase;
        color: var(--ata-gray-500);
      }

      .comms-context-card strong {
        margin-top: 2px;
        font-size: 13px;
        color: var(--ata-gray-900);
      }

      .comms-message-timeline {
        flex: 1;
        overflow-y: auto;
        padding: 24px;
        background: linear-gradient(180deg, #FFFFFF 0%, #FBFCFE 100%);
      }

      .comms-date-divider {
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 8px 0 22px;
      }

      .comms-date-divider span {
        height: 24px;
        padding: 0 12px;
        border-radius: 9999px;
        background: var(--ata-gray-100);
        color: var(--ata-gray-600);
        font-size: 12px;
        font-weight: 800;
        display: inline-flex;
        align-items: center;
      }

      .comms-message-row {
        display: flex;
        justify-content: flex-start;
        margin-bottom: 18px;
      }

      .comms-message-row-outbound {
        justify-content: flex-end;
      }

      .comms-message-wrap {
        max-width: 680px;
      }

      .comms-message-label {
        margin-bottom: 4px;
        font-size: 12px;
        font-weight: 800;
        color: var(--ata-gray-700);
      }

      .comms-message-label span {
        margin-left: 6px;
        font-size: 11px;
        font-weight: 500;
        color: var(--ata-gray-400);
      }

      .comms-message-label-outbound {
        text-align: right;
      }

      .comms-message-bubble {
        padding: 12px 14px;
        border-radius: 16px;
        font-size: 14px;
        line-height: 1.45;
        word-wrap: break-word;
      }

      .comms-message-bubble-inbound {
        background: #FFFFFF;
        border: 1px solid var(--ata-gray-200);
        color: var(--ata-gray-800);
        box-shadow: 0 1px 2px rgba(16, 24, 40, 0.05);
        border-top-left-radius: 6px;
      }

      .comms-message-bubble-outbound {
        background: var(--ata-blue-50);
        border: 1px solid var(--ata-blue-200);
        color: var(--ata-gray-900);
        border-top-right-radius: 6px;
      }

      .comms-smart-replies {
        padding: 10px 24px 0;
        display: flex;
        align-items: center;
        gap: 8px;
        overflow-x: auto;
        background: #FFFFFF;
      }

      .comms-smart-label {
        font-size: 12px;
        font-weight: 800;
        color: var(--ata-gray-500);
        white-space: nowrap;
      }

      .comms-smart-chip {
        height: 26px;
        padding: 0 10px;
        border-radius: 9999px;
        border: 1px solid var(--ata-gray-200);
        background: #FFFFFF;
        color: var(--ata-gray-700);
        font-size: 12px;
        font-weight: 700;
        white-space: nowrap;
      }

      .comms-smart-chip:hover {
        background: var(--ata-blue-50);
        border-color: var(--ata-blue-200);
        color: var(--ata-blue-700);
      }

      .comms-composer-wrap {
        border-top: 1px solid var(--ata-gray-200);
        background: #FFFFFF;
        padding: 16px 24px 20px;
      }

      .comms-composer {
        border: 1px solid var(--ata-gray-200);
        border-radius: 16px;
        background: #FFFFFF;
        box-shadow: 0 1px 2px rgba(16, 24, 40, 0.05);
        overflow: hidden;
      }

      .comms-composer-textarea {
        min-height: 84px;
        width: 100%;
        padding: 14px;
        border: none;
        resize: none;
        outline: none;
        font-size: 14px;
        line-height: 1.5;
        color: var(--ata-gray-900);
      }

      .comms-composer-textarea::placeholder {
        color: var(--ata-gray-400);
      }

      .comms-composer-toolbar {
        height: 44px;
        padding: 0 10px;
        border-top: 1px solid var(--ata-gray-100);
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .comms-composer-left {
        display: flex;
        gap: 6px;
      }

      .comms-tool-btn {
        width: 34px;
        height: 34px;
        border-radius: 8px;
      }

      .comms-ai-panel {
        height: 100vh;
        background: #FFFFFF;
        border-left: 1px solid var(--ata-gray-200);
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      .comms-ai-header {
        height: 72px;
        padding: 18px 20px;
        border-bottom: 1px solid var(--ata-gray-200);
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .comms-ai-header h2 {
        margin: 0;
        font-size: 18px;
        line-height: 26px;
        font-weight: 800;
        color: var(--ata-gray-900);
      }

      .comms-beta-badge {
        height: 22px;
        padding: 0 8px;
        border-radius: 9999px;
        background: var(--ata-purple-50);
        color: var(--ata-purple-600);
        font-size: 11px;
        font-weight: 800;
        display: inline-flex;
        align-items: center;
      }

      .comms-ai-scroll {
        flex: 1;
        overflow-y: auto;
        padding: 18px 16px;
      }

      .comms-ai-card,
      .comms-ai-reply-preview {
        padding: 14px;
        border-radius: 14px;
        border: 1px solid var(--ata-gray-200);
        background: #FFFFFF;
        box-shadow: 0 1px 2px rgba(16, 24, 40, 0.05);
        margin-bottom: 12px;
      }

      .comms-ai-reply-preview {
        background: var(--ata-blue-25);
        border-color: var(--ata-blue-100);
      }

      .comms-ai-card-title {
        font-size: 14px;
        line-height: 20px;
        font-weight: 800;
        color: var(--ata-gray-900);
      }

      .comms-ai-card-description,
      .comms-ai-reply-preview p {
        margin: 4px 0 0;
        font-size: 13px;
        line-height: 18px;
        color: var(--ata-gray-600);
      }

      .comms-ai-use-btn {
        margin-top: 12px;
        width: 100%;
      }

      .comms-ai-disclaimer {
        padding: 12px 16px;
        border-top: 1px solid var(--ata-gray-100);
        font-size: 11px;
        line-height: 16px;
        color: var(--ata-gray-500);
      }

      @media (max-width: 1439px) {
        .comms-shell {
          grid-template-columns: 184px 340px minmax(520px, 1fr) 300px;
        }
      }

      @media (max-width: 1199px) {
        .comms-shell {
          grid-template-columns: 184px 340px minmax(520px, 1fr);
        }

        .comms-ai-panel {
          display: none;
        }
      }
    `}</style>
  );
}
