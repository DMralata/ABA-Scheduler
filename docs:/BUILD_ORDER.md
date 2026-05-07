# Build Order & Feature Roadmap

## Philosophy
Build the foundation correctly before building features. Auth, the data model, and the core logic layer must be solid before any UI is built on top of them. Rushing the foundation creates compounding problems in a healthcare application.

---

## Phase 0: Foundation ✅ Complete

1. ✅ **Project scaffolding** — Next.js 14, TypeScript strict mode, Tailwind, shadcn/ui, ESLint
2. ✅ **Database setup** — Supabase project, Prisma connected, SSL via `directUrl`
3. ✅ **Auth system** — Supabase Auth with middleware session refresh; unauthenticated users redirected to `/login`
4. ✅ **Prisma schema** — Full entity model: Center, Client, Provider, Authorization, Session, SessionType, ApprovedHome, ClientAvailability, ProviderAvailability, ProviderBlock, AuditLog
5. ✅ **Folder structure** — All `src/lib/` layers in place: actions, queries, validations, scheduler (stub), schemas, utils
6. ✅ **AuditLog infrastructure** — `src/lib/audit.ts` write helper wired into all client, provider, session, and authorization mutations
7. ✅ **Environment config** — `.env.local` with `DATABASE_URL`, `DIRECT_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### Key design decisions locked in Phase 0
- **Authorization** is a first-class entity, not flat fields on Client. Clients can have multiple Authorizations covering different CPT service codes (97153, 97155, etc.).
- **All time/availability calculations are timezone-aware** using `Intl.DateTimeFormat`. Center has a `timezone` field; Session has an optional `timezone` field. All validation passes an IANA timezone string.
- **ApprovedHome uses soft delete** (`endDate` field) — deactivating a client or provider preserves approval history for re-admission.
- **Provider has a `status` field** (ACTIVE / INACTIVE / ON_LEAVE). Deactivation sets INACTIVE; scheduler queries filter to ACTIVE only.
- **SessionType has a `serviceCode` field** (CPT code) — used to match sessions to the correct authorization.

---

## Phase 1: Client & Provider Management

### Logic layer ✅ Complete
All queries, actions, validations, and schemas for clients and providers are built:
- `src/lib/queries/clients.ts` — all client lookups including scheduler-optimized loads
- `src/lib/queries/providers.ts` — all provider lookups; `getActiveProviders()` and `getProvidersForScheduler()` filter to ACTIVE
- `src/lib/actions/clients.ts` — create, update, deactivate, manage approved providers
- `src/lib/actions/providers.ts` — create, update, deactivate, set availability, manage blocks
- `src/lib/schemas/client.ts` and `provider.ts` — Zod input validation
- `src/lib/validations/scheduling.ts` — all 12 session validation rules

### UI layer 🔲 Not started
1. Provider list view — searchable, filterable by position and status
2. Provider profile page — details, availability setup (weekly template), block management
3. Provider create/edit form
4. Client list view — searchable, filterable by status
5. Client profile page — details, approved providers management
6. Client create/edit form

---

## Phase 2: Authorization Management

### Logic layer ✅ Complete
- `src/lib/queries/authorizations.ts` — lookups, active authorization filtering, status computation
- `src/lib/actions/authorizations.ts` — create, update, delete
- `src/lib/schemas/authorization.ts` — Zod input validation

### UI layer 🔲 Not started
1. Authorization list per client — shows active/expiring/exhausted status
2. Authorization create/edit form
3. Remaining hours indicator — computed from sessions, shown per auth
4. Expiring soon alerts — auths within 30 days of end date

---

## Phase 3: Scheduling Engine

### Constraint & validation layer ✅ Complete
All 12 scheduling rules live in `src/lib/validations/scheduling.ts`:
- RBT level, provider availability, provider blocks, client availability, Spanish requirement, female provider requirement, approved provider check, center mismatch warning, double-booking, authorization window, ATI (weekly hours), valid session time

### Cancellation & replacement logic ✅ Complete
- `src/lib/actions/cancellations.ts` — bulk cancel provider or client sessions, auto-find replacement, flag unresolvable sessions for manual attention

### Optimizer 🔲 Not started — requires design decision first

**Open question: optimization approach**
- Rule-based greedy: match clients to available providers in priority order. Fast, predictable, auditable. Can't globally optimize.
- Constraint solver (e.g. OR-Tools, custom backtracking): globally optimal but complex to implement and debug.
- AI-assisted: use an LLM or ML model to propose schedules. Powerful but harder to explain decisions to schedulers.
- Hybrid: rule-based for day-to-day, manual override UI for exceptions. Probably the right v1 approach.

**Open question: what does "efficient" mean?**
- Maximize authorized hours utilized per client per week?
- Minimize provider drive time between sessions?
- Balance caseload evenly across providers?
- All three with configurable weights?

**Decide both questions before implementing `src/lib/scheduler/`.**

Once decided, build:
1. `src/lib/scheduler/index.ts` — public API (takes clients + providers, returns proposed sessions)
2. `src/lib/scheduler/matcher.ts` — client-provider compatibility check (wraps validation rules)
3. `src/lib/scheduler/optimizer.ts` — the core optimization logic

---

## Phase 4: Scheduling UI 🔲 Not started

1. Calendar view — week-primary, switchable by staff or by client
2. Manual session booking form — with inline constraint validation and warnings
3. Auto-suggest panel — scheduler engine surfaces recommended sessions for review
4. Session management — cancel, reschedule, mark complete, mark in-progress
5. Flagged session queue — surface `needsAttention` sessions for manual resolution
6. Conflict and alert surfaces — visual indicators on calendar for authorization issues, supervision gaps

---

## Phase 5: Operations & Compliance 🔲 Not started

1. Supervision ratio tracking — BCBA supervision hours vs. RBT direct hours per client, with alerts when ratio is at risk
2. Authorization expiration alerts — dashboard surface for auths expiring within 30/60 days
3. Utilization reports — hours scheduled vs. authorized per client, per week, per authorization
4. Notification system — email alerts for schedule changes and auth expiry (requires decision on email provider)

---

## Not in Scope for v1
- Billing and claim submission
- Session notes and clinical data collection
- Payroll integration
- Parent/guardian portal
- Telehealth platform integration

These are noted in the data model so the schema can accommodate them later without a redesign.
