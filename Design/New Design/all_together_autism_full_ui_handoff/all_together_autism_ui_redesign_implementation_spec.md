# All Together Autism — Codebase-Level UI Redesign Specification

**Document purpose:** This file is an implementation specification for the IDE/Claude Code. It is intentionally precise and codebase-oriented. Treat this as a design-system migration plan plus page-by-page implementation contract, not a loose design brief.

**Product name:** All Together Autism  
**Application type:** ABA scheduling / practice management platform  
**Primary objective:** Unify the Communications, Schedule, Clients, Providers, and session modal experiences under one consistent, production-ready healthcare SaaS design system.

---

## 0. Non-Negotiable Rules

### 0.1 Branding

Use **All Together Autism** everywhere.

Use the provided All Together Autism logo asset.

Logo usage:

```txt
Expanded sidebar/header:
  Use full logo lockup when width >= 180px.

Compact sidebar:
  Use only the left blue connected-loop mark.

Never use placeholder or invented company names.
Never create additional brand names.
Never use unrelated logos.
```

### 0.2 Overall UI Style

The app must feel like one cohesive product.

Use:

```txt
Dark navy global sidebar
White / off-white app surfaces
All Together Autism blue accents
Green status indicators
Soft shadows
Rounded cards
Light borders
Dense but readable healthcare-operations layouts
Professional SaaS design language
```

Do not use:

```txt
Random gradients in main content
Oversized cards where dense tables are required
Unaligned mixed spacing
Page-specific one-off styling when a shared component should exist
Different button styles page-by-page
Different modal styles page-by-page
```

### 0.3 Codebase Strategy

This should be implemented as a shared design-system pass, not isolated page patches.

Implementation order:

```txt
1. Create shared tokens and primitives
2. Create shared AppShell / Sidebar
3. Create shared table, card, input, button, badge, chip, modal, progress components
4. Migrate Communications
5. Migrate Schedule Day View
6. Migrate Schedule Week View
7. Migrate Clients List
8. Migrate Client Detail
9. Migrate Providers List
10. Migrate Provider Detail
11. Migrate New Session modal
12. Migrate Cancel Session modal
13. Final visual QA and old-style cleanup
```

---

## 1. Design Tokens

Create a centralized token file. Use the closest existing system location in the codebase. Recommended paths:

```txt
src/styles/tokens.css
src/styles/theme.css
src/design/tokens.ts
src/components/ui/theme.ts
```

If the app already has Tailwind, wire these into `tailwind.config.js` and use CSS variables in global styles.

### 1.1 Color Tokens

Use these values as the source of truth.

```css
:root {
  /* Brand */
  --ata-blue-25: #F5F9FF;
  --ata-blue-50: #EFF6FF;
  --ata-blue-100: #DBEAFE;
  --ata-blue-200: #BFDBFE;
  --ata-blue-300: #93C5FD;
  --ata-blue-400: #60A5FA;
  --ata-blue-500: #3B82F6;
  --ata-blue-600: #2563EB;
  --ata-blue-700: #1D4ED8;
  --ata-blue-800: #1E40AF;
  --ata-blue-900: #1E3A8A;

  /* Sidebar navy */
  --ata-navy-950: #061529;
  --ata-navy-900: #08203D;
  --ata-navy-850: #0A2A50;
  --ata-navy-800: #0C3568;
  --ata-navy-700: #104A92;

  /* Neutral */
  --ata-white: #FFFFFF;
  --ata-bg: #F8FAFC;
  --ata-surface: #FFFFFF;
  --ata-surface-muted: #F9FAFB;
  --ata-surface-soft: #F6F8FB;

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

  /* Status */
  --ata-success-50: #ECFDF3;
  --ata-success-100: #D1FADF;
  --ata-success-500: #12B76A;
  --ata-success-600: #039855;
  --ata-success-700: #027A48;

  --ata-warning-50: #FFFAEB;
  --ata-warning-100: #FEF0C7;
  --ata-warning-400: #FDB022;
  --ata-warning-500: #F79009;
  --ata-warning-600: #DC6803;

  --ata-danger-50: #FEF3F2;
  --ata-danger-100: #FEE4E2;
  --ata-danger-300: #FDA29B;
  --ata-danger-500: #F04438;
  --ata-danger-600: #D92D20;
  --ata-danger-700: #B42318;

  --ata-purple-50: #F4F3FF;
  --ata-purple-100: #EBE9FE;
  --ata-purple-500: #7A5AF8;
  --ata-purple-600: #6938EF;

  --ata-cyan-50: #ECFDFF;
  --ata-cyan-100: #CFF9FE;
  --ata-cyan-500: #06AED4;
  --ata-cyan-600: #088AB2;

  --ata-teal-50: #F0FDFA;
  --ata-teal-100: #CCFBF1;
  --ata-teal-500: #14B8A6;
  --ata-teal-600: #0D9488;
}
```

### 1.2 Semantic Color Mapping

```ts
export const semanticColors = {
  appBackground: "var(--ata-bg)",
  surface: "var(--ata-surface)",
  surfaceMuted: "var(--ata-surface-muted)",
  border: "var(--ata-gray-200)",
  borderStrong: "var(--ata-gray-300)",

  textPrimary: "var(--ata-gray-900)",
  textSecondary: "var(--ata-gray-600)",
  textTertiary: "var(--ata-gray-500)",
  textDisabled: "var(--ata-gray-400)",

  primary: "var(--ata-blue-600)",
  primaryHover: "var(--ata-blue-700)",
  primarySoft: "var(--ata-blue-50)",

  success: "var(--ata-success-600)",
  successSoft: "var(--ata-success-50)",

  warning: "var(--ata-warning-500)",
  warningSoft: "var(--ata-warning-50)",

  danger: "var(--ata-danger-600)",
  dangerSoft: "var(--ata-danger-50)",
};
```

### 1.3 Typography

Use the app’s current sans-serif stack if already configured. If not, define:

```css
--font-sans: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

Typography scale:

```css
--text-xs: 12px;
--text-sm: 14px;
--text-md: 15px;
--text-base: 16px;
--text-lg: 18px;
--text-xl: 20px;
--text-2xl: 24px;
--text-3xl: 30px;
--text-4xl: 36px;

--leading-tight: 1.2;
--leading-normal: 1.45;
--leading-relaxed: 1.6;
```

Usage:

```txt
Page title: 30px / 36px, 700 weight, gray-900
Page subtitle: 15px / 22px, 400 weight, gray-600
Section title: 18px / 26px, 700 weight, gray-900
Card title: 16px / 24px, 700 weight, gray-900
Table header: 12px / 16px, 700 weight, uppercase, letter-spacing .04em, gray-600
Table primary text: 14px / 20px, 600 weight, gray-900
Table secondary text: 13px / 18px, 400 weight, gray-500
Form label: 14px / 20px, 600 weight, gray-900
Helper text: 12px / 18px, 400 weight, gray-500
Button text: 14px / 20px, 600 weight
```

### 1.4 Spacing Scale

Use an 8px spacing system.

```css
--space-0: 0;
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
--space-10: 40px;
--space-12: 48px;
--space-16: 64px;
```

Page standards:

```txt
Desktop page content padding: 28px 32px
Compact page content padding: 24px
Card padding: 20px or 24px
Table row horizontal padding: 20px
Table row vertical padding: 14px
Modal body padding: 28px 32px
Modal header padding: 24px 32px
Modal footer padding: 20px 32px
```

### 1.5 Radius

```css
--radius-xs: 6px;
--radius-sm: 8px;
--radius-md: 10px;
--radius-lg: 12px;
--radius-xl: 16px;
--radius-2xl: 20px;
--radius-full: 9999px;
```

Usage:

```txt
Buttons: 10px
Inputs/selects: 10px
Cards: 16px
Data table wrapper: 16px
Modal: 20px
Sidebar active nav item: 12px
Avatar: full
Chips/badges: full
Schedule blocks: 8px
Floating action dock: 18px
```

### 1.6 Border Widths and Colors

```css
--border-width-default: 1px;
--border-width-strong: 1.5px;
--border-width-focus: 2px;
```

Usage:

```txt
Default border: 1px solid var(--ata-gray-200)
Hover border: 1px solid var(--ata-gray-300)
Focused input: 2px solid var(--ata-blue-500)
Danger border: 1px solid var(--ata-danger-300)
Card border: 1px solid rgba(16, 24, 40, 0.08)
Table row border: 1px solid var(--ata-gray-100)
```

### 1.7 Shadows

```css
--shadow-xs: 0 1px 2px rgba(16, 24, 40, 0.05);
--shadow-sm: 0 1px 3px rgba(16, 24, 40, 0.10), 0 1px 2px rgba(16, 24, 40, 0.06);
--shadow-md: 0 4px 8px -2px rgba(16, 24, 40, 0.10), 0 2px 4px -2px rgba(16, 24, 40, 0.06);
--shadow-lg: 0 12px 16px -4px rgba(16, 24, 40, 0.10), 0 4px 6px -2px rgba(16, 24, 40, 0.05);
--shadow-modal: 0 24px 48px -12px rgba(16, 24, 40, 0.28);
--shadow-dock: 0 16px 40px rgba(16, 24, 40, 0.18);
```

Usage:

```txt
Cards: shadow-xs or shadow-sm
Modals: shadow-modal
Floating action docks: shadow-dock
Dropdowns/popovers: shadow-lg
```

---

## 2. Shared Component Specifications

Create reusable components instead of page-specific one-offs.

Recommended component names:

```txt
AppShell
SidebarNav
PageHeader
MetricCard
DataTable
StatusBadge
PreferenceChip
FilterBar
SearchInput
SelectButton
PrimaryButton
SecondaryButton
GhostButton
IconButton
ProgressBar
SegmentedProgress
Modal
ModalHeader
ModalFooter
SessionBlock
FloatingActionDock
```

### 2.1 AppShell

Desktop shell:

```txt
display: flex
min-height: 100vh
background: var(--ata-bg)
```

Layout:

```txt
Sidebar width: 184px expanded
Compact/icon sidebar width: 72px
Main content flex: 1
Main content background: #FFFFFF or #F8FAFC depending page
```

For screens that intentionally use compact sidebar, set width to `72px`. For the schedule and broad operations pages, prefer the expanded sidebar unless screen density requires compact.

### 2.2 SidebarNav

Use the dark navy sidebar for all approved screens.

Dimensions:

```txt
Expanded width: 184px
Compact width: 72px
Height: 100vh
Padding top: 20px
Padding horizontal: 12px
Background: linear-gradient(180deg, #061529 0%, #08203D 52%, #061529 100%)
Border-right: 1px solid rgba(255,255,255,0.06)
```

Logo:

```txt
Expanded:
  full All Together Autism logo if asset fits cleanly
  max width: 144px
  max height: 48px

Compact:
  left blue connected-loop mark only
  size: 36px x auto
  centered horizontally
```

Nav item expanded:

```txt
height: 44px
padding: 0 12px
display: flex
align-items: center
gap: 12px
border-radius: 12px
font-size: 14px
font-weight: 500
color: rgba(255,255,255,0.82)
margin-bottom: 6px
```

Nav item compact:

```txt
width: 44px
height: 44px
margin: 0 auto 8px
display: flex
align-items: center
justify-content: center
border-radius: 12px
```

Active item:

```txt
background: linear-gradient(180deg, var(--ata-blue-600), var(--ata-blue-700))
color: #FFFFFF
box-shadow: 0 8px 20px rgba(37, 99, 235, 0.34)
```

Inactive hover:

```txt
background: rgba(255,255,255,0.08)
color: #FFFFFF
```

Icon size:

```txt
20px expanded
22px compact
stroke-width: 1.8px
```

Nav order:

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
```

Bottom area:

```txt
Help item above profile
Divider: 1px solid rgba(255,255,255,0.12)
Profile block height: 96px expanded
Avatar: 40px
Status dot: 8px green
```

### 2.3 Buttons

Primary button:

```txt
height: 44px
padding: 0 18px
border-radius: 10px
background: var(--ata-blue-600)
hover: var(--ata-blue-700)
color: white
font-size: 14px
font-weight: 600
box-shadow: 0 1px 2px rgba(16, 24, 40, 0.05)
```

Secondary button:

```txt
height: 44px
padding: 0 18px
border-radius: 10px
background: #FFFFFF
border: 1px solid var(--ata-gray-200)
color: var(--ata-gray-800)
hover background: var(--ata-gray-50)
```

Danger button:

```txt
height: 44px
padding: 0 18px
border-radius: 10px
background: var(--ata-danger-600)
hover: var(--ata-danger-700)
color: #FFFFFF
```

Ghost/text button:

```txt
height: 36px
padding: 0 10px
border-radius: 8px
background: transparent
color: var(--ata-blue-600)
hover background: var(--ata-blue-50)
```

Icon button:

```txt
width: 40px
height: 40px
border-radius: 10px
border: 1px solid var(--ata-gray-200)
background: #FFFFFF
```

### 2.4 Inputs and Selects

Input/select dimensions:

```txt
height: 44px
border-radius: 10px
border: 1px solid var(--ata-gray-200)
background: #FFFFFF
padding: 0 14px
font-size: 14px
color: var(--ata-gray-900)
placeholder: var(--ata-gray-400)
```

Focus state:

```txt
border-color: var(--ata-blue-500)
box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.16)
outline: none
```

Search input:

```txt
height: 44px
min-width: 300px
left icon: 18px
shortcut badge: height 22px, font 12px, background gray-100, border gray-200
```

Textarea:

```txt
min-height: 88px
padding: 12px 14px
resize: vertical
line-height: 1.5
```

### 2.5 Cards

Default card:

```txt
background: #FFFFFF
border: 1px solid rgba(16, 24, 40, 0.08)
border-radius: 16px
box-shadow: var(--shadow-xs)
```

Card padding:

```txt
Small card: 16px
Default card: 20px
Large card: 24px
```

Card section divider:

```txt
border-top: 1px solid var(--ata-gray-100)
```

### 2.6 Badges and Chips

Status badge active:

```txt
height: 24px
padding: 0 10px
border-radius: 9999px
font-size: 12px
font-weight: 600
background: var(--ata-success-50)
color: var(--ata-success-700)
border: 1px solid var(--ata-success-100)
```

Preference chip purple:

```txt
height: 26px
padding: 0 10px
border-radius: 9999px
font-size: 12px
font-weight: 600
background: var(--ata-purple-50)
color: var(--ata-purple-600)
border: 1px solid var(--ata-purple-100)
```

Preference chip blue:

```txt
height: 26px
padding: 0 10px
border-radius: 9999px
font-size: 12px
font-weight: 600
background: var(--ata-blue-50)
color: var(--ata-blue-700)
border: 1px solid var(--ata-blue-100)
```

Warning chip:

```txt
background: var(--ata-warning-50)
color: var(--ata-warning-600)
border: 1px solid var(--ata-warning-100)
```

Danger chip:

```txt
background: var(--ata-danger-50)
color: var(--ata-danger-700)
border: 1px solid var(--ata-danger-100)
```

### 2.7 DataTable

Shared table wrapper:

```txt
border: 1px solid var(--ata-gray-200)
border-radius: 16px
background: #FFFFFF
overflow: hidden
box-shadow: var(--shadow-xs)
```

Header row:

```txt
height: 48px
background: var(--ata-gray-25)
border-bottom: 1px solid var(--ata-gray-200)
```

Header cell:

```txt
padding: 0 20px
font-size: 12px
font-weight: 700
text-transform: uppercase
letter-spacing: .04em
color: var(--ata-gray-600)
```

Body row:

```txt
height: 64px
border-bottom: 1px solid var(--ata-gray-100)
background: #FFFFFF
```

Body row hover:

```txt
background: var(--ata-blue-25)
```

Selected row:

```txt
background: #EFF6FF
box-shadow: inset 3px 0 0 var(--ata-blue-600)
```

Body cell:

```txt
padding: 0 20px
font-size: 14px
color: var(--ata-gray-800)
vertical-align: middle
```

Table footer:

```txt
height: 52px
padding: 0 16px
display: flex
align-items: center
justify-content: space-between
border-top: 1px solid var(--ata-gray-100)
```

### 2.8 Progress Bars

Simple progress:

```txt
track height: 4px
track width: 112px
track background: var(--ata-gray-100)
track radius: full
fill radius: full
green fill: var(--ata-success-600)
warning fill: var(--ata-warning-600)
danger fill: var(--ata-danger-600)
```

Thresholds for authorization/utilization:

```txt
0% - 74%: green
75% - 94%: warning/amber
95%+: danger
```

Segmented progress:

```txt
segment width: 30px
segment height: 22px
gap: 4px
filled green: var(--ata-success-600)
warning segment: var(--ata-warning-500)
empty: var(--ata-gray-100)
border-radius: 4px
```

### 2.9 Modals

Overlay:

```txt
position: fixed
inset: 0
background: rgba(6, 21, 41, 0.58)
backdrop-filter: blur(2px)
display: flex
align-items: center
justify-content: center
z-index: 1000
```

Modal container:

```txt
background: #FFFFFF
border-radius: 20px
border: 1px solid rgba(255,255,255,0.12)
box-shadow: var(--shadow-modal)
overflow: hidden
```

Default modal width:

```txt
New Session: 560px
Cancel Session: 560px
Small confirm: 420px
Large workflow: 720px
```

Modal header:

```txt
padding: 28px 32px 18px
display: flex
align-items: flex-start
justify-content: space-between
gap: 16px
```

Modal body:

```txt
padding: 0 32px 28px
```

Modal footer:

```txt
padding: 20px 32px
border-top: 1px solid var(--ata-gray-100)
display: flex
gap: 12px
```

Close button:

```txt
width: 36px
height: 36px
border-radius: 10px
color: var(--ata-gray-500)
hover background: var(--ata-gray-100)
```

---

## 3. Application Shell Requirements

Every redesigned page should use this shell.

```tsx
<AppShell>
  <SidebarNav active="clients" />
  <main className="ata-main">
    {pageContent}
  </main>
</AppShell>
```

Main area:

```css
.ata-main {
  flex: 1;
  min-width: 0;
  background: var(--ata-bg);
}
```

For list/detail pages:

```css
.ata-page {
  padding: 28px 32px;
}
```

For schedule pages:

```css
.ata-schedule-page {
  height: 100vh;
  overflow: hidden;
  background: #FFFFFF;
}
```

---

## 4. Communications / Chat Page Specification

This is the detailed implementation specification for the messaging/chat experience. The Communications page is one of the major approved screens and must receive the same level of implementation attention as Schedule, Clients, Providers, and modals.

### 4.1 Route / Page Intent

The Communications page supports scheduler-to-provider/client/family messaging.

Primary use cases:

```txt
1. Scheduler views all conversations.
2. Scheduler filters conversations by unread, provider, client, urgent, or coverage-related.
3. Scheduler opens a thread with a provider/client/family.
4. Scheduler reads message history.
5. Scheduler sends a reply.
6. Scheduler uses suggested replies/templates.
7. Scheduler uses AI Suggestions/Copilot to summarize, draft, check conflicts, and suggest next steps.
```

Recommended route names if routes exist or need alignment:

```txt
/communications
/messages
/conversations
```

Do not change existing public route names unless the codebase already uses a different route convention.

### 4.2 Required Layout

Use the global All Together Autism app shell.

Desktop layout:

```txt
Global sidebar: 184px expanded
Thread list panel: 360px
Main conversation panel: minmax(520px, 1fr)
AI suggestions panel: 320px
```

Total height:

```txt
height: 100vh
overflow: hidden
```

Layout CSS:

```css
.communications-layout {
  display: grid;
  grid-template-columns: 360px minmax(520px, 1fr) 320px;
  height: 100vh;
  min-width: 0;
  background: #FFFFFF;
}
```

If using the AppShell:

```tsx
<AppShell activeNav="communications">
  <div className="communications-layout">
    <ThreadList />
    <ConversationPanel />
    <ChatAIAssistantPanel />
  </div>
</AppShell>
```

Do not use a right AI panel on Schedule Day View, but Communications should include an AI panel.

### 4.3 Communications Page Header Inside Thread Panel

The thread list panel owns the Communications page title.

Header block dimensions:

```txt
padding: 20px 16px 16px
border-bottom: 1px solid var(--ata-gray-200)
```

Title:

```txt
Text: Communications
Font: 24px
Weight: 700
Line-height: 32px
Color: var(--ata-gray-900)
```

Subtitle:

```txt
Text: Coordinate messages with providers and clients
Font: 14px
Line-height: 20px
Color: var(--ata-gray-600)
Margin-top: 4px
```

Header actions:

```txt
New message icon button or primary button
Optional quick actions button
```

New message button:

```txt
height: 40px
padding: 0 14px
border-radius: 10px
background: var(--ata-blue-600)
color: #FFFFFF
font-size: 14px
font-weight: 600
```

### 4.4 Thread List Panel

Panel:

```txt
width: 360px
height: 100vh
background: #FFFFFF
border-right: 1px solid var(--ata-gray-200)
display: flex
flex-direction: column
```

Thread search/filter area:

```txt
padding: 14px 16px
border-bottom: 1px solid var(--ata-gray-100)
```

Search input:

```txt
height: 42px
width: 100%
border-radius: 10px
border: 1px solid var(--ata-gray-200)
padding-left: 38px
padding-right: 12px
font-size: 14px
placeholder: Search conversations...
```

Search icon:

```txt
size: 18px
left: 12px
color: var(--ata-gray-400)
```

Filter chip row:

```txt
display: flex
gap: 8px
overflow-x: auto
padding-top: 12px
```

Filter chips:

```txt
height: 30px
padding: 0 12px
border-radius: 9999px
font-size: 13px
font-weight: 600
border: 1px solid var(--ata-gray-200)
background: #FFFFFF
color: var(--ata-gray-600)
```

Active filter chip:

```txt
background: var(--ata-blue-50)
border-color: var(--ata-blue-200)
color: var(--ata-blue-700)
```

Required filters:

```txt
All
Unread
Providers
Clients
Urgent
Coverage
```

Thread list scroll area:

```txt
flex: 1
overflow-y: auto
padding: 10px
```

Thread date group label:

```txt
font-size: 11px
font-weight: 700
letter-spacing: .04em
text-transform: uppercase
color: var(--ata-gray-500)
padding: 14px 8px 8px
```

### 4.5 Thread Card Component

Create/reuse a shared conversation/thread item component.

Recommended component:

```tsx
<ThreadCard
  selected
  unreadCount={2}
  avatarInitials="JS"
  name="Jordan Smith"
  role="RBT"
  preview="Thanks for reaching out! I can cover Tuesday’s 4:00 PM session."
  timestamp="10:31 AM"
  tags={["RBT", "Coverage needed"]}
  priority="urgent"
/>
```

Card dimensions:

```txt
min-height: 92px
padding: 14px
border-radius: 14px
display: grid
grid-template-columns: 42px 1fr auto
gap: 12px
border: 1px solid transparent
background: #FFFFFF
```

Card hover:

```txt
background: var(--ata-gray-50)
border-color: var(--ata-gray-200)
```

Selected card:

```txt
background: var(--ata-blue-50)
border-color: var(--ata-blue-200)
box-shadow: inset 3px 0 0 var(--ata-blue-600)
```

Avatar:

```txt
width: 42px
height: 42px
border-radius: 9999px
font-size: 14px
font-weight: 700
display: flex
align-items: center
justify-content: center
```

Online status dot:

```txt
width: 10px
height: 10px
border-radius: 9999px
background: var(--ata-success-500)
border: 2px solid #FFFFFF
positioned bottom-right of avatar
```

Thread name:

```txt
font-size: 14px
font-weight: 700
line-height: 20px
color: var(--ata-gray-900)
```

Thread role:

```txt
font-size: 12px
font-weight: 500
line-height: 16px
color: var(--ata-gray-500)
```

Preview:

```txt
font-size: 13px
line-height: 18px
color: var(--ata-gray-600)
overflow: hidden
display: -webkit-box
-webkit-line-clamp: 2
-webkit-box-orient: vertical
```

Timestamp:

```txt
font-size: 12px
font-weight: 600
color: var(--ata-gray-500)
white-space: nowrap
```

Unread badge:

```txt
min-width: 22px
height: 22px
padding: 0 7px
border-radius: 9999px
background: var(--ata-blue-600)
color: #FFFFFF
font-size: 12px
font-weight: 700
display: inline-flex
align-items: center
justify-content: center
```

Tag chips inside thread card:

```txt
height: 22px
padding: 0 8px
border-radius: 9999px
font-size: 11px
font-weight: 600
background: var(--ata-gray-100)
color: var(--ata-gray-600)
```

Coverage-needed tag:

```txt
background: var(--ata-purple-50)
color: var(--ata-purple-600)
border: 1px solid var(--ata-purple-100)
```

Urgent tag:

```txt
background: var(--ata-danger-50)
color: var(--ata-danger-700)
border: 1px solid var(--ata-danger-100)
```

### 4.6 Main Conversation Panel

Panel:

```txt
height: 100vh
display: flex
flex-direction: column
background: #FFFFFF
min-width: 0
```

Conversation header:

```txt
height: 104px
padding: 18px 24px
border-bottom: 1px solid var(--ata-gray-200)
display: flex
align-items: center
justify-content: space-between
gap: 20px
background: rgba(255,255,255,0.96)
```

Conversation identity block:

```txt
display: flex
align-items: center
gap: 14px
min-width: 0
```

Avatar:

```txt
width: 48px
height: 48px
border-radius: 9999px
```

Conversation title:

```txt
font-size: 18px
font-weight: 700
line-height: 26px
color: var(--ata-gray-900)
```

Subtitle/status:

```txt
font-size: 13px
line-height: 18px
color: var(--ata-gray-500)
```

Header metadata chips:

```txt
Client: Liam P.
RBT
Coverage needed
Awaiting reply
```

Chip style:

```txt
height: 26px
padding: 0 10px
border-radius: 9999px
font-size: 12px
font-weight: 600
```

Header actions:

```txt
Phone icon
Video icon optional
Profile/contact icon
More menu
Close/open panel if current app supports
```

Icon button dimensions:

```txt
width: 38px
height: 38px
border-radius: 10px
border: 1px solid var(--ata-gray-200)
background: #FFFFFF
```

### 4.7 Context Card Row / Pinned Metadata

Under the conversation header, optionally show a compact context row when there is relevant scheduling data.

Container:

```txt
padding: 12px 24px
border-bottom: 1px solid var(--ata-gray-100)
background: var(--ata-gray-25)
display: flex
gap: 10px
overflow-x: auto
```

Context card:

```txt
height: 52px
min-width: 176px
padding: 8px 12px
border-radius: 12px
background: #FFFFFF
border: 1px solid var(--ata-gray-200)
display: flex
align-items: center
gap: 10px
```

Examples:

```txt
Upcoming session: Tue 4:00 PM
Assigned client: Liam P.
Location: Clinic A
Coverage risk: High
```

If the current codebase does not support these cards, keep a single pinned note card instead.

Pinned note:

```txt
background: var(--ata-blue-25)
border: 1px solid var(--ata-blue-100)
border-radius: 12px
padding: 10px 12px
font-size: 13px
color: var(--ata-gray-700)
```

### 4.8 Message Timeline

Timeline container:

```txt
flex: 1
overflow-y: auto
padding: 24px
background: linear-gradient(180deg, #FFFFFF 0%, #FBFCFE 100%)
```

Message group:

```txt
display: flex
gap: 10px
margin-bottom: 18px
```

Inbound group:

```txt
justify-content: flex-start
```

Outbound group:

```txt
justify-content: flex-end
```

Date divider:

```txt
display: flex
align-items: center
justify-content: center
margin: 8px 0 22px
```

Date divider label:

```txt
height: 24px
padding: 0 12px
border-radius: 9999px
background: var(--ata-gray-100)
color: var(--ata-gray-600)
font-size: 12px
font-weight: 600
```

Message sender label:

```txt
font-size: 12px
font-weight: 700
color: var(--ata-gray-700)
margin-bottom: 4px
```

Message timestamp:

```txt
font-size: 11px
font-weight: 500
color: var(--ata-gray-400)
margin-left: 6px
```

Message bubble shared:

```txt
max-width: 680px
padding: 12px 14px
border-radius: 16px
font-size: 14px
line-height: 1.45
word-wrap: break-word
position: relative
```

Inbound bubble:

```txt
background: #FFFFFF
border: 1px solid var(--ata-gray-200)
color: var(--ata-gray-800)
box-shadow: var(--shadow-xs)
border-top-left-radius: 6px
```

Outbound bubble:

```txt
background: var(--ata-blue-50)
border: 1px solid var(--ata-blue-200)
color: var(--ata-gray-900)
box-shadow: none
border-top-right-radius: 6px
```

System message:

```txt
max-width: 520px
margin: 16px auto
padding: 10px 12px
border-radius: 12px
background: var(--ata-gray-100)
color: var(--ata-gray-600)
font-size: 13px
text-align: center
```

Read/delivery status:

```txt
font-size: 11px
color: var(--ata-gray-400)
margin-top: 4px
text-align: right
```

Message reactions:

```txt
height: 24px
padding: 0 8px
border-radius: 9999px
background: #FFFFFF
border: 1px solid var(--ata-gray-200)
box-shadow: var(--shadow-xs)
font-size: 12px
```

### 4.9 Message Content Examples

Use realistic ABA scheduling messages.

Example active thread:

```txt
Provider: Jordan Smith, RBT
Topic: Coverage request for Tuesday 4:00 PM session

Jordan:
Hi! I received the schedule update. I’m currently booked for Tuesday at 4:00 PM with Liam. I won’t be able to make it due to a prior commitment. Can someone please cover this session?

Scheduler:
No problem, Jordan. Thanks for letting me know early. I’ll look for coverage and confirm with you as soon as I have someone.

Jordan:
Thanks so much. Let me know if you need any details about Liam’s session.
```

Alternative thread:

```txt
Provider: Sarah Johnson
Topic: Wednesday coverage conflict for Liam Parker

Sarah:
Hi! I’m reaching out because I have a scheduling conflict on Wednesday at 4pm for Liam Parker. Is there any chance another RBT is available to cover that session?

Scheduler:
Thanks for letting me know, Sarah. I’ll check availability and get back to you shortly.

Sarah:
Appreciate it.
```

### 4.10 Smart Replies Row

Place above composer or inside composer header.

Container:

```txt
padding: 10px 24px 0
display: flex
align-items: center
gap: 8px
overflow-x: auto
```

Label:

```txt
Smart replies
font-size: 12px
font-weight: 700
color: var(--ata-gray-500)
```

Reply chip:

```txt
height: 32px
padding: 0 12px
border-radius: 9999px
border: 1px solid var(--ata-gray-200)
background: #FFFFFF
font-size: 13px
font-weight: 600
color: var(--ata-gray-700)
```

Hover:

```txt
background: var(--ata-blue-50)
border-color: var(--ata-blue-200)
color: var(--ata-blue-700)
```

Required examples:

```txt
Check availability
Propose time options
Confirm coverage
Thank you
Need coverage
```

### 4.11 Message Composer

Composer wrapper:

```txt
border-top: 1px solid var(--ata-gray-200)
background: #FFFFFF
padding: 16px 24px 20px
```

Composer container:

```txt
border: 1px solid var(--ata-gray-200)
border-radius: 16px
background: #FFFFFF
box-shadow: var(--shadow-xs)
overflow: hidden
```

Composer tabs if supported:

```txt
Reply
Internal note
```

Tab row:

```txt
height: 40px
padding: 0 12px
border-bottom: 1px solid var(--ata-gray-100)
display: flex
align-items: center
gap: 8px
```

Active composer tab:

```txt
height: 28px
padding: 0 10px
border-radius: 8px
background: var(--ata-blue-50)
color: var(--ata-blue-700)
font-weight: 700
```

Textarea:

```txt
min-height: 84px
width: 100%
padding: 14px
border: none
resize: none
outline: none
font-size: 14px
line-height: 1.5
placeholder: Type a message...
```

Composer toolbar:

```txt
height: 44px
padding: 0 10px
border-top: 1px solid var(--ata-gray-100)
display: flex
align-items: center
justify-content: space-between
```

Left toolbar actions:

```txt
Attachment
Template
Emoji
Calendar/session link
Internal note toggle if applicable
AI assist
```

Toolbar icon button:

```txt
width: 34px
height: 34px
border-radius: 8px
color: var(--ata-gray-500)
hover background: var(--ata-gray-100)
```

Template dropdown:

```txt
height: 34px
padding: 0 10px
border-radius: 8px
border: 1px solid var(--ata-gray-200)
font-size: 13px
font-weight: 600
```

Send button:

```txt
height: 36px
padding: 0 14px
border-radius: 9px
background: var(--ata-blue-600)
color: #FFFFFF
font-size: 14px
font-weight: 700
```

Send button disabled:

```txt
background: var(--ata-gray-200)
color: var(--ata-gray-400)
cursor: not-allowed
```

Keyboard helper:

```txt
Press ⌘ Enter to send
font-size: 11px
color: var(--ata-gray-400)
```

### 4.12 AI Suggestions / Copilot Panel

Panel:

```txt
width: 320px
height: 100vh
background: #FFFFFF
border-left: 1px solid var(--ata-gray-200)
display: flex
flex-direction: column
```

Header:

```txt
height: 72px
padding: 18px 20px
border-bottom: 1px solid var(--ata-gray-200)
display: flex
align-items: center
justify-content: space-between
```

Title:

```txt
AI Suggestions or AI Copilot
font-size: 18px
font-weight: 700
color: var(--ata-gray-900)
```

Beta badge:

```txt
height: 22px
padding: 0 8px
border-radius: 9999px
font-size: 11px
font-weight: 700
background: var(--ata-purple-50)
color: var(--ata-purple-600)
```

Panel body:

```txt
flex: 1
overflow-y: auto
padding: 18px 16px
```

AI card:

```txt
padding: 14px
border-radius: 14px
border: 1px solid var(--ata-gray-200)
background: #FFFFFF
box-shadow: var(--shadow-xs)
margin-bottom: 12px
```

AI card title:

```txt
font-size: 14px
font-weight: 700
line-height: 20px
color: var(--ata-gray-900)
```

AI card description:

```txt
font-size: 13px
line-height: 18px
color: var(--ata-gray-600)
margin-top: 4px
```

Required AI action cards:

```txt
Summarize thread
Draft reply
Check schedule conflicts
Suggest next steps
Create follow-up task
Escalate to BCBA
Log note to case
```

Recommended section structure:

```txt
1. Message summary
2. Urgency / detected issue
3. Suggested reply preview
4. Recommended actions
5. Conversation insights
```

Suggested reply preview box:

```txt
background: var(--ata-blue-25)
border: 1px solid var(--ata-blue-100)
border-radius: 12px
padding: 12px
font-size: 13px
line-height: 1.45
color: var(--ata-gray-700)
```

AI primary action:

```txt
Use this reply
height: 38px
width: 100%
background: var(--ata-blue-600)
color: #FFFFFF
border-radius: 10px
font-size: 14px
font-weight: 700
```

AI secondary action:

```txt
Customize reply
height: 38px
width: 100%
background: #FFFFFF
border: 1px solid var(--ata-gray-200)
color: var(--ata-gray-700)
border-radius: 10px
```

AI disclaimer:

```txt
AI can make mistakes. Verify important details.
font-size: 11px
line-height: 16px
color: var(--ata-gray-500)
padding: 12px 16px
border-top: 1px solid var(--ata-gray-100)
```

### 4.13 Empty, Loading, and Error States

No selected conversation:

```txt
Centered empty state in conversation panel
Icon: message circle
Title: Select a conversation
Description: Choose a thread to view messages and reply.
Button optional: New message
```

No threads:

```txt
Title: No conversations found
Description: Try clearing filters or starting a new message.
```

Loading threads:

```txt
Use skeleton rows matching ThreadCard dimensions
Skeleton count: 8
```

Loading messages:

```txt
Use skeleton bubbles, alternating left/right
Count: 6
```

Send failure:

```txt
Show inline error under composer:
Message failed to send. Retry.
Retry button text blue.
```

AI unavailable:

```txt
Panel card:
AI Suggestions unavailable
Try again later.
```

### 4.14 Communications Data Shape Guidance

Reference only; adapt to existing backend models.

```ts
type ConversationParticipant = {
  id: string;
  name: string;
  type: "provider" | "client" | "caregiver" | "scheduler" | "system";
  roleLabel?: string;
  avatarUrl?: string;
  initials: string;
  isOnline?: boolean;
};

type ConversationThread = {
  id: string;
  participants: ConversationParticipant[];
  title: string;
  subtitle?: string;
  lastMessagePreview: string;
  lastMessageAt: string;
  unreadCount: number;
  tags: string[];
  priority?: "normal" | "urgent";
  relatedClientId?: string;
  relatedProviderId?: string;
  relatedSessionId?: string;
  status?: "open" | "awaiting_reply" | "resolved";
};

type ChatMessage = {
  id: string;
  threadId: string;
  senderId: string;
  senderName: string;
  senderType: "provider" | "client" | "caregiver" | "scheduler" | "system";
  body: string;
  createdAt: string;
  direction: "inbound" | "outbound" | "system";
  status?: "sending" | "sent" | "delivered" | "read" | "failed";
  attachments?: Array<{
    id: string;
    name: string;
    url: string;
    mimeType: string;
  }>;
  reactions?: Array<{
    emoji: string;
    count: number;
  }>;
};

type AISuggestion = {
  id: string;
  type:
    | "summary"
    | "draft_reply"
    | "schedule_conflict"
    | "next_step"
    | "follow_up_task"
    | "escalation"
    | "case_note";
  title: string;
  description: string;
  actionLabel?: string;
  draftText?: string;
};
```

### 4.15 Responsive Behavior for Communications

At width >= 1440px:

```txt
Use full 3-column communications layout.
```

At width 1200px - 1439px:

```txt
Thread list: 340px
AI panel: 300px
```

At width below 1200px:

```txt
AI panel should become collapsible drawer.
Thread list remains visible unless route is mobile-specific.
```

At tablet/mobile if supported:

```txt
Conversation list and conversation detail should become separate views.
Do not squeeze all three panels below 1024px.
```

### 4.16 Communications Acceptance Criteria

```txt
[ ] Communications nav item active in All Together Autism sidebar
[ ] Thread list width is 360px on desktop
[ ] Thread search and filters are visible
[ ] Thread cards have avatars, names, roles, previews, timestamps, unread badges, and tags
[ ] Selected thread has blue left accent and blue-tinted background
[ ] Conversation header shows participant, role/status, tags, and actions
[ ] Message bubbles clearly distinguish inbound and outbound messages
[ ] Timeline has date dividers
[ ] Composer has textarea, attachment/template/emoji/actions, and Send button
[ ] Smart replies are visible above composer or inside composer
[ ] AI panel exists on the right with summary, suggested reply, and recommended actions
[ ] AI panel uses same card/badge/button system as the rest of the app
[ ] Empty/loading/error states are handled
[ ] No unrelated branding appears; only All Together Autism is used
```

---

## 5. Schedule Day View Specification

### 5.1 Required Layout

Use:

```txt
Global sidebar: 184px expanded
Filter panel: 240px
Main schedule grid: flex 1
No right sidebar
```

Important:

```txt
Do not add a right insights sidebar.
Only allow a small “Insights & AI” action in the top toolbar if needed.
```

### 5.2 Header

Height:

```txt
72px
```

Content:

```txt
Logo/page label: Schedule / Command Center
Back button
Today button
Forward button
Date selector: Wed, Apr 29, 2026
Day/Week toggle, Day selected
Search input
Filter icon
Schedule efficiency meter
Notification icon
User avatar/initials
```

Schedule efficiency:

```txt
Container height: 44px
Progress track width: 120px
Track height: 6px
Fill: green
Label: “77%”
Hours text: “(65h / 84h)”
```

### 5.3 Filter Panel

Width:

```txt
240px
```

Background:

```txt
#FFFFFF
border-right: 1px solid var(--ata-gray-200)
```

Padding:

```txt
20px
```

Session type item:

```txt
height: 32px
display: flex
align-items: center
justify-content: space-between
font-size: 14px
```

Color squares:

```txt
size: 16px
border-radius: 5px
border-width: 1.5px
```

Session type colors:

```ts
const sessionTypeColors = {
  admin: "#2563EB",
  assessment: "#06AED4",
  break: "#12B76A",
  cancellation: "#F04438",
  directTherapy: "#3B82F6",
  directTherapyHome: "#0891B2",
  driveTime: "#F97316",
  lunch: "#F59E0B",
  nap: "#8B5CF6",
  parentTraining: "#A855F7",
  supervision: "#14B8A6",
};
```

Status key:

```txt
Proposed: dashed blue outline
Scheduled: solid blue
In Progress: green
Completed: gray
Cancelled: red slashed fill
Conflict: amber outlined/slashed
```

### 5.4 Schedule Grid

Main grid:

```txt
height: calc(100vh - 72px)
overflow: auto
background: #FFFFFF
```

Time header:

```txt
height: 44px
sticky top: 0
background: rgba(255,255,255,0.96)
border-bottom: 1px solid var(--ata-gray-200)
z-index: 10
```

Name column:

```txt
width: 220px
sticky left: 0
background: #FFFFFF
border-right: 1px solid var(--ata-gray-200)
```

Hour column:

```txt
min-width: 116px
border-right: 1px solid var(--ata-gray-100)
```

Row height:

```txt
Client row: 36px
Provider row: 36px
Section header row: 34px
```

Section header:

```txt
height: 34px
background: var(--ata-gray-50)
border-top: 1px solid var(--ata-gray-200)
border-bottom: 1px solid var(--ata-gray-200)
font-size: 13px
font-weight: 700
color: var(--ata-gray-800)
text-transform: uppercase optional
```

Current time marker:

```txt
line width: 2px
color: var(--ata-blue-600)
label height: 24px
label background: var(--ata-blue-600)
label color: white
label border-radius: 6px
label font-size: 12px
```

### 5.5 SessionBlock

Critical rule:

```txt
Client session blocks and provider session blocks must use the exact same component and dimensions.
```

Session block dimensions:

```txt
height: 28px
min-width: 96px
border-radius: 8px
padding: 4px 8px
border: 1px solid
font-size: 12px
line-height: 1.15
display: flex
align-items: center
gap: 6px
```

Block title:

```txt
font-size: 12px
font-weight: 700
color: var(--ata-gray-800)
white-space: nowrap
overflow: hidden
text-overflow: ellipsis
```

Block subtitle/time:

```txt
font-size: 11px
font-weight: 500
color: var(--ata-gray-600)
```

Colors:

```css
.session-dth {
  background: #EFF6FF;
  border-color: #BFDBFE;
}

.session-dt {
  background: #F4F3FF;
  border-color: #D9D6FE;
}

.session-supervision {
  background: #ECFDF3;
  border-color: #ABEFC6;
}

.session-lunch {
  background: #FFFAEB;
  border-color: #FEDF89;
}

.session-cancelled {
  background: #FEF3F2;
  border-color: #FDA29B;
}
```

Overflow menu:

```txt
right aligned
icon size: 14px
opacity: 0.6
show on hover if implementation supports
```

### 5.6 Floating Action Dock

Position:

```txt
fixed or sticky
bottom: 24px
left: calc(sidebar + filter + remaining center calculation)
center horizontally over schedule grid
```

Dimensions:

```txt
height: 56px
border-radius: 18px
padding: 8px
background: rgba(255,255,255,0.94)
border: 1px solid rgba(16,24,40,0.08)
box-shadow: var(--shadow-dock)
backdrop-filter: blur(8px)
```

Actions:

```txt
+ Add session
Analyze day
Resolve conflicts
Auto-complete
```

Primary add button:

```txt
height: 40px
background: var(--ata-blue-600)
color: #FFFFFF
border-radius: 10px
padding: 0 16px
```

---

## 6. Schedule Week View Specification

### 6.1 Layout

Use the same global shell as Schedule Day.

```txt
Global sidebar: 184px
Main week content: flex 1
No right sidebar
```

### 6.2 Header

Height:

```txt
72px
```

Controls:

```txt
Back button
Forward button
Today
Day/Week toggle with Week selected
Date range: Apr 27 – May 1, 2026
Schedule Efficiency meter: 87% (74h / 85h 30m)
Notification bell
```

### 6.3 Week Grid

Wrapper:

```txt
height: calc(100vh - 72px)
overflow: auto
background: #FFFFFF
```

Grid columns:

```txt
Name column: 220px
Day columns: repeat(5, minmax(220px, 1fr))
```

Header row:

```txt
height: 56px
sticky top: 0
background: #FFFFFF
border-bottom: 1px solid var(--ata-gray-200)
```

Column header text:

```txt
Day: 12px uppercase gray-500
Date: 14px bold gray-900
```

Row height:

```txt
Provider/client row: 38px
Section header row: 36px
```

Section header:

```txt
background: var(--ata-blue-25)
border-top: 1px solid var(--ata-gray-200)
border-bottom: 1px solid var(--ata-gray-200)
color: var(--ata-blue-800)
font-weight: 700
```

Provider credentials:

```txt
font-size: 11px
font-weight: 600
color: var(--ata-gray-500)
margin-left: 6px
```

Week session chip:

```txt
height: 24px
width: calc(100% - 12px)
margin: 6px
border-radius: 6px
padding: 0 8px
font-size: 12px
font-weight: 600
display: flex
align-items: center
justify-content: space-between
border: 1px solid
```

Standard blue:

```txt
background: #EFF6FF
border: #BFDBFE
text: #1E3A8A
```

Lavender/pink alternate:

```txt
background: #FDF4FF
border: #F5D0FE
text: #701A75
```

Proposed/dashed:

```txt
background: #FFFFFF
border: 1px dashed var(--ata-blue-500)
text: var(--ata-blue-800)
```

Week floating dock:

```txt
bottom center
height: 56px
actions:
  + Add session
  Clear week
  Analyze week
  Auto schedule week
```

Primary action:

```txt
Auto schedule week
background: var(--ata-blue-600)
hover: var(--ata-blue-700)
```

---

## 7. Clients List Specification

### 7.1 Layout Direction

This page should remain dense and list-oriented, similar to the latest approved reference. Do not use large stat-card-heavy layout here.

Use:

```txt
Compact left sidebar: 72px preferred
Main content: max readable width, full available
Page padding: 32px 40px
```

If the app shell cannot support compact sidebar for only this page, expanded sidebar is acceptable, but maintain the dense table structure.

### 7.2 Header

```txt
Title: Clients
Subtitle: 17 active · 3 unstaffed · 71h/wk authorized
```

Title style:

```txt
font-size: 30px
font-weight: 700
line-height: 36px
color: var(--ata-gray-900)
```

Header actions:

```txt
Export secondary button
+ Add client primary button
```

Button heights:

```txt
44px
```

### 7.3 Filter Row

Top margin from header:

```txt
28px
```

Controls:

```txt
Search clients...
All insurances
Any preference
Active
Sort: Name ↑
```

Search width:

```txt
360px
```

Filter chip dimensions:

```txt
height: 44px
padding: 0 16px
border-radius: 10px
border: 1px solid var(--ata-gray-200)
background: #FFFFFF
```

Sort label:

```txt
margin-left: auto
font-size: 14px
color: var(--ata-gray-500)
```

### 7.4 Table

Columns:

```txt
NAME: 25%
AGE: 14%
INSURANCE: 18%
AUTH USED: 18%
PREFERENCES: 18%
STATUS: 7%
```

Table wrapper:

```txt
margin-top: 18px
border-radius: 16px
border: 1px solid var(--ata-gray-200)
overflow: hidden
```

Header row height:

```txt
48px
```

Body row height:

```txt
68px
```

Name cell:

```txt
Avatar size: 36px
Gap avatar-to-text: 12px
Client name font: 14px / 20px / 700
Client ID font: 12px / 16px / 500 / gray-500
```

Avatar:

```txt
size: 36px
border-radius: full
color: #FFFFFF
font-size: 13px
font-weight: 700
```

Age cell:

```txt
format: “9y · Apr 19, 2017”
font: 14px
DOB color: gray-500
```

Authorization cell:

```txt
progress track width: 120px
track height: 4px
text margin-left: 10px
display: flex
align-items: center
```

Selected Olivia Davis row:

```txt
background: var(--ata-blue-50)
border-top: 1px solid var(--ata-blue-100)
border-bottom: 1px solid var(--ata-blue-100)
```

Rows:

```txt
Anderson, Lucas     #C-001  9y  Apr 19, 2017  Aetna                 14/20h     —             Active
Brown, Sofia        #C-002  10y Sep 2, 2015   Kaiser                18/20h     —             Active
Clark, Benjamin     #C-003  11y Sep 21, 2014  Cigna                 12/15h     —             Active
Davis, Olivia       #C-004  7y  Jan 29, 2019  Blue Cross Blue Shield 18.5/20h   Female only   Active
Gonzalez, Mateo     #C-005  7y  Dec 4, 2018   Medicaid              6/25h      Spanish       Active
Harris, Ethan       #C-006  5y  Jun 16, 2020  Blue Cross Blue Shield 9/15h      —             Active
Jackson, Mia        #C-007  10y Nov 29, 2015  Kaiser                22/25h     —             Active
Johnson, Emma       #C-008  9y  Jul 21, 2016  United Healthcare     11/20h     Female only   Active
Lee, James          #C-009  7y  Jul 8, 2018   Aetna                 15/20h     —             Active
Lewis, Amelia       #C-010  5y  Jan 7, 2021   Medicaid              8/15h      —             Active
Martinez, Aiden     #C-011  5y  May 13, 2020  Medicaid              4/25h      Spanish       Active
```

---

## 8. Client Detail Specification

### 8.1 Layout

Use compact or expanded sidebar consistent with Clients list. Content should follow the approved Olivia Davis structure.

Page padding:

```txt
32px 40px
```

### 8.2 Header

Breadcrumb:

```txt
Clients › Active › Olivia Davis
font-size: 14px
color: var(--ata-gray-600)
```

Profile header:

```txt
Avatar: 72px
Name: Olivia Davis
Status chip: Active
Age/gender chip: 7y · F
```

Metadata line:

```txt
Insurance Blue Cross Blue Shield | Auth 97153 · expires Dec 30, 2027 | Active since Dec 31, 2023 | ID #C-004
```

Header actions:

```txt
Schedule
Message
Edit
```

Edit button:

```txt
dark navy or primary depending app convention
```

### 8.3 Tabs

Tabs:

```txt
Overview
Schedule
Authorizations
Sessions
Notes
Activity
```

Tab row:

```txt
height: 52px
border-bottom: 1px solid var(--ata-gray-200)
```

Active tab:

```txt
font-weight: 700
color: var(--ata-gray-900)
border-bottom: 2px solid var(--ata-gray-900)
```

Inactive tab:

```txt
color: var(--ata-gray-600)
hover color: var(--ata-gray-900)
```

### 8.4 Overview Grid

Two columns:

```txt
Left column: minmax(0, 1.45fr)
Right column: minmax(360px, 0.95fr)
Gap: 24px
```

### 8.5 Authorization Usage Card

```txt
Title: Authorization usage
Subtitle: 20 hours/week · expires Dec 30, 2027
Badge: 92% used
Segmented bar: 20 units
Green units: 18
Amber units: 1
Gray units: remaining
Axis labels: 0h, 10h, 20h
```

Card height:

```txt
168px
```

### 8.6 Recent Activity Card

Rows:

```txt
Today   9:00–11:00am  Direct therapy · Ashley Chen
Apr 26  9:00–11:00am  Direct therapy · Ashley Chen
Apr 25  —             Cancelled · weather
Apr 23  9:00–11:00am  Direct therapy · Tyler Johnson
Apr 22  2:00–4:00pm   Parent training · Sarah Patel
```

Dot colors:

```txt
green for completed/normal
red for cancelled
```

### 8.7 Weekly Availability Card

Tiles:

```txt
Mon 9–5p
Tue 9–5p
Wed 9–5p
Thu 9–5p
Fri 9–5p
Sat Off
Sun Off
```

Tile dimensions:

```txt
min-width: 92px
height: 58px
border-radius: 8px
```

Available tile:

```txt
background: var(--ata-success-50)
border: 1px solid var(--ata-success-100)
```

Off tile:

```txt
background: var(--ata-gray-50)
border: 1px solid var(--ata-gray-200)
color: var(--ata-gray-500)
```

### 8.8 Right Column Cards

Care team:

```txt
Ashley Chen   RBT · Lvl III    Primary
Tyler Johnson RBT · Lvl I      Backup
Sarah Patel   BCBA             Supervising
```

Preferences:

```txt
Spanish required: No
Female provider only: No
Preferred location: Home
Min RBT level: —
```

Contacts:

```txt
Sarah Davis  Mother · (919) 555-0142  Primary
Marcus Davis Father · (919) 555-0188
```

Address:

```txt
675 Walnut St
Cary, NC 27511
```

---

## 9. Providers List Specification

### 9.1 Header

```txt
Title: Providers
Subtitle: 14 active providers
Action: + Add Provider
```

Use same layout style as Clients list unless existing data needs stat cards.

### 9.2 Optional Summary Cards

If used, keep compact:

```txt
Active providers: 14
Bilingual providers: 6
BCBAs: 4
Open availability today: 8
Credentials expiring soon: 3
```

Card:

```txt
height: 92px
border-radius: 16px
```

### 9.3 Filters

```txt
Search providers...
Position
Level
Language
Availability
Status
Show inactive toggle
Clear all
```

### 9.4 Table

Columns:

```txt
Provider
Position
Level
Languages
Weekly Availability
Utilization
Status
Actions
```

Rows:

```txt
Brooks, Devon      RBT    Level I    EN      Mon–Fri 8am–4pm  78% Active
Chen, Ashley       RBT    Level III  EN      Mon–Fri 9am–5pm  88% Active
Johnson, Tyler     RBT    Level I    EN      Mon–Fri 9am–5pm  72% Active
Kim, Jordan        BCaBA  —          EN      Mon–Fri 8am–4pm  45% Active
O’Brien, Chris     RBT    Level III  EN      Mon–Fri 9am–5pm  82% Active
Park, David        BCBA   —          EN      Mon–Fri 8am–4pm  40% Active
Patel, Sarah       BCBA   —          EN / ES Mon–Fri 9am–5pm  75% Active
Rivera, Alex       RBT    Level II   EN / ES Mon–Fri 8am–4pm  68% Active
Rivera, Marcos     RBT    Level II   EN      Mon–Fri 9am–5pm  70% Active
Rodriguez, Maria   RBT    Level II   EN / ES Mon–Fri 8am–4pm  78% Active
Santos, Jamie      RBT    Level I    EN / ES Mon–Fri 9am–5pm  76% Active
Test, Garrett      BCBA   —          EN      Mon–Fri 8am–4pm  35% Active
```

Utilization progress:

```txt
Green under 85%
Amber 85% - 94%
Red 95%+
Gray under 50% optional
```

---

## 10. Provider Detail Specification

### 10.1 Header

Breadcrumb:

```txt
Providers › Ashley Chen
```

Title:

```txt
Ashley Chen
```

Subtitle:

```txt
RBT — Registered Behavior Technician
```

Actions:

```txt
Edit
Message
Schedule
```

### 10.2 Summary Cards

Six cards:

```txt
Status: Active
Role / Level: RBT / Level III
Languages: English / Spanish: No
Weekly Target: 40 hrs / Mon–Fri
Utilization: 85% / 34 / 40 hrs
Service Area: Cary, NC / 25 mi radius
```

Card height:

```txt
100px
```

### 10.3 Main Grid

Two columns:

```txt
Left: 42%
Right: 58%
Gap: 24px
```

Left cards:

```txt
Details
Address
Credentials
Recent Schedule
```

Right cards:

```txt
Weekly Availability
Approved Clients
```

Details:

```txt
Status: Active
Position: RBT
RBT Level: Level III
Gender: Female
Spanish: No
Pay Rate: $26.00/hr
```

Address:

```txt
402 Weston Pkwy
Cary, NC, 27513
View on Map button
```

Credentials:

```txt
Registered Behavior Technician (RBT)
Issued by: BACB
Valid
Expires: 05/31/2026
```

Weekly availability:

```txt
Mon-Fri 9am–5pm
Sat/Sun Unavailable
```

Approved clients:

```txt
Mia Jackson          Kaiser
Charlotte Moore      United Healthcare
Benjamin Clark       Cigna
Emma Johnson         United Healthcare
View all 10 clients
```

---

## 11. New Session Modal Specification

### 11.1 Modal Container

Width:

```txt
560px
```

Header:

```txt
Icon: calendar-plus
Title: New Session
Subtitle: Create a new session on the schedule
Close X at top-right
```

Icon:

```txt
size: 40px
color: var(--ata-blue-600)
background: transparent or var(--ata-blue-50)
```

### 11.2 Summary Strip

Position:

```txt
Below header, before fields
```

Dimensions:

```txt
height: 72px
border-radius: 12px
border: 1px solid var(--ata-blue-100)
background: var(--ata-blue-25)
display: grid
grid-template-columns: 1fr 1fr
```

Fields:

```txt
Duration: 1h 00m
Setting: Not set
```

### 11.3 Form Fields

Field order:

```txt
Session Type
Client (optional for non-billable)
Session Name
Provider + Find best match
Start / End
Notes
```

Vertical spacing:

```txt
label to input: 8px
field group to next group: 20px
helper text top margin: 6px
```

Provider row:

```txt
Provider select width: calc(100% - 168px)
Find best match button width: 148px
Gap: 12px
```

Start/end row:

```txt
display: grid
grid-template-columns: 1fr 1fr
gap: 16px
```

Notes textarea:

```txt
height: 88px
```

### 11.4 Footer

Footer:

```txt
display: grid
grid-template-columns: 1fr 150px
gap: 16px
```

Buttons:

```txt
Book Session primary
Cancel secondary
```

Book Session:

```txt
height: 48px
font-size: 15px
```

---

## 12. Cancel Session Modal Specification

### 12.1 Modal Container

Width:

```txt
560px
```

Header:

```txt
Warning icon red
Title: Cancel Session
Close X
```

Warning icon:

```txt
size: 24px
color: var(--ata-danger-600)
```

### 12.2 Session Summary Card

```txt
height: 92px
padding: 18px 20px
background: var(--ata-blue-25)
border: 1px solid var(--ata-blue-100)
border-radius: 14px
```

Content:

```txt
Avatar: MJ, size 52px
Title: Jackson, Mia
Subtitle: Direct Therapy Home · Apr 30 at 9:00 AM
```

### 12.3 Cancelled By Segmented Control

Container:

```txt
height: 56px
display: grid
grid-template-columns: 1fr 1fr
border: 1px solid var(--ata-gray-200)
border-radius: 12px
overflow: hidden
```

Selected option:

```txt
background: var(--ata-blue-50)
border: 2px solid var(--ata-blue-600)
color: var(--ata-blue-700)
font-weight: 700
```

Options:

```txt
Client selected
Provider
```

### 12.4 Reason Dropdown

```txt
height: 52px
placeholder: Select reason...
```

### 12.5 Primary Action Row

Layout:

```txt
display: flex
justify-content: space-between
align-items: center
margin-top: 28px
```

Cancel Session button:

```txt
height: 48px
background: var(--ata-danger-600)
color: #FFFFFF
border-radius: 10px
padding: 0 20px
```

Keep button:

```txt
height: 48px
width: 132px
secondary style
```

### 12.6 Cancel Rest of Day Section

Container:

```txt
margin-top: 24px
padding: 18px
border-radius: 14px
background: var(--ata-danger-50)
border: 1px solid var(--ata-danger-100)
display: flex
gap: 16px
```

Title:

```txt
Cancel Client's Rest of Day
font-size: 16px
font-weight: 700
color: var(--ata-danger-700)
```

Description:

```txt
Cancels all remaining sessions and blocks the schedule from this time forward.
```

### 12.7 Tertiary Action

```txt
Remove Session Without Cancelling
centered
color: var(--ata-gray-600)
font-weight: 600
height: 44px
```

---

## 13. Implementation File/Folder Guidance

Adapt to existing codebase names, but prefer this structure if feasible.

```txt
src/
  components/
    app/
      AppShell.tsx
      SidebarNav.tsx
      PageHeader.tsx
    ui/
      Button.tsx
      Card.tsx
      Badge.tsx
      Chip.tsx
      DataTable.tsx
      Input.tsx
      SelectButton.tsx
      Modal.tsx
      ProgressBar.tsx
      SegmentedProgress.tsx
      FloatingActionDock.tsx
    schedule/
      ScheduleGrid.tsx
      DayScheduleView.tsx
      WeekScheduleView.tsx
      SessionBlock.tsx
      ScheduleToolbar.tsx
      ScheduleFilterPanel.tsx
      NewSessionModal.tsx
      CancelSessionModal.tsx
    communications/
      CommunicationsPage.tsx
      ThreadList.tsx
      ConversationPanel.tsx
      AIAssistantPanel.tsx
    clients/
      ClientsListPage.tsx
      ClientDetailPage.tsx
    providers/
      ProvidersListPage.tsx
      ProviderDetailPage.tsx
  styles/
    tokens.css
    globals.css
```

---

## 14. Data Shape Guidance

Use existing data sources where possible. These are reference interfaces only.

```ts
type Status = "active" | "inactive" | "discharged" | "cancelled" | "proposed";

type Client = {
  id: string;
  displayId: string;
  firstName: string;
  lastName: string;
  dob: string;
  ageLabel: string;
  gender?: "M" | "F" | "Other";
  insurance: string;
  authUsedHours: number;
  authTotalHours: number;
  preferences: Array<"female_only" | "spanish" | "home" | "center">;
  status: Status;
};

type Provider = {
  id: string;
  firstName: string;
  lastName: string;
  position: "RBT" | "BCBA" | "BCaBA";
  level?: "Level I" | "Level II" | "Level III";
  languages: string[];
  weeklyAvailabilityLabel: string;
  utilizationPct: number;
  status: Status;
};

type Session = {
  id: string;
  clientId?: string;
  providerId?: string;
  title: string;
  sessionType: "direct_therapy" | "direct_therapy_home" | "assessment" | "parent_training" | "supervision" | "lunch" | "drive_time" | "break";
  start: string;
  end: string;
  status: "scheduled" | "proposed" | "cancelled" | "in_progress" | "completed" | "conflict";
  locationType?: "home" | "center" | "telehealth";
};
```

---

## 15. Interaction Requirements

### 15.1 Tables

```txt
Click row: navigate to detail page
Checkbox: selection only
Sort headers: preserve existing sort behavior if present
Ellipsis: row actions menu
Selected row: highlight light blue
```

### 15.2 Schedule Blocks

```txt
Click session block: open session detail or edit drawer if currently implemented
Drag/drop: preserve existing behavior
Resize: preserve existing behavior if present
Hover: show border emphasis and menu
```

Hover state:

```txt
box-shadow: 0 2px 8px rgba(16,24,40,0.12)
border-color: var(--ata-blue-300)
```

### 15.3 Modals

```txt
Esc closes modal unless destructive confirmation is in progress
Click overlay closes only for non-destructive modal if existing behavior supports
Cancel Session modal should not close on overlay click unless codebase convention says otherwise
```

---

## 16. Responsive Behavior

Primary target is desktop.

Minimum supported width:

```txt
1366px
```

At widths below 1280px:

```txt
Use compact sidebar
Allow horizontal scroll for schedule grids
Do not collapse schedule rows into mobile cards
```

At widths below 1024px:

```txt
Tables may horizontally scroll
Detail pages may stack columns
Modals should fit viewport with max-height: calc(100vh - 48px) and internal scrolling
```

---

## 17. Accessibility Requirements

```txt
All buttons must have accessible labels
All icon-only nav items must have aria-label or tooltip
Focus rings must be visible
Modals must trap focus
Modals must restore focus to triggering button on close
Color must not be sole status indicator; include text labels
Table headers must use semantic th elements where possible
Use aria-current="page" for active nav item
```

Focus ring:

```css
outline: 2px solid var(--ata-blue-500);
outline-offset: 2px;
```

---

## 18. Migration and Cleanup Checklist

### 18.1 Global

```txt
[ ] All Together Autism name is used consistently
[ ] Provided logo asset is used
[ ] No unrelated placeholder brand remains
[ ] Shared tokens exist
[ ] Shared components are used across pages
[ ] No inline random colors except mapped data colors
[ ] Sidebar active states are consistent
[ ] Buttons are consistent
[ ] Inputs are consistent
[ ] Cards are consistent
[ ] Modals are consistent
```

### 18.2 Communications

```txt
[ ] Thread list looks modern and dense
[ ] Conversation panel uses modern bubbles
[ ] AI suggestions panel exists and is polished
[ ] Sidebar matches global shell
```

### 18.3 Schedule Day View

```txt
[ ] Has global sidebar
[ ] Has filter panel
[ ] Has no right sidebar
[ ] Provider and client session blocks use same component and same dimensions
[ ] Floating bottom dock exists
[ ] Schedule efficiency visible
[ ] Current time marker visible
```

### 18.4 Schedule Week View

```txt
[ ] Week toggle selected
[ ] Date range Apr 27 – May 1, 2026 visible
[ ] Providers section above Clients section
[ ] Day columns Monday through Friday
[ ] Session chips are readable
[ ] Proposed/dashed block style exists
[ ] Floating bottom dock exists
```

### 18.5 Clients List

```txt
[ ] Dense table layout, not card-heavy
[ ] Subtitle reads 17 active · 3 unstaffed · 71h/wk authorized
[ ] Export and + Add client buttons visible
[ ] Search and filters visible
[ ] Auth usage bars visible
[ ] Olivia Davis row highlighted
```

### 18.6 Client Detail

```txt
[ ] Olivia Davis profile structure matches spec
[ ] Tabs present
[ ] Authorization usage segmented bar present
[ ] Recent activity card present
[ ] Weekly availability tiles present
[ ] Care team/preferences/contacts/address cards present
```

### 18.7 Providers List

```txt
[ ] Provider table has utilization bars
[ ] Language chips visible
[ ] Show inactive toggle visible
[ ] Add Provider button visible
```

### 18.8 Provider Detail

```txt
[ ] Ashley Chen header and actions visible
[ ] Summary cards visible
[ ] Details/address/credentials cards visible
[ ] Weekly availability visible
[ ] Approved clients visible
```

### 18.9 New Session Modal

```txt
[ ] Modal matches token styling
[ ] Summary strip shows duration and setting
[ ] Required fields present
[ ] Find best match visible
[ ] Book Session and Cancel footer present
```

### 18.10 Cancel Session Modal

```txt
[ ] Warning title treatment present
[ ] Jackson, Mia session summary present
[ ] Client/Provider segmented control present
[ ] Reason dropdown present
[ ] Cancel Session and Keep actions present
[ ] Cancel Client's Rest of Day red section present
[ ] Remove Session Without Cancelling tertiary action present
```

---

## 19. Final Visual QA Rules

Before considering the redesign complete, verify:

```txt
1. The app looks like one system across all pages.
2. The dark navy sidebar is consistent.
3. All Together Autism branding is correct.
4. No page has accidental old plain styling.
5. Tables have consistent row heights.
6. Buttons use shared variants.
7. Modals share one modal system.
8. Schedule day view has no right panel.
9. Schedule client/provider session blocks are identical in size/style.
10. Week view matches the new day-view aesthetic.
11. Clients list is dense and close to the approved simplified reference.
12. Client detail is workflow-oriented and close to the approved reference.
13. Destructive actions are clearly red and separated.
14. The UI remains readable at 1366px width.
15. No layout requires guessing from the implementation agent.
```

---


---

# 21. Expanded Codebase Implementation Blueprint

This section intentionally repeats some earlier concepts with more engineering specificity. The purpose is to remove ambiguity for an IDE agent that is not design-oriented.

The implementation agent should treat this section as the practical build contract.

## 21.1 Required Visual End State

After implementation, every redesigned screen should look like it belongs to the same All Together Autism application.

The following visual facts must be true:

```txt
1. The dark navy app sidebar is present on all redesigned full-page views.
2. All Together Autism logo is visible in the sidebar.
3. Active navigation state is blue, rounded, and visually obvious.
4. Page backgrounds are off-white or white, never flat unstyled gray.
5. Main content uses rounded white cards with 1px light borders.
6. Inputs, selects, search bars, buttons, tables, modals, chips, badges, and progress bars share one style system.
7. Spacing follows an 8px rhythm.
8. Buttons are not browser-default.
9. Tables are not plain HTML tables.
10. Modal overlays are dimmed and blurred.
11. Destructive actions are red and separated from normal actions.
12. Schedule session cards use a shared SessionBlock component.
13. Client and provider session cards are identical in height, padding, border radius, and typography.
14. No page uses old inconsistent table row styling.
15. No page contains any placeholder branding other than All Together Autism.
```

## 21.2 Visual Density Standards

Use the following density rules so the application remains operationally useful.

```txt
Communications page:
  Medium density.
  Thread cards are readable but compact.
  Message area has comfortable spacing.

Schedule day view:
  High density.
  Must show many clients/providers without oversized rows.
  Row height should remain 36px unless content forces otherwise.

Schedule week view:
  High density.
  Must show provider/client rows and five weekday columns.
  Week chips are compact and readable.

Clients list:
  High density.
  Must stay table-first.
  Do not convert into oversized metric-card page.

Client detail:
  Medium density.
  Header and tabs are compact.
  Cards should be information-rich.

Providers list:
  High density.
  Similar to Clients list.

Provider detail:
  Medium density.
  Summary cards plus two-column profile cards.

Modals:
  Medium density.
  Enough spacing for clarity, but do not make giant forms.
```

## 21.3 Global CSS Reset Requirements

If not already present, add or verify:

```css
* {
  box-sizing: border-box;
}

html,
body,
#root {
  min-height: 100%;
}

body {
  margin: 0;
  font-family: var(--font-sans);
  background: var(--ata-bg);
  color: var(--ata-gray-900);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

button,
input,
select,
textarea {
  font: inherit;
}

button {
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
}

a {
  color: inherit;
  text-decoration: none;
}
```

## 21.4 Preferred CSS Variable Naming

All new custom styles should use `ata-` prefixed classes or variables.

Examples:

```txt
Good:
  --ata-blue-600
  .ata-page
  .ata-card
  .ata-sidebar
  .ata-table

Avoid:
  --primaryRandom
  .newThing
  .niceCard
  .test-style
```

## 21.5 Tailwind Mapping If Tailwind Exists

If Tailwind is used, extend the config rather than scattering arbitrary values.

Recommended mapping:

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        ata: {
          bg: "#F8FAFC",
          surface: "#FFFFFF",
          navy: {
            950: "#061529",
            900: "#08203D",
            850: "#0A2A50",
            800: "#0C3568",
          },
          blue: {
            25: "#F5F9FF",
            50: "#EFF6FF",
            100: "#DBEAFE",
            200: "#BFDBFE",
            500: "#3B82F6",
            600: "#2563EB",
            700: "#1D4ED8",
            800: "#1E40AF",
          },
          gray: {
            25: "#FCFCFD",
            50: "#F9FAFB",
            100: "#F2F4F7",
            200: "#EAECF0",
            300: "#D0D5DD",
            400: "#98A2B3",
            500: "#667085",
            600: "#475467",
            700: "#344054",
            800: "#1D2939",
            900: "#101828",
          },
          success: {
            50: "#ECFDF3",
            100: "#D1FADF",
            600: "#039855",
            700: "#027A48",
          },
          warning: {
            50: "#FFFAEB",
            100: "#FEF0C7",
            500: "#F79009",
            600: "#DC6803",
          },
          danger: {
            50: "#FEF3F2",
            100: "#FEE4E2",
            500: "#F04438",
            600: "#D92D20",
            700: "#B42318",
          },
          purple: {
            50: "#F4F3FF",
            100: "#EBE9FE",
            600: "#6938EF",
          },
        },
      },
      borderRadius: {
        ata: "10px",
        "ata-card": "16px",
        "ata-modal": "20px",
      },
      boxShadow: {
        ata: "0 1px 2px rgba(16, 24, 40, 0.05)",
        "ata-card": "0 1px 3px rgba(16, 24, 40, 0.10), 0 1px 2px rgba(16, 24, 40, 0.06)",
        "ata-modal": "0 24px 48px -12px rgba(16, 24, 40, 0.28)",
        "ata-dock": "0 16px 40px rgba(16, 24, 40, 0.18)",
      },
    },
  },
};
```

Do not use arbitrary Tailwind values for core primitives when a token can be used.

---

# 22. Component Contracts and JSX Skeletons

These are not complete implementations. They define expected component structure so the IDE agent has a clear target.

## 22.1 AppShell Contract

```tsx
type NavKey =
  | "home"
  | "schedule"
  | "clients"
  | "providers"
  | "sessions"
  | "communications"
  | "reports"
  | "billing"
  | "settings";

type AppShellProps = {
  activeNav: NavKey;
  sidebarVariant?: "expanded" | "compact";
  children: React.ReactNode;
};

export function AppShell({
  activeNav,
  sidebarVariant = "expanded",
  children,
}: AppShellProps) {
  return (
    <div className="ata-app-shell">
      <SidebarNav activeNav={activeNav} variant={sidebarVariant} />
      <main className="ata-app-main">{children}</main>
    </div>
  );
}
```

CSS contract:

```css
.ata-app-shell {
  display: flex;
  min-height: 100vh;
  background: var(--ata-bg);
}

.ata-app-main {
  flex: 1;
  min-width: 0;
  background: var(--ata-bg);
}
```

## 22.2 SidebarNav Contract

```tsx
type SidebarNavProps = {
  activeNav: NavKey;
  variant?: "expanded" | "compact";
};

const navItems = [
  { key: "home", label: "Home", icon: HomeIcon },
  { key: "schedule", label: "Schedule", icon: CalendarIcon },
  { key: "clients", label: "Clients", icon: UsersIcon },
  { key: "providers", label: "Providers", icon: UserRoundIcon },
  { key: "sessions", label: "Sessions", icon: ClipboardListIcon },
  { key: "communications", label: "Communications", icon: MessageCircleIcon },
  { key: "reports", label: "Reports", icon: BarChartIcon },
  { key: "billing", label: "Billing", icon: ReceiptIcon },
  { key: "settings", label: "Settings", icon: SettingsIcon },
];
```

Implementation details:

```txt
- The logo must be All Together Autism.
- For compact variant, show only the logo mark and icon nav.
- For expanded variant, show full logo if it fits.
- Add aria-current="page" to the active nav item.
- Add aria-label to icon-only nav items.
- Use a tooltip if the codebase has one.
```

Expanded CSS:

```css
.ata-sidebar {
  width: 184px;
  flex: 0 0 184px;
  min-height: 100vh;
  background: linear-gradient(180deg, #061529 0%, #08203D 52%, #061529 100%);
  color: white;
  border-right: 1px solid rgba(255,255,255,0.06);
  display: flex;
  flex-direction: column;
  padding: 20px 12px 16px;
}

.ata-sidebar--compact {
  width: 72px;
  flex-basis: 72px;
  align-items: center;
}

.ata-sidebar-logo {
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 18px;
}

.ata-sidebar-logo img {
  max-width: 144px;
  max-height: 44px;
  object-fit: contain;
}

.ata-nav-item {
  height: 44px;
  border-radius: 12px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  gap: 12px;
  color: rgba(255,255,255,0.82);
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 6px;
  border: 0;
  background: transparent;
  width: 100%;
}

.ata-nav-item:hover {
  background: rgba(255,255,255,0.08);
  color: #FFFFFF;
}

.ata-nav-item--active {
  background: linear-gradient(180deg, #2563EB 0%, #1D4ED8 100%);
  color: #FFFFFF;
  box-shadow: 0 8px 20px rgba(37, 99, 235, 0.34);
}
```

## 22.3 PageHeader Contract

```tsx
type PageHeaderAction = {
  label: string;
  icon?: React.ReactNode;
  variant: "primary" | "secondary" | "ghost";
  onClick?: () => void;
};

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  breadcrumb?: Array<{ label: string; href?: string }>;
  actions?: PageHeaderAction[];
  children?: React.ReactNode;
};
```

Layout:

```txt
margin-bottom: 24px
display: flex
align-items: flex-start
justify-content: space-between
gap: 24px
```

## 22.4 Button Contract

```tsx
type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "dangerSecondary";

type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  fullWidth?: boolean;
};
```

Sizes:

```txt
sm: height 36px, padding 12px, radius 8px
md: height 44px, padding 18px, radius 10px
lg: height 48px, padding 20px, radius 12px
```

## 22.5 DataTable Contract

```tsx
type DataTableColumn<T> = {
  key: string;
  header: string;
  width?: string;
  align?: "left" | "center" | "right";
  sortable?: boolean;
  render: (row: T) => React.ReactNode;
};

type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  rows: T[];
  selectedRowId?: string;
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  footer?: React.ReactNode;
};
```

Rules:

```txt
- Use a shared DataTable for Clients and Providers.
- Do not hand-code separate table styling for each list page.
- Table rows must be 64-68px tall.
- Header must be uppercase 12px.
- Selected row must be supported.
```

## 22.6 Modal Contract

```tsx
type ModalProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  onClose: () => void;
  width?: number | string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  closeOnOverlayClick?: boolean;
  destructive?: boolean;
};
```

Rules:

```txt
- Modal overlay must dim and blur the app background.
- Modal must have close X.
- Destructive modals must not close accidentally if current convention allows disabling overlay close.
- Modal body should scroll internally when viewport is short.
```

## 22.7 SessionBlock Contract

```tsx
type SessionBlockProps = {
  title: string;
  subtitle?: string;
  startLabel?: string;
  endLabel?: string;
  type:
    | "directTherapy"
    | "directTherapyHome"
    | "assessment"
    | "parentTraining"
    | "supervision"
    | "lunch"
    | "driveTime"
    | "break"
    | "cancellation";
  status?: "scheduled" | "proposed" | "inProgress" | "completed" | "cancelled" | "conflict";
  compact?: boolean;
  showMenu?: boolean;
  onClick?: () => void;
};
```

Critical:

```txt
Use this component for BOTH client and provider schedule rows.
Do not create ClientSessionBlock and ProviderSessionBlock with different dimensions.
```

Day view class:

```css
.ata-session-block {
  height: 28px;
  min-width: 96px;
  border-radius: 8px;
  padding: 4px 8px;
  border: 1px solid;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  font-size: 12px;
  line-height: 1.15;
}

.ata-session-block__title {
  font-size: 12px;
  font-weight: 700;
  color: var(--ata-gray-800);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ata-session-block__time {
  font-size: 11px;
  font-weight: 500;
  color: var(--ata-gray-600);
}
```

Week view compact class:

```css
.ata-week-session-chip {
  height: 24px;
  width: calc(100% - 12px);
  margin: 6px;
  border-radius: 6px;
  padding: 0 8px;
  border: 1px solid;
  font-size: 12px;
  font-weight: 600;
}
```

---

# 23. Exact Page DOM Blueprints

These are recommended component trees. Adapt to the codebase, but preserve the structure.

## 23.1 Communications DOM Blueprint

```tsx
<AppShell activeNav="communications">
  <div className="ata-communications">
    <aside className="ata-thread-panel">
      <header className="ata-thread-header">
        <div>
          <h1>Communications</h1>
          <p>Coordinate messages with providers and clients</p>
        </div>
        <Button size="sm" variant="primary">New</Button>
      </header>

      <div className="ata-thread-tools">
        <SearchInput placeholder="Search conversations..." />
        <FilterChipRow
          items={["All", "Unread", "Providers", "Clients", "Urgent", "Coverage"]}
          active="All"
        />
      </div>

      <ThreadList>
        <ThreadGroup label="Today" />
        <ThreadCard selected unreadCount={2} />
      </ThreadList>
    </aside>

    <section className="ata-conversation-panel">
      <ConversationHeader />
      <ConversationContextRow />
      <MessageTimeline />
      <SmartReplies />
      <MessageComposer />
    </section>

    <aside className="ata-chat-ai-panel">
      <AIPanelHeader title="AI Suggestions" />
      <AIPanelBody>
        <MessageSummary />
        <SuggestedReply />
        <RecommendedActions />
        <ConversationInsights />
      </AIPanelBody>
    </aside>
  </div>
</AppShell>
```

## 23.2 Schedule Day DOM Blueprint

```tsx
<AppShell activeNav="schedule">
  <div className="ata-schedule-page">
    <ScheduleTopBar
      view="day"
      dateLabel="Wed, Apr 29, 2026"
      efficiencyPct={77}
      hoursLabel="65h / 84h"
    />

    <div className="ata-schedule-body">
      <ScheduleFilterPanel />

      <main className="ata-day-schedule">
        <DayScheduleGrid
          timeColumns={["9 AM", "10 AM", "11 AM", "12 PM", "1 PM", "2 PM", "3 PM", "4 PM", "5 PM", "6 PM", "7 PM"]}
          sections={[
            { type: "clients", rows: clientRows },
            { type: "providers", rows: providerRows },
          ]}
        />
      </main>
    </div>

    <FloatingActionDock
      actions={["Add session", "Analyze day", "Resolve conflicts", "Auto-complete"]}
    />
  </div>
</AppShell>
```

Schedule body CSS:

```css
.ata-schedule-body {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  height: calc(100vh - 72px);
  min-width: 0;
}
```

## 23.3 Schedule Week DOM Blueprint

```tsx
<AppShell activeNav="schedule">
  <div className="ata-schedule-page">
    <ScheduleTopBar
      view="week"
      dateLabel="Apr 27 – May 1, 2026"
      efficiencyPct={87}
      hoursLabel="74h / 85h 30m"
    />

    <main className="ata-week-schedule">
      <WeekScheduleGrid
        days={[
          { label: "MON", date: "Apr 27" },
          { label: "TUE", date: "Apr 28" },
          { label: "WED", date: "Apr 29" },
          { label: "THU", date: "Apr 30" },
          { label: "FRI", date: "May 1" },
        ]}
        providerRows={providerRows}
        clientRows={clientRows}
      />
    </main>

    <FloatingActionDock
      actions={["Add session", "Clear week", "Analyze week", "Auto schedule week"]}
    />
  </div>
</AppShell>
```

## 23.4 Clients List DOM Blueprint

```tsx
<AppShell activeNav="clients" sidebarVariant="compact">
  <div className="ata-page ata-clients-page">
    <PageHeader
      title="Clients"
      subtitle="17 active · 3 unstaffed · 71h/wk authorized"
      actions={[
        { label: "Export", variant: "secondary" },
        { label: "Add client", variant: "primary" },
      ]}
    />

    <FilterBar>
      <SearchInput placeholder="Search clients..." shortcut="⌘K" />
      <SelectButton label="All insurances" />
      <SelectButton label="Any preference" />
      <SelectButton label="Active" />
      <SortLabel>Sort: Name ↑</SortLabel>
    </FilterBar>

    <DataTable
      columns={clientColumns}
      rows={clients}
      selectedRowId="C-004"
    />
  </div>
</AppShell>
```

## 23.5 Client Detail DOM Blueprint

```tsx
<AppShell activeNav="clients" sidebarVariant="compact">
  <div className="ata-page ata-client-detail-page">
    <Breadcrumb items={["Clients", "Active", "Olivia Davis"]} />

    <ClientProfileHeader
      initials="OD"
      name="Olivia Davis"
      status="Active"
      ageGender="7y · F"
      metadata={[
        "Insurance Blue Cross Blue Shield",
        "Auth 97153 · expires Dec 30, 2027",
        "Active since Dec 31, 2023",
        "ID #C-004",
      ]}
      actions={["Schedule", "Message", "Edit"]}
    />

    <Tabs
      active="Overview"
      items={["Overview", "Schedule", "Authorizations", "Sessions", "Notes", "Activity"]}
    />

    <div className="ata-profile-grid">
      <div className="ata-profile-main-column">
        <AuthorizationUsageCard />
        <RecentActivityCard />
        <WeeklyAvailabilityTiles />
      </div>

      <div className="ata-profile-side-column">
        <CareTeamCard />
        <PreferencesCard />
        <ContactsCard />
        <AddressCard />
      </div>
    </div>
  </div>
</AppShell>
```

## 23.6 Providers List DOM Blueprint

```tsx
<AppShell activeNav="providers" sidebarVariant="compact">
  <div className="ata-page ata-providers-page">
    <PageHeader
      title="Providers"
      subtitle="14 active providers"
      actions={[{ label: "Add Provider", variant: "primary" }]}
    />

    <ProviderMetricRow />
    <ProviderFilterBar />
    <DataTable columns={providerColumns} rows={providers} />
  </div>
</AppShell>
```

## 23.7 Provider Detail DOM Blueprint

```tsx
<AppShell activeNav="providers" sidebarVariant="compact">
  <div className="ata-page ata-provider-detail-page">
    <Breadcrumb items={["Providers", "Ashley Chen"]} />

    <ProviderProfileHeader
      name="Ashley Chen"
      subtitle="RBT — Registered Behavior Technician"
      actions={["Edit", "Message", "Schedule"]}
    />

    <ProviderSummaryCards />

    <div className="ata-provider-grid">
      <div>
        <DetailsCard />
        <AddressCard />
        <CredentialsCard />
        <RecentScheduleCard />
      </div>
      <div>
        <WeeklyAvailabilityCard />
        <ApprovedClientsCard />
      </div>
    </div>
  </div>
</AppShell>
```

---

# 24. Exact CSS Layout Recipes

## 24.1 Page Container

```css
.ata-page {
  padding: 32px 40px;
  background: var(--ata-bg);
  min-height: 100vh;
}

.ata-page--white {
  background: #FFFFFF;
}
```

## 24.2 Header and Filter Bar

```css
.ata-page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 24px;
}

.ata-page-title {
  margin: 0;
  font-size: 30px;
  line-height: 36px;
  font-weight: 700;
  color: var(--ata-gray-900);
}

.ata-page-subtitle {
  margin: 4px 0 0;
  font-size: 15px;
  line-height: 22px;
  color: var(--ata-gray-600);
}

.ata-header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ata-filter-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
}
```

## 24.3 Shared Card

```css
.ata-card {
  background: #FFFFFF;
  border: 1px solid rgba(16, 24, 40, 0.08);
  border-radius: 16px;
  box-shadow: var(--shadow-xs);
}

.ata-card-header {
  padding: 18px 20px;
  border-bottom: 1px solid var(--ata-gray-100);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ata-card-title {
  font-size: 16px;
  line-height: 24px;
  font-weight: 700;
  color: var(--ata-gray-900);
  margin: 0;
}

.ata-card-body {
  padding: 20px;
}
```

## 24.4 Shared Table

```css
.ata-table-card {
  background: #FFFFFF;
  border: 1px solid var(--ata-gray-200);
  border-radius: 16px;
  box-shadow: var(--shadow-xs);
  overflow: hidden;
}

.ata-table {
  width: 100%;
  border-collapse: collapse;
}

.ata-table thead tr {
  height: 48px;
  background: var(--ata-gray-25);
}

.ata-table th {
  padding: 0 20px;
  font-size: 12px;
  line-height: 16px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .04em;
  color: var(--ata-gray-600);
  text-align: left;
  border-bottom: 1px solid var(--ata-gray-200);
}

.ata-table tbody tr {
  height: 68px;
  border-bottom: 1px solid var(--ata-gray-100);
}

.ata-table tbody tr:hover {
  background: var(--ata-blue-25);
}

.ata-table tbody tr.ata-row-selected {
  background: var(--ata-blue-50);
  box-shadow: inset 3px 0 0 var(--ata-blue-600);
}

.ata-table td {
  padding: 0 20px;
  vertical-align: middle;
  font-size: 14px;
  color: var(--ata-gray-700);
}
```

## 24.5 Modal CSS

```css
.ata-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(6, 21, 41, 0.58);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.ata-modal {
  width: min(560px, calc(100vw - 48px));
  max-height: calc(100vh - 48px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: #FFFFFF;
  border-radius: 20px;
  box-shadow: var(--shadow-modal);
}

.ata-modal-header {
  padding: 28px 32px 18px;
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.ata-modal-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ata-modal-title {
  font-size: 20px;
  line-height: 28px;
  font-weight: 700;
  color: var(--ata-gray-900);
  margin: 0;
}

.ata-modal-subtitle {
  margin: 4px 0 0;
  font-size: 14px;
  line-height: 20px;
  color: var(--ata-gray-600);
}

.ata-modal-body {
  padding: 0 32px 28px;
  overflow-y: auto;
}

.ata-modal-footer {
  padding: 20px 32px;
  border-top: 1px solid var(--ata-gray-100);
  display: flex;
  gap: 12px;
}
```

---

# 25. Detailed State and Interaction Specifications

## 25.1 Focus and Keyboard

Every interactive element must have visible focus.

```css
.ata-focus-ring:focus-visible,
button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
[role="button"]:focus-visible {
  outline: 2px solid var(--ata-blue-500);
  outline-offset: 2px;
}
```

Keyboard rules:

```txt
Global:
  Tab order must follow visual order.
  Escape closes non-destructive overlays.
  Enter activates buttons when focused.

Modals:
  Focus starts on first input or first meaningful action.
  Focus is trapped inside modal.
  Focus returns to triggering button after close.

Communications:
  Cmd/Ctrl + Enter sends message if composer has content.
  Enter alone inserts line break unless current app convention differs.

Tables:
  Row click navigates.
  Checkbox click selects only and does not navigate.
```

## 25.2 Loading Skeletons

Skeleton color:

```txt
Base: var(--ata-gray-100)
Highlight: var(--ata-gray-50)
Radius: 8px
```

Clients/providers table skeleton:

```txt
Header remains visible.
Show 8 skeleton rows.
Avatar skeleton: 36px circle.
Text skeleton primary: width 140px, height 12px.
Text skeleton secondary: width 72px, height 10px.
```

Communications skeleton:

```txt
Thread list: 8 skeleton cards, 92px each.
Message timeline: 6 bubbles, alternating left/right.
AI panel: 4 skeleton cards.
```

Schedule skeleton:

```txt
Show grid header and row labels.
Session blocks become muted skeleton blocks.
Avoid full-page spinner.
```

## 25.3 Empty States

Empty state component:

```txt
Container min-height: 320px
Icon size: 48px
Icon background: var(--ata-blue-50)
Title: 18px / 26px / 700
Description: 14px / 20px / gray-600
Primary action optional
```

Examples:

```txt
No clients:
  Title: No clients found
  Description: Try adjusting filters or add a new client.
  Action: Add client

No providers:
  Title: No providers found
  Description: Try adjusting filters or add a new provider.
  Action: Add provider

No communications:
  Title: No conversations found
  Description: Clear filters or start a new message.
  Action: New message

No schedule sessions:
  Title: No sessions scheduled
  Description: Add a session or auto-schedule based on availability.
  Action: Add session
```

## 25.4 Error States

Inline error:

```txt
background: var(--ata-danger-50)
border: 1px solid var(--ata-danger-100)
color: var(--ata-danger-700)
border-radius: 12px
padding: 12px 14px
font-size: 14px
```

Error actions:

```txt
Retry
Dismiss
```

Do not use browser alert dialogs for normal errors.

---

# 26. Page-by-Page Implementation Details Beyond Visuals

## 26.1 Communications Business UI Rules

Thread sorting:

```txt
Default sort: latest message first.
Unread threads appear normally by date unless existing app pins unread.
Urgent threads may show red/orange tag but should not break sorting unless current logic does.
```

Thread tags:

```txt
Provider role tags:
  RBT, BCBA, BCaBA

Issue tags:
  Coverage needed
  Follow-up
  Supervision
  Time off
  Client
  Urgent
```

Conversation header actions:

```txt
Phone: optional, use disabled style if not supported.
Video: optional, omit if not supported.
Profile/contact: opens existing provider/client profile if implemented.
More: opens thread actions if implemented.
```

Composer behavior:

```txt
Send button disabled when input is empty.
Send button shows loading spinner or “Sending…” state during send.
Failed message shows Retry.
Attachments icon can be present even if disabled; disabled icon must have tooltip or aria-label.
Templates dropdown can use existing canned response system.
AI Assist button should open/focus AI panel if panel collapsible.
```

AI panel behavior:

```txt
Use existing AI/suggestion data if available.
If no AI backend exists, implement static UI scaffolding only with safe placeholder disabled actions.
Never create fake backend calls.
```

## 26.2 Schedule Day Business UI Rules

Grid behavior:

```txt
Horizontal scroll allowed.
Vertical scroll allowed.
Name column sticky if feasible.
Time header sticky if feasible.
Section headers should remain visually obvious.
```

Session placement:

```txt
Position by start/end time using existing scheduling logic.
Do not alter core scheduling calculations unless needed to fix visual alignment.
```

Block labels:

```txt
Primary label:
  Client name for client rows.
  Client name/session name for provider rows.

Secondary label:
  Session type and/or time.
```

Block menu:

```txt
Click ellipsis opens existing session actions if present.
Actions may include Edit, Cancel, Duplicate, View details.
```

Day view filter panel:

```txt
Session type filters should preserve existing filter behavior if present.
Status key should be clickable only if current app supports it; otherwise it can be display-only.
```

## 26.3 Schedule Week Business UI Rules

Week date range:

```txt
Show Monday-Friday operational week by default.
If existing app includes weekend, keep backend capability but visual reference is Mon-Fri.
```

Week cell content:

```txt
One or more session chips per cell.
If more than 2 chips do not fit, show "+N more" chip.
```

Provider rows:

```txt
Show provider credential beside name in muted text.
```

Client rows:

```txt
Client section below provider section.
```

Proposed sessions:

```txt
Dashed border.
White or very light background.
Blue text.
```

Conflict sessions:

```txt
Amber/red border or conflict icon.
Do not use same style as normal scheduled sessions.
```

## 26.4 Clients List Business UI Rules

Selected Olivia Davis row:

```txt
Only for demonstration/approved design.
In actual app, selected row should map to router selection, hover, or current row state.
```

Auth used bar thresholds:

```txt
< 75%: green
75-94%: amber
>= 95%: red
```

Preference chips:

```txt
female_only -> Female only, purple
spanish -> Spanish, blue
home -> Home, teal optional
center -> Center, gray/blue optional
```

Status:

```txt
Active -> green
Discharged -> gray
Inactive -> gray/amber
Pending -> blue/amber
```

## 26.5 Client Detail Business UI Rules

Tabs:

```txt
Overview is implemented first.
Other tabs may route to existing content.
Do not delete existing tab content if already present.
```

Authorization usage:

```txt
Prefer real authorization data if available.
If data is absent, show empty state instead of fake percentages.
```

Care team:

```txt
Primary, Backup, Supervising labels should map to existing assignments if available.
```

Recent activity:

```txt
Use existing session/activity data if available.
If absent, show empty state:
  No recent activity
```

## 26.6 Providers List Business UI Rules

Utilization:

```txt
Actual scheduled hours / target hours.
If target unavailable, use "—" and no progress bar.
```

Language chips:

```txt
Use EN, ES shorthand in list.
Full language names can appear in detail page.
```

Position values:

```txt
RBT
BCBA
BCaBA
```

## 26.7 Provider Detail Business UI Rules

Credential card:

```txt
Show expiration status.
If expiration within 60 days, use warning chip.
If expired, use danger chip.
```

Approved clients:

```txt
Use existing approved/assigned clients if available.
Each row should link to client profile if route exists.
```

Weekly availability:

```txt
Use existing availability data.
Rows should be editable if existing edit behavior exists.
```

---

# 27. Data Fixtures for Visual QA Only

Use these only for local visual QA if the codebase needs seed data. Do not replace real data fetching.

## 27.1 Client Fixture

```ts
export const ataClientRows = [
  {
    id: "C-001",
    initials: "LA",
    name: "Anderson, Lucas",
    ageDob: "9y · Apr 19, 2017",
    insurance: "Aetna",
    authUsed: 14,
    authTotal: 20,
    preferences: [],
    status: "Active",
  },
  {
    id: "C-002",
    initials: "SB",
    name: "Brown, Sofia",
    ageDob: "10y · Sep 2, 2015",
    insurance: "Kaiser",
    authUsed: 18,
    authTotal: 20,
    preferences: [],
    status: "Active",
  },
  {
    id: "C-003",
    initials: "BC",
    name: "Clark, Benjamin",
    ageDob: "11y · Sep 21, 2014",
    insurance: "Cigna",
    authUsed: 12,
    authTotal: 15,
    preferences: [],
    status: "Active",
  },
  {
    id: "C-004",
    initials: "OD",
    name: "Davis, Olivia",
    ageDob: "7y · Jan 29, 2019",
    insurance: "Blue Cross Blue Shield",
    authUsed: 18.5,
    authTotal: 20,
    preferences: ["Female only"],
    status: "Active",
  },
  {
    id: "C-005",
    initials: "MG",
    name: "Gonzalez, Mateo",
    ageDob: "7y · Dec 4, 2018",
    insurance: "Medicaid",
    authUsed: 6,
    authTotal: 25,
    preferences: ["Spanish"],
    status: "Active",
  },
];
```

## 27.2 Provider Fixture

```ts
export const ataProviderRows = [
  {
    id: "P-001",
    initials: "DB",
    name: "Brooks, Devon",
    position: "RBT",
    level: "Level I",
    languages: ["EN"],
    availability: "Mon–Fri 8am–4pm",
    utilization: 78,
    status: "Active",
  },
  {
    id: "P-002",
    initials: "AC",
    name: "Chen, Ashley",
    position: "RBT",
    level: "Level III",
    languages: ["EN"],
    availability: "Mon–Fri 9am–5pm",
    utilization: 88,
    status: "Active",
  },
  {
    id: "P-003",
    initials: "TJ",
    name: "Johnson, Tyler",
    position: "RBT",
    level: "Level I",
    languages: ["EN"],
    availability: "Mon–Fri 9am–5pm",
    utilization: 72,
    status: "Active",
  },
  {
    id: "P-004",
    initials: "SP",
    name: "Patel, Sarah",
    position: "BCBA",
    level: "—",
    languages: ["EN", "ES"],
    availability: "Mon–Fri 9am–5pm",
    utilization: 75,
    status: "Active",
  },
];
```

## 27.3 Communications Fixture

```ts
export const ataThreads = [
  {
    id: "T-001",
    name: "Jordan Smith",
    role: "RBT",
    initials: "JS",
    preview: "Thanks for reaching out! I can cover Tuesday’s 4:00 PM session.",
    timestamp: "10:31 AM",
    unreadCount: 2,
    tags: ["RBT", "Coverage needed"],
    selected: true,
  },
  {
    id: "T-002",
    name: "Sarah Johnson",
    role: "Provider",
    initials: "SJ",
    preview: "I have a scheduling conflict on Wednesday at 4pm for Liam Parker.",
    timestamp: "10:24 AM",
    unreadCount: 1,
    tags: ["Coverage"],
  },
  {
    id: "T-003",
    name: "Maria Torres",
    role: "Caregiver",
    initials: "MT",
    preview: "Will the session still be at our home this week?",
    timestamp: "8:42 AM",
    unreadCount: 1,
    tags: ["Client"],
  },
];
```

---

# 28. Visual Pixel Checklist by Screen

## 28.1 Communications Pixel Checklist

```txt
Sidebar:
  [ ] Width exactly 184px expanded unless compact specified
  [ ] Active Communications item blue
  [ ] All Together Autism logo visible

Thread panel:
  [ ] Width exactly 360px desktop
  [ ] Right border 1px gray-200
  [ ] Header padding 20px 16px
  [ ] Search height 42px
  [ ] Thread cards min-height 92px
  [ ] Selected card has blue tinted background and 3px left inset

Conversation:
  [ ] Header height 104px
  [ ] Context row appears or pinned note appears
  [ ] Timeline padding 24px
  [ ] Inbound bubble white with gray border
  [ ] Outbound bubble blue-50 with blue border
  [ ] Composer has bordered rounded container
  [ ] Send button blue

AI panel:
  [ ] Width 320px
  [ ] Left border 1px gray-200
  [ ] AI cards radius 14px
  [ ] Beta badge purple
```

## 28.2 Schedule Day Pixel Checklist

```txt
Sidebar:
  [ ] Width 184px
  [ ] Schedule active

Filter panel:
  [ ] Width 240px
  [ ] White background
  [ ] Right border

Schedule:
  [ ] Header height 72px
  [ ] Time header height 44px
  [ ] Name column width 220px
  [ ] Row height 36px
  [ ] Session blocks height 28px
  [ ] Provider blocks same as client blocks
  [ ] No right sidebar
  [ ] Floating action dock bottom center
```

## 28.3 Week View Pixel Checklist

```txt
Header:
  [ ] Week selected
  [ ] Date range visible
  [ ] Schedule efficiency visible

Grid:
  [ ] Name column 220px
  [ ] 5 day columns
  [ ] Header row 56px
  [ ] Row height 38px
  [ ] Provider section first
  [ ] Clients section below
  [ ] Week chips height 24px
  [ ] Proposed chip dashed
```

## 28.4 Clients List Pixel Checklist

```txt
Page:
  [ ] Padding 32px 40px
  [ ] Compact sidebar preferred
  [ ] Title 30px
  [ ] Subtitle exact text visible

Filter:
  [ ] Search width 360px
  [ ] Filters height 44px
  [ ] Sort label right aligned

Table:
  [ ] Header row 48px
  [ ] Body rows 68px
  [ ] Olivia Davis selected blue
  [ ] Auth progress bars visible
  [ ] Status badges green
```

## 28.5 Modals Pixel Checklist

```txt
Overlay:
  [ ] Navy dim background
  [ ] Blur applied

Modal:
  [ ] Width 560px
  [ ] Radius 20px
  [ ] Shadow modal
  [ ] Header padding 28px 32px 18px
  [ ] Body padding 0 32px 28px
  [ ] Footer padding 20px 32px
```

---

# 29. Anti-Patterns to Remove From Existing UI

Search the codebase for these patterns and replace where found in redesigned areas.

```txt
- Plain unstyled <table> with browser-looking spacing
- Random gray backgrounds not from tokens
- Blue values not using brand token
- Page-specific hard-coded shadows
- Buttons with inconsistent heights
- Inputs with inconsistent border radius
- Tables with different header typography
- Modals without overlay blur/dim
- Destructive buttons styled like normal links
- Sidebar label/icon spacing that differs per page
- Client/provider schedule cards with different dimensions
- Right sidebar on Schedule Day View
- Any placeholder or incorrect brand names
```

---

# 30. Suggested Refactor Strategy for the IDE Agent

Use this exact sequence to avoid partial redesign.

## Phase 1 — Inventory

```txt
1. Locate current sidebar/app shell.
2. Locate current route/page files:
   - communications/messages
   - schedule day/week
   - clients list/detail
   - providers list/detail
   - new session modal
   - cancel session modal
3. Locate existing CSS/Tailwind/theme files.
4. Locate existing logo assets.
5. Identify where All Together Autism logo should be imported.
```

## Phase 2 — Foundation

```txt
1. Add tokens.
2. Add shared button/input/card/badge/table/modal components if absent.
3. Add or update AppShell and SidebarNav.
4. Confirm app still compiles.
```

## Phase 3 — Lists and Details

```txt
1. Migrate Clients list first because it defines table density.
2. Migrate Client detail.
3. Migrate Providers list.
4. Migrate Provider detail.
5. Confirm shared DataTable is reused.
```

## Phase 4 — Schedule

```txt
1. Create SessionBlock.
2. Replace client/provider session blocks with SessionBlock.
3. Update day toolbar.
4. Update filter panel.
5. Confirm no right sidebar.
6. Implement week view with same schedule shell.
7. Confirm floating dock.
```

## Phase 5 — Communications

```txt
1. Create ThreadCard.
2. Create ConversationPanel.
3. Create MessageBubble.
4. Create MessageComposer.
5. Create AI suggestions panel.
6. Wire existing message data/actions.
```

## Phase 6 — Modals

```txt
1. Create shared Modal primitives.
2. Rebuild New Session modal.
3. Rebuild Cancel Session modal.
4. Verify focus/escape behavior.
```

## Phase 7 — QA

```txt
1. Run app.
2. Visit every redesigned page.
3. Compare against pixel checklist.
4. Search codebase for incorrect branding.
5. Search codebase for old page-specific style leftovers.
6. Fix spacing inconsistencies.
7. Verify responsive behavior at 1366px, 1440px, and 1920px widths.
```

---

# 31. Copy and Label Standards

## 31.1 Brand Copy

Use:

```txt
All Together Autism
```

Avoid:

```txt
ATA unless there is already an established abbreviation in the app.
Any invented brand.
Any old placeholder brand.
```

## 31.2 Navigation Labels

Use exactly:

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

## 31.3 Primary Action Labels

Use sentence/title case consistently:

```txt
+ Add client
+ Add Provider
+ Add session
Book Session
Cancel Session
Keep
Export
Message
Schedule
Edit
```

Note:

```txt
Existing code may use title case for entity actions. Keep local convention, but do not mix within the same page.
```

## 31.4 Status Labels

Use:

```txt
Active
Inactive
Discharged
Scheduled
Proposed
In Progress
Completed
Cancelled
Conflict
Awaiting reply
Coverage needed
```

---

# 32. Final “Do Not Stop Halfway” Criteria

The implementation is incomplete if any of these are true:

```txt
1. Only colors changed but layout remains old.
2. Sidebar changed on some pages but not others.
3. Clients list is modern but Providers list remains old.
4. Schedule day view is modern but week view remains old.
5. Modals still look like old browser forms.
6. Communications lacks the thread list / conversation / AI panel structure.
7. Session blocks have inconsistent heights.
8. Tables have inconsistent row heights.
9. Old brand placeholder appears anywhere.
10. Components were duplicated instead of shared.
11. There are unstyled controls in the redesigned pages.
12. Buttons are visually inconsistent across pages.
13. The IDE agent removed existing business logic while restyling.
```

---

# 33. Handoff Prompt for Claude Code / IDE Agent

Use the following prompt when handing this specification to the implementation agent:

```txt
You are implementing a coordinated UI redesign for the All Together Autism ABA scheduling/practice management application.

Read this entire Markdown file before editing. Treat it as a codebase-level implementation specification, not a design suggestion.

Do not make isolated cosmetic changes. First identify the existing app shell, pages, shared components, and styling system. Then implement the shared design tokens and reusable primitives. Apply the redesign consistently across Communications, Schedule Day View, Schedule Week View, Clients List, Client Detail, Providers List, Provider Detail, New Session modal, and Cancel Session modal.

Do not use or introduce any brand name other than All Together Autism. Use the provided All Together Autism logo. In compact sidebars use the blue connected-loop mark; in expanded sidebars use the full lockup if space allows.

Preserve existing data fetching, business logic, routes, mutations, and scheduling calculations unless markup integration requires minor changes. Do not rewrite backend logic.

Use the exact dimensions, colors, row heights, border widths, border radii, shadows, and component rules in this specification. If an existing component already supports the needed behavior, refactor it to match the new system. If not, create reusable shared components rather than page-specific one-offs.

Implementation is not complete until all acceptance checklists and pixel checklists in this file pass.
```


## 20. Implementation Notes for Claude Code

When applying this specification:

```txt
- First inspect the existing project structure.
- Identify existing shared components before creating new ones.
- Reuse existing business logic and data fetching.
- Do not rewrite scheduling logic unless required for markup integration.
- Do not rename public routes unless needed and safe.
- Preserve existing click handlers and mutations.
- Replace styling and structure carefully.
- Prefer incremental commits/checkpoints by page.
- If exact file names differ, search for page text and component names.
- Keep changes cohesive and token-driven.
```

Suggested implementation sequence:

```txt
Step 1: Add tokens and shared styles.
Step 2: Implement AppShell and SidebarNav with All Together Autism logo.
Step 3: Implement shared UI primitives.
Step 4: Update Clients list and Client detail.
Step 5: Update Providers list and Provider detail.
Step 6: Update Schedule day and week views.
Step 7: Update New Session and Cancel Session modals.
Step 8: Update Communications.
Step 9: Remove obsolete styling and verify QA checklist.
```
