# Comms.MD — All Together Autism Communications Page Implementation Specification

**File purpose:** This is a codebase-level implementation specification for the **Communications / Chat** page. It should be handed to Claude Code / IDE agent together with `Comms.jsx`.

**Product:** All Together Autism  
**Page:** Communications  
**Target route:** Use the existing route if one already exists. Otherwise use `/communications`.  
**Design goal:** Implement a professional, modern, healthcare SaaS messaging workspace matching the previously approved design: left All Together Autism navigation, provider/client thread list, central chat panel, and right AI Suggestions panel.

---

## 0. Non-Negotiable Requirements

1. Use **All Together Autism** branding only.
2. Do not use or introduce any placeholder brand names.
3. Use the provided All Together Autism logo asset:
   - Full logo when there is enough horizontal space.
   - Blue connected-loop mark in compact logo contexts.
4. The Communications page must have:
   - Dark navy global app sidebar.
   - Thread list panel.
   - Main conversation/chat panel.
   - AI Suggestions panel.
5. The Communications page should be visually cohesive with the approved All Together Autism schedule, clients, providers, and modal designs.
6. Do not implement this as a plain table, plain textarea, or default browser-looking UI.
7. Build reusable components where possible:
   - `AppSidebar`
   - `ThreadList`
   - `ThreadCard`
   - `ConversationHeader`
   - `MessageBubble`
   - `SmartReplies`
   - `MessageComposer`
   - `AISuggestionsPanel`
8. Preserve existing business logic and message-sending behavior if the codebase already has it.
9. If AI functionality is not wired yet, implement the visual shell and disabled/static suggestions; do not invent backend calls.
10. The implementation must be responsive enough for desktop widths down to 1366px.

---

## 1. High-Level Page Layout

The Communications page is a full-height desktop workspace.

### 1.1 Desktop Grid

```txt
Total page height: 100vh

Global sidebar:       184px fixed
Thread list panel:    360px fixed
Conversation panel:   minmax(560px, 1fr)
AI Suggestions panel: 320px fixed
```

### 1.2 Layout CSS

```css
.comms-shell {
  display: grid;
  grid-template-columns: 184px 360px minmax(560px, 1fr) 320px;
  height: 100vh;
  width: 100%;
  overflow: hidden;
  background: #ffffff;
}
```

### 1.3 Visual Hierarchy

```txt
Level 1: All Together Autism app sidebar
Level 2: Communications title, thread filters, active thread
Level 3: Active conversation header and context chips
Level 4: Message timeline
Level 5: Composer and AI Suggestions panel
```

---

## 2. Design Tokens

Use these exact values unless the global app design system already defines identical tokens.

### 2.1 Colors

```css
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
}
```

### 2.2 Typography

```txt
Font stack:
  Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif

Page title:
  24px / 32px, 700, gray-900

Panel title:
  18px / 26px, 700, gray-900

Thread name:
  14px / 20px, 700, gray-900

Thread preview:
  13px / 18px, 400, gray-600

Message body:
  14px / 20px, 400, gray-800

Helper text:
  12px / 16px, 500, gray-500

Buttons:
  14px / 20px, 700
```

### 2.3 Borders, Radius, and Shadows

```txt
Default border: 1px solid #EAECF0
Strong border: 1px solid #D0D5DD
Card radius: 14px
Panel radius: 0px
Bubble radius: 16px
Input radius: 10px
Button radius: 10px
Thread card radius: 14px

Card shadow:
  0 1px 2px rgba(16, 24, 40, 0.05)

Popover / AI card shadow:
  0 1px 3px rgba(16, 24, 40, 0.10), 0 1px 2px rgba(16, 24, 40, 0.06)
```

---

## 3. Global App Sidebar

### 3.1 Dimensions

```txt
Width: 184px
Height: 100vh
Padding: 20px 12px 16px
Background: linear-gradient(180deg, #061529 0%, #08203D 52%, #061529 100%)
Border right: 1px solid rgba(255, 255, 255, 0.06)
```

### 3.2 Logo

```txt
Logo area height: 52px
Full logo max width: 144px
Full logo max height: 44px
Fallback mark: use blue connected-loop mark only
```

If the logo asset path differs, update in `Comms.jsx`:

```jsx
logoFullSrc="/assets/all-together-autism-logo.svg"
logoMarkSrc="/assets/all-together-autism-mark.svg"
```

### 3.3 Nav Items

Order:

```txt
Home
Schedule
Clients
Providers
Sessions
Communications
Reports
Billing
Settings
Help
```

Communications must be active.

Nav item dimensions:

```txt
Height: 44px
Border radius: 12px
Horizontal padding: 12px
Gap between icon and label: 12px
Font size: 14px
Font weight: 500
```

Active state:

```css
background: linear-gradient(180deg, #2563EB 0%, #1D4ED8 100%);
color: #FFFFFF;
box-shadow: 0 8px 20px rgba(37, 99, 235, 0.34);
```

Inactive state:

```css
color: rgba(255,255,255,0.82);
background: transparent;
```

Hover state:

```css
background: rgba(255,255,255,0.08);
color: #FFFFFF;
```

---

## 4. Thread List Panel

### 4.1 Panel Dimensions

```txt
Width: 360px
Height: 100vh
Background: #FFFFFF
Right border: 1px solid #EAECF0
Display: flex column
```

### 4.2 Thread Header

```txt
Padding: 20px 16px 16px
Border bottom: 1px solid #EAECF0
```

Header content:

```txt
Title: Communications
Subtitle: Coordinate messages with providers and clients
Primary action: New
```

New button:

```txt
Height: 36px
Padding: 0 12px
Radius: 8px
Background: #2563EB
Color: #FFFFFF
Font: 14px / 20px, 700
```

### 4.3 Search and Filters

Search area:

```txt
Padding: 14px 16px
Border bottom: 1px solid #F2F4F7
```

Search input:

```txt
Height: 42px
Width: 100%
Border: 1px solid #EAECF0
Border radius: 10px
Padding left: 38px
Padding right: 12px
Placeholder: Search conversations...
```

Filter chips row:

```txt
Margin top: 12px
Display: flex
Gap: 8px
Horizontal overflow if needed
```

Required filter chips:

```txt
All
Unread
Providers
Clients
Urgent
Coverage
```

Chip style:

```txt
Height: 30px
Padding: 0 12px
Radius: 9999px
Font size: 13px
Font weight: 600
Border: 1px solid #EAECF0
Background: #FFFFFF
Color: #475467
```

Active chip:

```txt
Background: #EFF6FF
Border: #BFDBFE
Color: #1D4ED8
```

### 4.4 Thread Groups

Thread groups should be labeled.

```txt
TODAY
YESTERDAY
OLDER
```

Group label:

```txt
Padding: 14px 8px 8px
Font size: 11px
Font weight: 800
Letter spacing: 0.04em
Text transform: uppercase
Color: #667085
```

---

## 5. Thread Card

### 5.1 Component Purpose

Thread cards show each conversation. Use one component for all thread list rows.

Recommended name:

```txt
ThreadCard
```

### 5.2 Dimensions

```txt
Minimum height: 92px
Padding: 14px
Border radius: 14px
Grid columns: 42px 1fr auto
Column gap: 12px
Border: 1px solid transparent
Background: #FFFFFF
```

### 5.3 Selected Thread State

Selected thread is the current active conversation.

```css
background: #EFF6FF;
border-color: #BFDBFE;
box-shadow: inset 3px 0 0 #2563EB;
```

### 5.4 Avatar

```txt
Size: 42px x 42px
Radius: 9999px
Font size: 14px
Font weight: 700
Text color: white
```

Online dot:

```txt
Size: 10px
Background: #12B76A
Border: 2px solid white
Position: bottom right of avatar
```

### 5.5 Thread Copy

Name:

```txt
Font: 14px / 20px
Weight: 800
Color: #101828
```

Role:

```txt
Font: 12px / 16px
Weight: 500
Color: #667085
```

Preview:

```txt
Font: 13px / 18px
Weight: 400
Color: #475467
Clamp: 2 lines
```

Timestamp:

```txt
Font: 12px / 16px
Weight: 600
Color: #667085
```

Unread badge:

```txt
Min width: 22px
Height: 22px
Radius: 9999px
Background: #2563EB
Color: #FFFFFF
Font size: 12px
Weight: 800
```

### 5.6 Tags

Use chips at the bottom of the thread card.

Examples:

```txt
RBT
Provider
Caregiver
Coverage needed
Client
Urgent
```

Coverage tag:

```txt
Background: #F4F3FF
Border: #EBE9FE
Color: #6938EF
```

Urgent tag:

```txt
Background: #FEF3F2
Border: #FEE4E2
Color: #B42318
```

---

## 6. Conversation Panel

### 6.1 Panel Dimensions

```txt
Height: 100vh
Display: flex column
Background: #FFFFFF
Min width: 0
```

### 6.2 Conversation Header

```txt
Height: 104px
Padding: 18px 24px
Border bottom: 1px solid #EAECF0
Display: flex
Align items: center
Justify content: space-between
Gap: 20px
```

Header content:

```txt
Avatar: 48px
Name: Jordan Smith
Role/status: RBT · Online
Context chips:
  Client: Liam P.
  Coverage needed
  Awaiting reply
Actions:
  Phone
  Profile/contact
  More
```

Header button dimensions:

```txt
Width: 40px
Height: 40px
Border radius: 10px
Border: 1px solid #EAECF0
Background: #FFFFFF
```

### 6.3 Context Row

Directly below the conversation header.

```txt
Padding: 12px 24px
Border bottom: 1px solid #F2F4F7
Background: #FCFCFD
Display: flex
Gap: 10px
Overflow-x: auto
```

Context cards:

```txt
Height: 52px
Min width: 176px
Padding: 8px 12px
Border radius: 12px
Background: white
Border: 1px solid #EAECF0
Font: 13px / 18px
Weight: 600
```

Required context cards:

```txt
Upcoming session: Tue 4:00 PM
Assigned client: Liam P.
Coverage risk: High
```

---

## 7. Message Timeline

### 7.1 Timeline Container

```txt
Flex: 1
Overflow-y: auto
Padding: 24px
Background: linear-gradient(180deg, #FFFFFF 0%, #FBFCFE 100%)
```

### 7.2 Date Divider

```txt
Container: flex center
Margin: 8px 0 22px
Label height: 24px
Padding: 0 12px
Radius: 9999px
Background: #F2F4F7
Color: #475467
Font size: 12px
Font weight: 700
```

### 7.3 Message Bubble

Shared:

```txt
Max width: 680px
Padding: 12px 14px
Radius: 16px
Font: 14px / 20px
Word wrap: break-word
```

Inbound:

```css
background: #FFFFFF;
border: 1px solid #EAECF0;
box-shadow: 0 1px 2px rgba(16, 24, 40, 0.05);
border-top-left-radius: 6px;
```

Outbound:

```css
background: #EFF6FF;
border: 1px solid #BFDBFE;
border-top-right-radius: 6px;
```

Sender label:

```txt
Font size: 12px
Font weight: 700
Color: #344054
Margin bottom: 4px
```

Timestamp:

```txt
Font size: 11px
Font weight: 500
Color: #98A2B3
```

### 7.4 Required Example Conversation

Use this as the visual reference sample if no live data is available:

```txt
Thread: Jordan Smith, RBT
Topic: Coverage request for Tuesday 4:00 PM session

Jordan Smith — 10:02 AM
Hi! I received the schedule update. I’m currently booked for Tuesday at 4:00 PM with Liam. I won’t be able to make it due to a prior commitment. Can someone please cover this session?

You — 10:05 AM
No problem, Jordan. Thanks for letting me know early. I’ll look for coverage and confirm with you as soon as I have someone.

Jordan Smith — 10:12 AM
Thanks so much. Let me know if you need any details about Liam’s session.
```

---

## 8. Smart Replies

### 8.1 Placement

Smart replies sit directly above the composer.

```txt
Padding: 10px 24px 0
Display: flex
Align items: center
Gap: 8px
Overflow-x: auto
Background: #FFFFFF
```

Label:

```txt
Text: Smart replies
Font size: 12px
Font weight: 800
Color: #667085
```

Required smart reply chips:

```txt
Check availability
Propose time options
Confirm coverage
Thank you
```

Chip:

```txt
Height: 26px
Padding: 0 10px
Radius: 9999px
Border: 1px solid #EAECF0
Background: #FFFFFF
Font size: 12px
Font weight: 600
```

Hover:

```txt
Background: #EFF6FF
Border: #BFDBFE
Color: #1D4ED8
```

---

## 9. Message Composer

### 9.1 Composer Wrapper

```txt
Border top: 1px solid #EAECF0
Background: #FFFFFF
Padding: 16px 24px 20px
```

### 9.2 Composer Box

```txt
Border: 1px solid #EAECF0
Border radius: 16px
Background: #FFFFFF
Shadow: 0 1px 2px rgba(16, 24, 40, 0.05)
Overflow: hidden
```

Textarea:

```txt
Min height: 84px
Width: 100%
Padding: 14px
Border: none
Resize: none
Outline: none
Font size: 14px
Line height: 1.5
Placeholder: Type a message...
```

Toolbar:

```txt
Height: 44px
Padding: 0 10px
Border top: 1px solid #F2F4F7
Display: flex
Align items: center
Justify content: space-between
```

Left toolbar actions:

```txt
Attachment
Emoji
AI assist
```

Send button:

```txt
Height: 36px
Padding: 0 14px
Radius: 8px
Background: #2563EB
Color: #FFFFFF
Font weight: 700
```

Disabled send:

```txt
Background: #EAECF0
Color: #98A2B3
Cursor: not-allowed
```

---

## 10. AI Suggestions Panel

### 10.1 Panel Dimensions

```txt
Width: 320px
Height: 100vh
Background: #FFFFFF
Left border: 1px solid #EAECF0
Display: flex column
```

### 10.2 Header

```txt
Height: 72px
Padding: 18px 20px
Border bottom: 1px solid #EAECF0
Display: flex
Align items: center
Justify content: space-between
```

Title:

```txt
AI Suggestions
Font size: 18px
Font weight: 700
```

Beta badge:

```txt
Height: 22px
Padding: 0 8px
Radius: 9999px
Background: #F4F3FF
Color: #6938EF
Font size: 11px
Font weight: 800
```

### 10.3 Body

```txt
Flex: 1
Overflow-y: auto
Padding: 18px 16px
```

AI cards:

```txt
Padding: 14px
Border radius: 14px
Border: 1px solid #EAECF0
Background: #FFFFFF
Shadow: 0 1px 2px rgba(16, 24, 40, 0.05)
Margin bottom: 12px
```

Card title:

```txt
Font size: 14px
Font weight: 800
Color: #101828
```

Card description:

```txt
Margin top: 4px
Font size: 13px
Line height: 18px
Color: #475467
```

Required AI cards:

```txt
Message summary
Draft reply
Check schedule conflicts
Create follow-up task
Escalate to BCBA
```

Footer disclaimer:

```txt
AI can make mistakes. Verify important details.
Font size: 11px
Color: #667085
Padding: 12px 16px
Border top: 1px solid #F2F4F7
```

---

## 11. Required Sample Data

If live data is not available, use these sample threads:

```js
[
  {
    id: "T-001",
    initials: "JS",
    name: "Jordan Smith",
    role: "RBT",
    preview: "Thanks for reaching out! I can cover Tuesday’s 4:00 PM session.",
    timestamp: "10:31 AM",
    unreadCount: 2,
    tags: ["RBT", "Coverage needed"],
    selected: true
  },
  {
    id: "T-002",
    initials: "SJ",
    name: "Sarah Johnson",
    role: "Provider",
    preview: "I have a scheduling conflict on Wednesday at 4pm for Liam Parker.",
    timestamp: "10:24 AM",
    unreadCount: 1,
    tags: ["Coverage"]
  },
  {
    id: "T-003",
    initials: "MT",
    name: "Maria Torres",
    role: "Caregiver",
    preview: "Will the session still be at our home this week?",
    timestamp: "8:42 AM",
    unreadCount: 1,
    tags: ["Client"]
  },
  {
    id: "T-004",
    initials: "AC",
    name: "Ashley Chen",
    role: "RBT",
    preview: "Confirmed. I can keep the 9 AM session.",
    timestamp: "Yesterday",
    unreadCount: 0,
    tags: ["Provider"]
  }
]
```

---

## 12. Responsive Rules

### 12.1 Desktop ≥ 1440px

Use full four-column layout:

```txt
184px sidebar
360px threads
flex conversation
320px AI
```

### 12.2 Desktop 1200px–1439px

```txt
Sidebar: 184px
Threads: 340px
AI panel: 300px
Conversation: remaining width
```

### 12.3 Below 1200px

```txt
AI panel should become collapsible or hidden behind a button.
Do not squeeze all panels into unreadable widths.
```

### 12.4 Below 1024px

If mobile/tablet behavior exists:

```txt
Thread list and conversation should become separate views.
Do not show all three panels at once.
```

---

## 13. Accessibility

```txt
Sidebar active item: aria-current="page"
Icon-only buttons: aria-label required
Message composer textarea: aria-label="Message body"
Send button: disabled when no text
AI panel: landmark/aside with aria-label="AI Suggestions"
Thread cards: buttons or links with clear selected state
Focus ring: visible 2px blue outline
```

Modal behavior is not relevant to this page, but do not break global focus styles.

---

## 14. Implementation Notes for Claude Code

1. First locate the existing Communications page and message components.
2. Preserve existing message data fetching and send-message handlers.
3. Replace markup and styling with the structure in `Comms.jsx`.
4. If the app already has a global sidebar, update it to match the All Together Autism sidebar and set Communications active.
5. If the app already has shared Button/Input/Card components, refactor them to match these dimensions instead of duplicating.
6. Use existing icon library if present. The provided `Comms.jsx` uses `lucide-react`; map icons if necessary.
7. Wire real thread/message data into:
   - `ThreadCard`
   - `MessageBubble`
   - `ConversationHeader`
   - `AISuggestionsPanel`
8. If AI suggestions are not connected yet, render the static visual panel and disable actions.
9. Keep the page full-height and avoid body scroll; internal panels should scroll independently.
10. Do not implement schedule logic, client logic, or provider logic in this page. Only link to those existing routes/actions if available.

---

## 15. Acceptance Checklist

The Communications page is complete only if every item passes:

```txt
[ ] All Together Autism branding appears in the sidebar.
[ ] No incorrect placeholder brand appears.
[ ] Communications nav item is active.
[ ] Page uses a full-height four-column desktop layout.
[ ] Thread list width is 360px on large desktop.
[ ] Thread search input is visible.
[ ] Filter chips are visible: All, Unread, Providers, Clients, Urgent, Coverage.
[ ] Thread cards include avatar, name, role, preview, timestamp, tags, and unread badge.
[ ] Selected thread has blue-tinted background and 3px blue left inset.
[ ] Conversation header shows Jordan Smith, RBT, status, context chips, and action buttons.
[ ] Context row includes Upcoming session, Assigned client, and Coverage risk cards.
[ ] Message timeline has date divider.
[ ] Inbound messages are white with gray border.
[ ] Outbound messages are light blue with blue border.
[ ] Smart replies appear above composer.
[ ] Composer has textarea, attachment, emoji, AI action, and Send button.
[ ] AI Suggestions panel appears on the right.
[ ] AI cards include Message summary, Draft reply, Check schedule conflicts, Create follow-up task, Escalate to BCBA.
[ ] AI disclaimer appears at bottom.
[ ] Scroll areas are internal; page itself does not awkwardly scroll.
[ ] Focus states are visible.
[ ] The page visually matches the approved All Together Autism design system.
```

---

## 16. Visual One-to-One Notes

The intended design composition is:

```txt
Left: dark navy All Together Autism sidebar
Next: white conversation list with search and chips
Center: active chat with large readable message history
Right: white AI Suggestions panel with stacked action cards
```

The overall page should feel like a professional healthcare operations messaging product, not a generic chat demo.

Keep the look:

```txt
Clean
Modern
Dense enough for schedulers
Soft blue accents
Rounded but not childish
Professional clinical SaaS
Implementation-friendly
```
