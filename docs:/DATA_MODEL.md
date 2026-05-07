# Data Model — Canonical Reference

This document defines the intended data model. The Prisma schema must reflect this. Any significant deviation should be discussed before implementation.

---

## Core Entities

### Organization
The ABA practice itself. All records are scoped to an Organization to support multiple practices in the future.
- Fields: name, address, NPI number, taxonomy code, timezone

### Staff
A person who works at the practice. May hold one or more roles.
- Fields: name, email, phone, role(s), credentials (BACB certification number, type, expiration), status
- Availability: linked to StaffAvailability records (recurring weekly template)
- Supervision: a BCBA can supervise multiple RBTs; an RBT has one primary supervising BCBA

### Client
The individual receiving therapy.
- Fields: first name, last name, date of birth, address, phone, diagnosis codes, status
- Funding sources: linked to ClientFundingSource (a client may have multiple insurers)
- Assigned staff: linked via StaffClientAssignment junction table

### Guardian
Parent or legal guardian of a client.
- Fields: name, relationship, phone, email, address
- One client can have multiple guardians

### Authorization
Insurance approval to provide services.
- Fields: auth number, funding source, client, service codes covered, approved units, start date, end date, status
- **Do not store remaining units as a field** — compute from Sessions at runtime
- One client may have multiple active auths (different service codes or payers)

### Session
A therapy appointment, scheduled or completed.
- Links: client, primary staff, supervising BCBA (if RBT session), location, authorization
- Fields: scheduled start, scheduled end, actual start, actual end, status, service code, place of service, cancellation reason (if applicable)
- Units are computed from duration at billing time — not stored

### StaffClientAssignment
Junction table linking staff to the clients they are assigned to work with.
- Fields: staff, client, role in assignment, start date, end date
- Active assignments: end date is null or in the future

### StaffAvailability
Recurring weekly availability template for a staff member.
- Fields: staff, day of week, start time, end time, location preference, effective date, expiration date

### AuditLog
A write-only log of data changes for compliance purposes.
- Fields: timestamp, userId, action (CREATE/UPDATE/DELETE), resourceType, resourceId, metadata
- Never updated or deleted — append only

---

## Relationships Summary

```
Organization
  ├── Staff (many)
  │     ├── StaffAvailability (many)
  │     └── StaffClientAssignment (many) ──→ Client
  ├── Client (many)
  │     ├── Guardian (many)
  │     ├── ClientFundingSource (many)
  │     ├── Authorization (many)
  │     │     └── Session (many)
  │     └── StaffClientAssignment (many) ──→ Staff
  └── AuditLog (many)
```

---

## Key Design Decisions

1. **Soft deletes** — use `deletedAt: DateTime?` instead of hard deleting records
2. **Authorization hours are always computed** — sum sessions against the auth, never store a mutable counter
3. **Timezone stored at session level** — the practice may serve clients across locations
4. **Service codes are a reference table** — not a hardcoded enum, so new codes don't require a migration
5. **Supervision ratio is computed** — query BCBA supervision sessions vs RBT direct hours in the same period

---

## Open Design Questions
- Does a session support multiple staff members present simultaneously? (e.g. RBT + observing BCBA)
- How is travel time between sessions modeled for provider efficiency calculations?
- Does the system need to track session note completion status in v1?
