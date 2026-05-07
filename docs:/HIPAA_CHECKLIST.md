# HIPAA Checklist

## The Core Principle
HIPAA compliance in this application means one thing above all else: client data stays inside the system and never reaches unauthorized outside parties. Internal users — management, BCBAs, RBTs, schedulers — are authorized to access the information they need to do their jobs. That access is expected and correct.

The threat model is external leakage, not internal access.

---

## What Client Data Looks Like in This App
- Client name, date of birth, address, phone, email
- Diagnosis codes, treatment information
- Insurance member IDs, authorization numbers
- Session records linked to a named client
- Any combination of data that identifies a specific individual

---

## Infrastructure Checklist (One-Time Setup)
- [ ] Supabase project is in a US region
- [ ] Supabase Business Plan or higher (required to sign a BAA)
- [ ] Supabase BAA (Business Associate Agreement) is signed
- [ ] Vercel BAA is signed
- [ ] Database SSL enforced (`sslmode=require` in connection string)
- [ ] Point-in-time recovery enabled on the database
- [ ] All secrets stored in Vercel encrypted environment variables — never in code

---

## External Leakage Prevention
- [ ] All API routes require an authenticated session — no public endpoints return client data
- [ ] Client data is never passed in URL query parameters
- [ ] Client data is never written to `console.log` or any unencrypted log
- [ ] API error messages are generic — no client data included in error responses
- [ ] No client data stored in localStorage, sessionStorage, or unencrypted cookies
- [ ] All data transmission is HTTPS only
- [ ] Database is not publicly accessible — only reachable through the application layer

---

## Audit Logging
HIPAA requires the ability to track who accessed or modified client data and when. This is for compliance reporting, not for restricting access.
- [ ] Log every client data create, update, and delete with: userId, action, resourceType, resourceId, timestamp
- [ ] Audit logs are retained for a minimum of 6 years
- [ ] Audit logs are write-only — no modification or deletion allowed

---

## Breach Response Readiness
- [ ] AuditLog makes it possible to identify which records a user accessed and when
- [ ] Process defined for notifying affected individuals within 60 days of a confirmed breach
- [ ] Breaches affecting 500+ individuals require HHS notification
