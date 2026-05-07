# ABA Domain Glossary

This glossary defines domain-specific terminology for the ABA scheduling platform. Claude Code must understand these concepts before implementing any feature. When in doubt about a business rule, refer here first.

---

## People & Roles

**Client**
The individual receiving ABA therapy services. Often a child with autism spectrum disorder (ASD) or another developmental disability. Has personal and clinical information that must be kept secure.

**Guardian / Responsible Party**
The parent or legal guardian of a minor client. Primary contact for scheduling, communication, and billing.

**BCBA (Board Certified Behavior Analyst)**
A licensed clinician who designs and oversees treatment plans. Supervises RBTs, conducts assessments, and may deliver direct therapy sessions. Legally responsible for the treatment provided by RBTs on their caseload.

**RBT (Registered Behavior Technician)**
A paraprofessional who delivers direct ABA therapy under BCBA supervision. Cannot work with a client without an assigned supervising BCBA.

**Scheduler / Admin**
Practice staff responsible for building and managing the schedule across all clients and providers.

---

## Clinical Concepts

**Treatment Plan / Behavior Intervention Plan (BIP)**
The clinical document outlining a client's goals, target behaviors, and intervention strategies. Created and owned by the supervising BCBA.

**Assessment**
An evaluation session conducted by a BCBA to determine a client's needs and design their treatment plan. Billed differently from standard treatment sessions.

**Skill Acquisition Target**
A specific skill the client is working to develop (e.g., "requesting preferred items using words").

**Behavior Reduction Target**
A problematic behavior the team is working to decrease (e.g., self-injurious behavior, aggression).

---

## Scheduling Concepts

**Session**
A single therapy appointment. Has: a client, a provider (RBT or BCBA), a location, a start time, an end time, a service code, and a status.

**Direct Hours**
Hours a client spends in face-to-face therapy. The primary billable unit. Insurers authorize a specific number of direct hours per week or month.

**Indirect Hours**
Non-client-facing time such as BCBA supervision meetings, caregiver training, and report writing. Some are billable, some are not.

**Supervision Session**
A required meeting between a BCBA and their RBT(s) to review data and guide treatment. States and insurers mandate a minimum supervision ratio (e.g., 1 hour of supervision per 10 hours of direct RBT therapy). This ratio must be tracked and respected by the scheduler.

**Availability**
The windows of time a client or provider can be scheduled. Distinct from a session — availability is the template, sessions are the instances.

**Cancellation**
A session that did not occur. Must capture reason (client cancellation, provider cancellation, no-show). Insurers often limit the number of billable cancellations.

**Makeup Session**
A session scheduled to compensate for a cancellation.

---

## Insurance & Billing Concepts

**Authorization (Auth)**
An insurance-issued approval to provide a specific number of therapy hours to a specific client over a specific date range. Sessions must stay within active authorizations. Key fields: auth number, service code(s), approved hours, start date, end date, funding source.

**Funding Source**
How a client's services are paid. Common types: private insurance, Medicaid/state-funded, private pay, school district (IEP-funded).

**CPT Code / Service Code**
The billing code for a specific type of service. Common ABA codes:
- `97153` — Adaptive Behavior Treatment by Protocol (RBT-delivered, per 15 min)
- `97155` — Adaptive Behavior Treatment with Protocol Modification (BCBA direct, per 15 min)
- `97156` — Family Adaptive Behavior Treatment Guidance (caregiver training, per 15 min)
- `97158` — Group Adaptive Behavior Treatment (per 15 min)

**Units**
Most ABA billing is in 15-minute increments. A 2-hour session = 8 units. The system must calculate units from session duration.

**Place of Service (POS)**
Where the session occurred. Affects billing. Common codes:
- `03` — School
- `11` — Office / Clinic
- `12` — Home
- `99` — Other / Community

---

## Compliance Concepts

**Supervision Ratio**
The required proportion of BCBA supervision hours to RBT direct therapy hours. Varies by state and payer — must be configurable. The scheduler should surface warnings when a client's RBT hours are at risk of exceeding the supervised ratio.

**State ABA Licensure**
Many states have rules governing ABA practice beyond BACB certification. Key rules affecting scheduling: supervision ratios, session note deadlines, telehealth eligibility, and RBT supervision proximity requirements.

**BACB (Behavior Analyst Certification Board)**
The credentialing body for BCBAs and RBTs. Maintains ongoing certification and supervision requirements.

---

## Status Enums (Canonical)

### Session Status
`SCHEDULED` → `COMPLETED` | `CANCELLED` | `NO_SHOW` | `IN_PROGRESS`

### Authorization Status
`PENDING` | `ACTIVE` | `EXPIRING_SOON` | `EXHAUSTED` | `EXPIRED` | `DENIED`

### Client Status
`INTAKE` | `ACTIVE` | `ON_HOLD` | `DISCHARGED`

### Staff Status
`ACTIVE` | `INACTIVE` | `ON_LEAVE`
