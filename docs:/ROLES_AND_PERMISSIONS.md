# Roles & Permissions

## Philosophy
Roles exist to give each user a clean, relevant experience — not to restrict access to information they legitimately need. Management and therapists should have fluid, unobstructed access to the information required to do their jobs. The only hard rule is that an authenticated session is required to access any client data.

Permissions are a UX and workflow decision, not a compliance requirement.

---

## Role Definitions
These are starting definitions. Exact boundaries are an open design decision to be finalized during development.

| Role | Who They Are | General Access |
|---|---|---|
| `ADMIN` | Practice owner, office manager | Full system access |
| `BCBA` | Supervising clinician | Their caseload, provider schedules, authorizations |
| `RBT` | Direct therapy provider | Their own schedule and assigned clients |
| `SCHEDULER` | Scheduling coordinator | Full scheduling view across all clients and providers |

---

## Open Design Questions
These need product decisions before being implemented:

- Can RBTs see full client details, or just their schedule and session info?
- Can BCBAs see other BCBAs' caseloads for coverage and backup purposes?
- Does the Scheduler role need to create and edit client records, or just manage sessions?
- Is there a read-only reporting role for ownership or management?
- Should role boundaries be configurable per organization?
- Can a staff member hold multiple roles simultaneously?

---

## What Every Authenticated User Can Always Do
Regardless of role, any logged-in user should be able to:
- View their own profile and schedule
- See contact information for colleagues they work with
- Access help and support resources

---

## Authentication Requirement
No client data is accessible without an authenticated session. This is the single non-negotiable access control requirement. Everything beyond that is a product design decision.
