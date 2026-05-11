# Netlify Production Env Vars — Paste-Ready Checklist

For each row: open Netlify → Site settings → Environment variables → Add variable. Set the same Key/Value as below. Copy the actual VALUE from your local `.env.local` (or where noted, regenerate / use the Production Zoom credentials).

---

## Database (Supabase)

| Key | Value source | Production notes |
|---|---|---|
| `DATABASE_URL` | Supabase → Project Settings → Database → **Connection pooling** → Transaction mode → **Connection string (Transaction)** | ⚠️ MUST use the POOLED URL on port `6543` (transaction mode), NOT the direct port `5432`. Serverless cold starts will exhaust direct connection limits. |
| `DIRECT_URL` | Supabase → Project Settings → Database → **Connection string** (direct, port 5432) | Used by Prisma migrations only. Already in `.env.local`. |
| `NEXT_PUBLIC_SUPABASE_URL` | Same as local `.env.local` | Public — safe to expose to client. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same as local `.env.local` | Public — safe to expose to client. |
| `SUPABASE_SERVICE_ROLE_KEY` | Same as local `.env.local` | ⚠️ Server-side only. Never exposed to client. |

## Zoom — Chat App (User-Managed, ZOOM_BOT_*)

You currently have BOTH dev and Production credentials in `.env.local`. **Use the Production values for Netlify.**

| Key | Value to paste in Netlify |
|---|---|
| `ZOOM_BOT_CLIENT_ID` | Value from local `ZOOM_BOT_CLIENT_ID_PRODUCTION` |
| `ZOOM_BOT_CLIENT_SECRET` | Value from local `ZOOM_BOT_CLIENT_SECRET_PRODUCTION` |
| `ZOOM_CHAT_WEBHOOK_SECRET_TOKEN` | Value from local `ZOOM_BOT_SECRET_TOKEN_PRODUCTION` |
| `ZOOM_BOT_JID` | Same as local — bot JID stays the same dev↔prod |

> ⚠️ Local dev keeps using the Development credentials in `.env.local`. Production-only keys live in Netlify.

## Zoom — Phone App (S2S OAuth)

| Key | Value source |
|---|---|
| `ZOOM_ACCOUNT_ID` | Same as local `.env.local` |
| `ZOOM_CLIENT_ID` | Same as local `.env.local` |
| `ZOOM_CLIENT_SECRET` | Same as local `.env.local` |
| `ZOOM_WEBHOOK_SECRET_TOKEN` | Same as local `.env.local` |
| `ZOOM_PHONE_NUMBER` | Same as local `.env.local` |

## Google Maps — SKIP UNTIL APPEAL RETURNS

> Do not set either Maps key in Netlify yet. The GCP project (`master-scheduler-491217`) is currently suspended pending Zoom's ToS appeal review (see `project_maps_compliance_plan.md`). Creating a new key in a different project could be flagged as appeal evasion. Wait for resolution.

When the appeal returns, set BOTH:

| Key | Notes |
|---|---|
| `GOOGLE_MAPS_API_KEY` | Server-side. Drive-time matrix. |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Client-side. Address autocomplete. Best practice: separate key restricted to HTTP referrers. |

Without these set, the deployment still works — drive-time defaults to 0, address autocomplete silently no-ops, the existing "Drive time unavailable" warning surfaces in the UI.

## Anthropic (AI features)

| Key | Value source |
|---|---|
| `ANTHROPIC_API_KEY` | Same as local `.env.local` |

## Practice Branding

| Key | Value source |
|---|---|
| `PRACTICE_NAME` | Same as local — `All Together Autism` |

---

## Optional — Set after deploy

| Key | When to add | Why |
|---|---|---|
| `SENTRY_DSN` | After Task #24 (Sentry setup) | Production error monitoring |
| `NODE_ENV` | Auto-set by Netlify to `production` | Don't set manually |

---

## Pre-flight checklist

Before clicking "Deploy" in Netlify:

- [ ] All keys above set in Netlify env vars panel
- [ ] `DATABASE_URL` uses POOLED port (6543), not direct (5432)
- [ ] Production Zoom credentials used (not dev) for `ZOOM_BOT_*`
- [ ] No env values committed to git (verify: `git ls-files | xargs grep -l "AKIA\|sk_\|secret"` returns nothing — already verified clean)

---

## Local file reminder

When you finish deploying, add `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` to your local `.env.local` so the address autocomplete component works in dev too. It's currently missing locally — autocomplete is silently broken.
