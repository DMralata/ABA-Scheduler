# Design Brief — ABA Scheduling Platform

## Design Inspiration
- **Layout & Structure**: Rippling (rippling.com) — sidebar navigation, data-dense dashboard, structured hierarchy
- **Color Palette**: All Together Autism (alltogetherautism.com) — soft periwinkle/cornflower blue dominant, royal blue accents, light airy feel

The app should feel like a professional workforce management tool that is also warm and approachable — reflecting the ATA brand while having the structural confidence of Rippling.

---

## Visual Identity

### Overall Feel
- Light, airy, and clean — the dominant experience is soft blue and white
- Professional and structured — Rippling-style layout with clear hierarchy
- Warm and approachable — not cold or clinical
- Data-dense but uncluttered — schedulers need to see a lot at once

### Color Palette
Extracted directly from the All Together Autism screenshot and brand.

**Primary — Soft Periwinkle/Cornflower Blue**
- The dominant color across the UI — backgrounds, sidebar, surface tints
- `#C8D8F0` — lightest periwinkle (hero/page background gradient start)
- `#A8C0E8` — soft periwinkle (sidebar background, surface tints)
- `#8BAAD8` — mid periwinkle (sidebar hover states, dividers)
- `#EEF3FC` — near-white blue tint (main content background)
- `#F5F8FF` — off-white with blue cast (card backgrounds, page base)

**Accent — Royal/Cornflower Blue**
- CTAs, active states, links, highlighted text, key interactive elements
- `#4A80D4` — primary accent (CTA buttons, active nav, highlighted words)
- `#3A6BC0` — dark accent (pressed buttons, hover on CTAs)
- `#6A9AE0` — light accent (hover states, focus rings)
- `#EBF1FB` — accent tint (selected rows, subtle highlights)

**Content Surface**
- `#FFFFFF` — card backgrounds, modals, input fields
- `#F5F8FF` — page background (very subtle blue-white)
- `#EEF3FC` — table row alternates, section backgrounds
- `#DDE8F8` — borders, dividers, input outlines

**Text**
- `#1A1F2E` — primary text (dark charcoal, as seen in screenshot — not pure black)
- `#4A5568` — secondary text (muted labels, metadata, body copy)
- `#7A8BA0` — tertiary text (placeholders, disabled, timestamps)
- `#FFFFFF` — text on dark/accent backgrounds (CTA buttons)

**Status Colors**
- Success: `#2E9E6B` (green — completed sessions, active authorizations)
- Warning: `#E8963A` (warm amber — expiring auths, scheduling conflicts)
- Error: `#D94F4F` (red — no-shows, expired auths, critical alerts)
- Info: `#4A80D4` (matches accent blue — informational states)

---

## Typography

**Font Stack**
- Primary: `Inter` (Google Fonts)
- Fallback: `system-ui, -apple-system, sans-serif`

**Scale**
- `text-xs` (12px) — table metadata, timestamps, badges
- `text-sm` (14px) — body text, form labels, table cells (primary size for dense data)
- `text-base` (16px) — standard body, card content
- `text-lg` (18px) — card titles, section headers
- `text-xl` (20px) — page titles
- `text-2xl` (24px) — major headings
- `text-3xl` (30px) — dashboard summary numbers

**Weight Usage**
- `font-normal` (400) — body text, table data
- `font-medium` (500) — labels, nav items, secondary headings
- `font-semibold` (600) — card titles, table headers, active states
- `font-bold` (700) — page titles, key metrics, CTAs

---

## Layout

### Sidebar Navigation (Rippling-style structure, ATA palette)
- Fixed left sidebar
- Background: soft periwinkle (`#A8C0E8`) — light, not dark
- Width: 240px expanded, 64px collapsed
- Logo/brand at top
- Nav items: icon + label, royal blue highlight on active state
- Active item: white background pill or royal blue left border + text
- Bottom section: user profile, settings

### Main Content Area
- Background: `#F5F8FF` — very subtle blue-white, never stark white
- Top bar: page title left, primary actions right
- Content padding: 24px
- Cards on white (`#FFFFFF`) with subtle blue-tinted border (`#DDE8F8`)

### Cards & Surfaces
- White background, `#DDE8F8` border, very soft shadow
- Border radius: `rounded-xl` (12px) for cards — slightly more rounded than Rippling, warmer feel
- `rounded-lg` (8px) for inputs and smaller elements

### Data Tables
- Column headers: `font-semibold`, `text-sm`, `#EEF3FC` background
- Row height: 48px
- Alternating rows using `#F5F8FF`
- Inline status badges for session and authorization status
- Sticky headers on scroll

### Scheduling Calendar
- Week view as primary
- 30-minute time slot increments
- Session blocks: white card with royal blue left border, client + provider name
- Soft periwinkle background for the time grid
- Today column: slightly more saturated blue tint

---

## Component Patterns

### Buttons
- Primary: royal blue (`#4A80D4`) background, white text, `font-semibold`, `rounded-full` (pill shape — matches ATA site)
- Secondary: white background, `#4A80D4` border and text
- Destructive: `#D94F4F` background, white text
- Size: `h-10` (40px) default with generous horizontal padding

### Badges / Status Pills
- Small, `rounded-full`, color-coded
- Always background tint + matching darker text
- Example: active auth = green tint background + green text

### Form Inputs
- White background, `#DDE8F8` border
- Royal blue focus ring
- Label above, helper text below
- Error: red border + red helper text

### Navigation Active State
- White pill background on active item OR royal blue left border
- Icon and label shift to `#4A80D4`

---

## What to Avoid
- Dark navy or black sidebars — keep the sidebar light and airy
- Heavy drop shadows — this palette is light and clean
- Warm/yellow accent colors — the ATA palette is cool blue throughout
- Rounded corners smaller than `rounded-lg` — keep it soft and approachable
- Pure white backgrounds at the page level — always use the subtle blue-white tint

---

## Claude Code Instructions
When building UI components for this project:
1. Always reference this file for color tokens, typography, and component patterns
2. Use Tailwind utility classes — no custom CSS unless absolutely necessary
3. All color values defined as CSS variables in `globals.css`, referenced via `tailwind.config.ts`
4. shadcn components themed to this palette — override default tokens in `globals.css`
5. Optimize for desktop first — schedulers primarily work on desktop
6. Pill-shaped buttons (`rounded-full`) match the ATA brand — use for all primary CTAs
