# Changes — July 15, 2026

## Add-client bug fixes
- **Date-only fields no longer display one day off.** DOB / active / termination / authorization dates are stored as UTC midnight; all date-only formatters now format in UTC (`ClientTable`, client detail page, `AuthorizationsPanel`, dashboard).
- **Enter in the address field no longer submits the form** (`AddressAutocomplete`) — Enter is reserved for picking a Google Places suggestion.
- **Client create/update can no longer crash to a generic error page.** `createClient` / `updateClient` / bulk import wrap DB writes in try/catch; unique-constraint violations (P2002) return the friendly duplicate-ID message, closing the check-then-insert race.
- **Bulk import**: submit button no longer sticks on "Importing…" if the server action throws; top-level errors (auth, >50 rows) are shown instead of silently swallowed; partial successes refresh the client list immediately; location dropdown now includes Hybrid and School.

## Scheduling workflow
- **Availability can be set on the Add Client form.** Day checkboxes + time windows are saved right after creation, so new clients are schedulable without a second trip through Edit.
- **SessionModal warns immediately** when the selected client has no availability windows or no authorization covering the chosen date (the two hard blockers), instead of failing after the form is filled in. Schedule page now loads authorization ranges for this.
- **New validation rule:** sessions cannot be booked before a client's active (intake) date.

## Security / data integrity
- All client mutations (`create`, `update`, `deactivate`, availability, approved-home, preferred slots, bulk import) now call `requireUser()` — matching the session actions.
- A center picker was added to the client form (create + edit); centers set the timezone and drive-time origin used by scheduling.

## Cancellation tracking
- **Expanded reason taxonomy**: Sick, Family emergency, Transportation, Vacation/travel, Provider call-out, Weather, School conflict, Other — plus an optional free-text note stored in session notes (never fragments the reason categories).
- **Rest-of-day cancellations** now store the normalized reason code `REST_OF_DAY`.
- **Client deactivation** stamps bulk-cancelled sessions with `cancelledBy: CLIENT` and reason `CLIENT_DEACTIVATED` instead of leaving them unattributed.
- **No-shows appear as their own series** on the Cancellations chart (amber, next to red cancellations).
- **Cancellation rate**: the breakdown panel shows cancellations + no-shows as a % of all sessions on the books for the period.
- **Rolling 12-month view**: new "12M" range on the Activity chart (month buckets, cross-year labels like "Aug ’25") alongside WTD/MTD/YTD. Data fetch window extended accordingly.

## Reschedule & cancel-modal fixes
- **Drag-reschedule errors now show the actual reason** (availability window, drive-time gap, weekly auth-hours cap, overlap) instead of the generic "Rescheduled session failed validation." — both move and resize handlers on the timeline.
- **"Cancelled by" is always selectable.** Opening the cancel modal from a client or provider row now only pre-selects that party instead of locking the choice.

## Verification notes
- Typechecked against the unmodified baseline: no new errors beyond pre-existing Prisma-stub noise (Prisma engines can't download in the review sandbox).
- Unit tests: 25 pass / 5 fail — the same 5 drive-time ranking tests fail on the *unmodified* codebase (pre-existing).
- Not run against a live DB — please smoke-test add-client, booking, cancel, and dashboard flows before deploying.
