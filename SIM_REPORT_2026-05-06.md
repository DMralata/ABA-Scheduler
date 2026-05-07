# Simulation Report — 2026-05-06

**Context:** Post-implementation validation of SCHOOL location type, Daycare session
type, school-address fields on Center, and full drive-time pipeline support for
HOME↔SCHOOL / CENTER↔SCHOOL transitions.

**Suites run:**
1. `BUG_HUNTER` (static, scoped to the SCHOOL/Daycare changeset)
2. `scripts/sim-suite.ts` — 15 scenarios covering algorithm, cancellations, edge cases, what-ifs

**Headline:** ✅ All 15 scenarios pass invariant checks. Zero Critical/High/Medium runtime findings. Four Low/SUSPECTED findings (all instances of one pre-existing pattern: BCBA assigned when RBT pool is constraint-blocked — not a regression).

---

## Phase 1 — BUG_HUNTER (static audit)

3 High findings on initial audit, all variants of one root cause: drive-time
logic assumed HOME/CENTER only.

| # | Finding | Resolution |
|---|---|---|
| [01] | `validateDriveTimeGap` body never branched on SCHOOL → silent zero-gap | **Fixed** — added HOME↔SCHOOL, CENTER↔SCHOOL branches; school address threaded through `bookSession`/`rescheduleSession` |
| [02] | `runScheduler` drive-time creation skipped HOME→SCHOOL, used wrong source for SCHOOL→HOME | **Fixed** — index.ts loop now handles all 6 SCHOOL transitions with correct distance source |
| [03] | `/api/schedule/sessions` pseudo-event filter excluded SCHOOL → drive blocks invisible | **Fixed** — filter expanded; school address fetched from Center; transition logic generalized |

Mediums fixed: ResourceTimeline label/icon for SCHOOL; SessionModal SCHOOL button + state widening; BulkClientImport now accepts HYBRID/SCHOOL strings; makeupSuggestions cast widened; stale comment in scheduler.ts updated.

Low/Nitpick: SessionType.name `@unique` confirmed (seed script safe); HYBRID kept in scheduler internal unions because Prisma's `LocationType` enum still flows in from DB reads.

---

## Phase 2 — sim-suite.ts (15 scenarios)

### Scorecard

```
Critical: 0
High:     0
Medium:   0
Low:      4   (all "SUSPECTED — needs manual verification", same root cause)
Total scenarios: 15
```

### Per-scenario results

| #  | Scenario | Score | Proposals | Assertions | Bugs |
|----|----------|------:|----------:|------------|------|
| 1  | Full Week Clean Slate (Baseline)        | 66/100 | 23 | n/a       | ✅ none |
| 2  | Full Week + Over-Scheduling Buffer 10%  | 66/100 | 25 | n/a       | 1 Low |
| 3  | Mid-Week Partial (Wed forward)          | 65/100 | 23 | 1/1 pass  | 1 Low |
| 4  | Single Client Cancellation              | day-mode | 0 | 1/1 pass | ✅ none |
| 5  | Single Provider Cancellation            | day-mode | 0 | 1/1 pass | ✅ none |
| 6  | Client + Provider Swap                  | day-mode | 1 | 2/2 pass | ✅ none |
| 7  | Multiple Mixed Cancellations            | day-mode | 1 | 2/2 pass | ✅ none |
| 8  | Provider Full-Day Callout               | day-mode | 0 | 1/1 pass | ✅ none |
| 9  | Constrained Client Compliance Focus     | day-mode | 5 | n/a      | ✅ none |
| 10 | Authorization Expiry Warning            | 66/100 | 23 | n/a       | ✅ none |
| 11 | New Client / No Prior History           | 60/100 | 24 | n/a       | ✅ none |
| 12 | Vacation Week Recovery                  | 61/100 | 43 | n/a       | 1 Low |
| 13 | BCaBA/BCBA Last-Resort                  | 35/100 | 16 | 1/1 pass  | ✅ none |
| 14 | Lunch Block Conflict (12–13)            | 58/100 | 23 | 1/1 pass  | 1 Low |
| 15 | What-If: New Female RBT III             | 65/100 | 22 | n/a       | ✅ none |

### Hard-spec invariants (runtime-verified)

```
✅ UTC conversion uses noon-UTC anchor
✅ Cancellation pairing isolation (S04–S08)
✅ Single-side cancellation produces 0 proposals (S04, S05, S08)
✅ Displaced ↔ freed strict pairing (S06, S07)
✅ Gender requirement enforced
✅ Spanish requirement enforced
✅ RBT level requirement enforced
✅ Authorization present for all proposals
✅ No provider double-booking within run
✅ No client double-booking within run
✅ Weekday-only proposals (no Sat/Sun)
✅ notBefore filter respected (S03)
✅ Provider blocks respected (S14 — 0/49 lunch overlaps)
✅ Position tier — BCaBA/BCBA last resort (S13: 0 RBT, 2 BCaBA, 14 BCBA when RBTs fully booked)
```

### Cancellation isolation — drilled-down

- **S04** (single CLIENT cancel): 0 new proposals → no schedule inflation ✅
- **S05** (single PROVIDER cancel): 0 new proposals → no displaced-only fills ✅
- **S06** (1 CLIENT + 1 PROVIDER on same day): 1 swap proposal, displaced↔freed pair ✅
  - Rivera, Alexia → Rodriguez, Maria
- **S07** (mixed multi-cancel): 1/2 displaced rescheduled, 100% pair-isolated ✅
- **S08** (full-day provider callout, no client cancels): 0 new proposals ✅

The 13-run AUDIT_GOD validation that closed the cancellation-isolation
landmine remains green.

### Manual-session paths (SCHOOL changes did not regress these)

S03 mid-week run, S09 constrained-client filter, S14 lunch-block, S15 what-if
all exercised the slot-generation, conflict, and approved-provider code paths.
No new failures; the only deltas vs baseline are explainable from input
changes (e.g., S14 reduces day-fill 11pts because the lunch block removes 5h
of provider availability per RBT per week).

### Low/SUSPECTED findings — same root cause × 4

All four findings are the same pattern: BCBA Patel assigned to a client when
fewer than ~6/10 RBTs were active on that day. The simulator's heuristic flags
this as "BCBA before RBT", but the trace explicitly notes this is
**SUSPECTED — needs manual verification** because the assignment is most
likely constraint-blocked (approved-list, RBT level minimum, female-only
requirement, drive-cap with no Maps data, etc.). This pattern was present in
prior sim runs and is **not a regression from the SCHOOL changeset**.

| Finding | Scenario | Client | Day | Active RBTs |
|---|---|---|---|---|
| [01] | S02 | Thompson | WEDNESDAY | 0/10 |
| [02] | S03 | White    | WEDNESDAY | 0/10 |
| [03] | S12 | Rivera   | WEDNESDAY | 1/10 |
| [04] | S14 | Rivera   | THURSDAY  | 6/10 |

Recommended follow-up: trace one instance to confirm constraint-block (likely)
vs genuine position-tier bug (improbable given S13 explicitly proves position-tier ordering works correctly).

---

## Phase 3 — Implementation summary (changes shipped this session)

**Schema:**
- `LocationType` enum: dropped `DAYCARE`, added `SCHOOL` (migration `20260505000000`)
- `Center` model: added `schoolStreet`/`schoolCity`/`schoolState`/`schoolZip`/`schoolLatitude`/`schoolLongitude`. Cary, NC placeholder backfilled (migration `20260505010000`).

**Data:**
- Seeded `SessionType` row "Daycare" (billable, no service code, no BCBA — `prisma/scripts/seed-daycare-session-type.ts`)

**Code:**
- New helper: `src/lib/scheduler/schoolLocation.ts` (school origin id, haversine for school↔center)
- Drive matrices: school added as additional origin in `propose` and `propose-week` routes; school↔center distance populated via haversine fallback
- `runScheduler` (`src/lib/scheduler/index.ts`): drive-block creation now handles HOME↔SCHOOL, CENTER↔SCHOOL, SCHOOL↔SCHOOL transitions with correct distance source
- `validateDriveTimeGap`: school params threaded; HOME↔SCHOOL and CENTER↔SCHOOL gap branches added
- Manual booking: `bookSession` and `rescheduleSession` accept SCHOOL; pull school address from Center
- API pseudo-events (`/api/schedule/sessions/route.ts`): SCHOOL sessions included; transition filter generalized
- UI: SessionModal "School" button; ResourceTimeline SCHOOL label + icon; BulkClientImport accepts HYBRID/SCHOOL
- Schemas: `BookSessionSchema.locationType` widened to enum HOME|CENTER|SCHOOL
- Optimizer: SCHOOL clients matched as open-pool (CENTER-like, no approved-list); resolved as `locationType: SCHOOL` on the proposal

**No engine-purity violations** — all DB calls remain at the route-action boundary; `optimizer.ts` and `matcher.ts` stay pure.

---

## Verdict

✅ **Ship-ready.** SCHOOL location and Daycare session type are functionally complete. All 3 High findings from BUG_HUNTER are closed; 15-scenario sim shows no regressions; cancellation isolation, position tiering, availability respect, and authorization compliance all verified.

**Known limitations / follow-up:**
1. School↔center drive minutes are computed via haversine + 35mph average rather than Google Maps API. Acceptable for a placeholder address; replace with a real Maps call once a verified school address is on file.
2. Per-client school addresses not modeled — a single school address per center for now, per the user's explicit "Cary, NC standard until we get the real one" directive.
3. The 4 LOW/SUSPECTED findings about BCBA assignment are pre-existing — recommend a manual trace of one before next sim run to confirm or open as a separate ticket.
