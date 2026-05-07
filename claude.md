# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# CLAUDE.md — ABA Scheduling Platform

## What This Project Is
A web-based scheduling platform for ABA (Applied Behavior Analysis) therapy businesses. The core purpose is to intelligently match ABA clients with providers, respecting the unique constraints of each party, and use logic to find the most efficient scheduling outcomes possible.

This is not a generic calendar app. Scheduling in ABA is complex — clients have funding authorizations, availability windows, location requirements, and provider preferences. Providers have credentials, caseload limits, availability, and supervision relationships. The platform's job is to navigate all of that and surface the best possible schedule.

---

## Dev Commands

```bash
npm run dev        # Start dev server (MUST use --webpack; Turbopack breaks Tailwind v3)
npm run build      # Production build
npm run lint       # ESLint
npm run test       # Vitest unit tests
npm run test:e2e   # Playwright e2e tests

# Database
npm run db:migrate   # Run Prisma migrations (dev)
npm run db:push      # Push schema without migration (prototyping only)
npm run db:generate  # Regenerate Prisma client after schema changes
npm run db:studio    # Open Prisma Studio GUI
```

> **Important:** `next dev --turbopack` breaks the PostCSS/Tailwind pipeline. Always use `npm run dev` (which passes `--webpack`).

---

## Tech Stack
| Layer | Technology | Purpose |
|---|---|---|
| Framework | Next.js 14 (App Router) | Full-stack — frontend and API in one codebase |
| Language | TypeScript (strict mode) | Type safety across the full stack, critical for scheduling logic |
| Database | PostgreSQL via Supabase | Relational data model for clients, providers, sessions, authorizations |
| ORM | Prisma | Type-safe queries and structured migrations |
| Auth | Supabase Auth | Session management and role-based access |
| Styling | Tailwind CSS + shadcn/ui | Utility-first styling with owned, accessible components |
| Deployment | Vercel | Zero-config deploys, preview environments per branch |
| Real-time | Supabase Realtime | Live schedule updates across users |

---

## Architecture Overview

### Frontend + Backend in One
Next.js App Router means there is no separate API server. The codebase is organized as:
- **Server Components** — fetch data directly, keeping data server-side where possible to reduce external exposure
- **Client Components** — interactive UI only, receive pre-fetched data from server components
- **Server Actions** — form submissions and mutations go through server actions, not a REST API
- **API Routes** (`/app/api/`) — reserved for external integrations and the scheduling engine

### The Scheduling Engine
The scheduling optimization logic lives in its own isolated module at `/src/lib/scheduler/`. It is:
- Pure TypeScript — no database calls, no UI dependencies
- Accepts structured input (clients, providers, constraints) and returns proposed schedules
- Independently testable — the most critical logic in the codebase
- Designed to be called from server actions or API routes, never directly from components

### Data Flow
```
User interaction
  → Client Component (UI only)
    → Server Action or API Route
      → Scheduler Engine (if scheduling logic needed)
      → Prisma → PostgreSQL (Supabase)
        → Response back to Server Component
          → Re-render UI
```

---

## Project Structure
```
/
├── CLAUDE.md                        # This file — read at the start of every session
├── agents/                          # Development agents — invoke explicitly when needed
│   ├── DEVILS_ADVOCATE.md
│   ├── SCHEMA_GUARDIAN.md
│   ├── HIPAA_AUDITOR.md
│   └── QA_AGENT.md
├── docs/                            # Reference documentation
│   ├── DOMAIN_GLOSSARY.md           # ABA terminology — read before building any feature
│   ├── DATA_MODEL.md                # Canonical data model
│   ├── ROLES_AND_PERMISSIONS.md
│   ├── HIPAA_CHECKLIST.md
│   └── BUILD_ORDER.md
├── prisma/
│   └── schema.prisma                # Source of truth for the data model
├── src/
│   ├── app/                         # Next.js App Router
│   │   ├── (auth)/                  # Login, signup, password reset
│   │   ├── (dashboard)/             # Main app — protected routes
│   │   │   ├── schedule/            # Scheduling views
│   │   │   ├── clients/             # Client management
│   │   │   └── providers/           # Staff/provider management
│   │   ├── api/                     # API routes (integrations + scheduler engine)
│   │   └── layout.tsx
│   ├── components/
│   │   ├── ui/                      # shadcn primitives — do not modify directly
│   │   ├── schedule/                # Scheduling-specific components
│   │   ├── clients/                 # Client-specific components
│   │   └── providers/               # Provider-specific components
│   ├── lib/
│   │   ├── scheduler/               # Scheduling engine — isolated optimization logic
│   │   │   ├── index.ts             # Public API of the scheduler
│   │   │   ├── matcher.ts           # Client-provider matching logic
│   │   │   ├── constraints.ts       # Constraint definitions and validators
│   │   │   └── optimizer.ts         # Optimization logic
│   │   ├── actions/                 # Server actions — mutations triggered by user interactions
│   │   │   ├── clients.ts           # Create, update, deactivate clients
│   │   │   ├── providers.ts         # Create, update, deactivate providers
│   │   │   └── sessions.ts          # Book, cancel, reschedule sessions
│   │   ├── queries/                 # All database reads — Prisma queries only
│   │   │   ├── clients.ts           # Client lookups and list queries
│   │   │   ├── providers.ts         # Provider lookups, availability queries
│   │   │   └── sessions.ts          # Session lookups, schedule queries
│   │   ├── validations/             # Business rule validation — ABA-specific logic
│   │   │   ├── scheduling.ts        # e.g. does this session exceed authorization limits?
│   │   │   ├── providers.ts         # e.g. is this RBT qualified for this client?
│   │   │   └── authorizations.ts    # e.g. is this auth active and has remaining hours?
│   │   ├── supabase/                # Supabase client setup (server + client)
│   │   ├── prisma.ts                # Prisma client singleton
│   │   ├── schemas/                 # Zod input/form validation schemas
│   │   └── utils/                   # Shared utilities
│   ├── hooks/                       # Custom React hooks (client-side only)
│   └── types/                       # Global TypeScript types and interfaces
└── tests/
    ├── unit/                        # Vitest — especially for scheduler engine
    └── e2e/                         # Playwright — critical user flows
```

---

## Coding Conventions
These exist for consistency across sessions — not to limit design decisions.

### Logic Layer Rules
Each folder in `src/lib/` has a single responsibility. Do not mix concerns across layers:

- **`scheduler/`** — pure optimization logic only. No database calls, no UI, no side effects. Takes structured input, returns proposed schedules.
- **`actions/`** — responds to user interactions. Calls validations first, then queries, then writes to the database. Only invoked from server actions, never directly from components.
- **`queries/`** — all database reads live here. No business logic, just data retrieval. Imported into server components or actions only, never into client components.
- **`validations/`** — ABA business rules. Called by actions before any write. e.g. checking authorization limits, provider qualifications, supervision ratios.
- **`schemas/`** — Zod schemas for form and API input validation. Shared between frontend and backend.
- **`utils/`** — stateless helper functions with no dependencies on other lib modules.

### General
- **TypeScript strict mode is on** — no `any`, no suppressed errors
- **No database calls in components** — data fetching belongs in `queries/` called from server components or actions
- **shadcn components live in `/components/ui/`** — compose them in feature folders, do not modify the primitives
- **One Prisma client instance** — always import from `lib/prisma.ts`, never instantiate directly

---

## Domain Context
ABA (Applied Behavior Analysis) is a therapy model primarily serving individuals with autism and developmental disabilities. Read `docs/DOMAIN_GLOSSARY.md` before building any feature.

**Key people in the system:**
- **Client** — The individual receiving therapy. Has availability, location(s), funding/authorization limits, and assigned providers.
- **BCBA (Board Certified Behavior Analyst)** — Supervising clinician. Designs treatment plans, supervises RBTs, may deliver direct therapy.
- **RBT (Registered Behavior Technician)** — Delivers direct therapy under BCBA supervision.
- **Scheduler / Admin** — Manages the schedule on behalf of the practice.

**Key scheduling concepts:**
- **Authorization** — Insurance approval for a set number of therapy hours within a date range.
- **Session** — A scheduled appointment between a client and provider, at a location, for a defined duration.
- **Availability** — Time windows when a client or provider can be scheduled.
- **Supervision Ratio** — Minimum required BCBA supervision hours relative to RBT direct hours.
- **Location** — Sessions occur at home, clinic, school, or community. Client and provider must share a compatible location.

---

## Theming & Styling Conventions

All color tokens are CSS custom properties in `src/app/globals.css`, referenced via `tailwind.config.ts`. Never hardcode hex values in components — use semantic tokens (`text-foreground`, `bg-surface`, `border-border`, etc.).

**The schedule section uses a warm theme.** The `(dashboard)/layout.tsx` applies `className="schedule-warm"` to the root container. This swaps the default blue-white ATA palette for a warm cream/tan palette scoped to `.schedule-warm {}` in `globals.css`. The rest of the app uses the default blue palette.

**Session type colors** are derived by hashing the session type's UUID in `src/lib/utils.ts → getSessionTypeColor()`. Drive Time is always `DRIVE_TIME_COLOR` (`#64748b`). Never assign colors by session type name — always use the ID hash.

**Key layout component:** `src/components/layout/Sidebar.tsx` is the collapsible nav rail (`w-12` collapsed, `w-60` expanded on hover). The `(dashboard)/layout.tsx` sets `pl-12` on `<main>` to account for the collapsed rail width.

**ScheduleWorkspace** (`src/components/schedule/ScheduleWorkspace.tsx`) is the primary orchestrator for the schedule view. It manages all local state (current date, session draft, cancel target, auto-schedule flow, clear dropdown, makeup notifications) and renders ResourceTimeline (day view), WeekGrid (week view), SessionTypePalette, and all modals.

**Async mutations in client components:** use `useState(false)` + `.then().catch()` — never `useTransition` with async server actions.

**Display timezone is a per-user preference.** The `/settings` page (`src/app/(dashboard)/settings/page.tsx`) lets users pick a timezone, stored in Supabase `user_metadata.timezone` via `updateUserTimezone` in `src/lib/actions/users.ts`. The schedule page reads it and passes it as the `timezone` prop on `ScheduleWorkspace`, falling back to `center.timezone`. **This is display-only** — scheduler internals (`/api/scheduler/propose`, propose-week, audit windows, session storage) still use `center.timezone` for determinism. When adding UI that takes user-entered times, source the timezone from the prop already threaded through ScheduleWorkspace, not from `center.timezone` directly.

---

## HIPAA Approach
HIPAA compliance in this application means keeping client data inside the system and away from unauthorized outside parties. Internal users — management, BCBAs, RBTs, schedulers — are authorized to access the information they need to do their jobs and should have fluid, unobstructed access to it. The security concern is external leakage, not internal access. The one hard rule: no client data is accessible without an authenticated session. See `docs/HIPAA_CHECKLIST.md` and `agents/HIPAA_AUDITOR.md`.

---


Invoke agents explicitly at the right moments — they are not always-on:

- **Devils Advocate** → Before finalizing any design decision or marking a feature complete
- **Schema Guardian** → Before running any database migration
- **HIPAA Auditor** → Before shipping any feature that reads or writes client data — focused on external leakage, not internal access
- **QA Agent** → When defining acceptance criteria for a feature
- **Simulation Agent** → Before running any schedule simulation, cancellation scenario, or what-if analysis — validates parameters and ensures output matches UI behavior

Example: *"Review this using `agents/DEVILS_ADVOCATE.md`"*

---

## Open Questions (To Be Decided)
Do not assume answers to these — surface tradeoffs when they become relevant:

- What is the scheduling optimization approach? (rule-based, constraint solver, AI-assisted, hybrid?)
- What does "efficient" mean as a primary metric — maximizing authorized hours, minimizing provider drive time, balancing caseloads, or all three?
- What does the scheduling UI look like? (drag-and-drop calendar, auto-suggest, form-based?)
- How are conflicts and exceptions handled? (overlaps, cancellations, makeups)
- What external integrations are needed? (billing systems, EMRs, Google Calendar)
- What are the exact role definitions and what can each role see and do?
