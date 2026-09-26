# YBuy — Design System

**Purpose of this file:** the single source of truth for visual decisions. Every screen and every
generated component gets checked against this — not invented fresh per screen. This is also the
checklist for the design-consistency audit pass.

> Supersedes the earlier "trusted neighbour's tool shed" direction (warm stone / Fraunces). YBuy
> now targets a **premium marketplace** feel — Airbnb-grade browsing, Stripe-grade clarity in
> money and state — with its own ocean-green identity.

## 0. Grounding

Subject: peer-to-peer rental of real, physical objects — drills, tents, cameras, party gear —
between people who live near each other.

Target feeling: a funded marketplace product. Trustworthy, fast, obviously usable. Photography and
price carry the visual interest; the interface gets out of the way. Usability beats decoration
every time.

## 1. Colour

All colour lives in CSS variables applied at `:root` by `theme-context`. **Never write a raw hex
in a component.** The shipped palette is `ocean` (`src/themes.ts`).

| Token | Use |
|---|---|
| `--bg` / `.bg-app` | Page background |
| `--bg-subtle` / `.bg-subtle` | Recessed fills: inputs, tabs, chips, term cards |
| `--bg-card` / `.bg-card` | Card and panel surfaces |
| `--text` / `.text-main` | Primary text |
| `--text-secondary` / `.text-sec` | Body and supporting text |
| `--text-muted` / `.text-muted` | Captions, counts, disabled |
| `--border` / `.border-app` | Default 1px structure |
| `--border-strong` / `.border-strong` | Form controls, dashed drop zones |
| `--accent` / `.bg-accent` | Ocean green `#0E7C66` — primary actions, active state, links |
| `--accent-soft` | Accent-tinted fills, selected states |
| `--success` / `--warning` / `--error` | State only, each with a `-soft` fill |
| `--star` | Rating stars, nothing else |

Neutrals are near-neutral by design: a heavily tinted grey scale reads washed-out at marketplace
density, and it competes with the photography.

**Translucency:** Tailwind cannot derive an alpha variant of a hand-written utility — `bg-card/90`
silently renders nothing. Use `.bg-card-blur` / `.bg-app-blur` for frosted app chrome, and plain
`bg-white/90` for controls that sit on top of a photo.

## 2. Type

- **Display — Plus Jakarta Sans.** All headings (`h1`–`h4` get it automatically), listing titles,
  price figures, section headers, button-sized numbers.
- **Body/UI — Inter.** Body copy, labels, meta, form controls.
- **`.tnum`** on every figure that changes in place: prices, totals, counts, ratings, durations.
  Without it the numbers jitter as the user changes dates.

Scale in use:

| Role | Size |
|---|---|
| Hero display | 34px mobile / 56px desktop, weight 800 |
| Page title (`SectionHeader as="h1"`) | 26px / 32px, weight 700 |
| Section header (h2) | 20px / 24px, weight 700 |
| Card title | 15px, weight 600, clamped to 2 lines |
| Body | 14–16px |
| Meta/caption | 11–13px |
| Price | 17px in cards, 32px on the listing page, weight 700–800 |

Sentence case everywhere. **No ALL-CAPS labels.** No "→" appended to link text (icons are separate
elements).

## 3. Spacing, radius, elevation

- Spacing follows Tailwind's 4px scale. Section rhythm: `pt-12 sm:pt-16` between home sections,
  `mb-5` between a section header and its content, `gap-3 sm:gap-4` inside grids.
- Page width: `max-w-[1400px]` for browse surfaces, `max-w-5xl` for dashboards, `max-w-3xl` for
  single-column flows (checkout, create listing), `max-w-2xl` for reading pages.
- **Radius — four steps only** (`--radius-sm/--radius/--radius-lg/--radius-xl` → `.rounded-card-sm`
  … `.rounded-card-xl`). Pills (`rounded-full`) are reserved for search, chips, toggles and badges.
- **Elevation — four steps only:** `.shadow-xs` (resting cards), `.shadow-card` (search bar, floating
  chrome), `.shadow-hover` (card hover, FAB), `.shadow-pop` (modals, sheets, dropdowns). Borders
  carry structure; shadows only carry depth.

## 4. Components

Everything interactive comes from `src/components/ui.tsx`. Add a variant there rather than
hand-rolling classes in a page.

- `Button` — variants `primary | secondary | ghost | danger | success | inverse | onDark`, sizes
  `sm (36px) | md (44px) | lg (48px)`, with built-in `loading` spinner and `loadingLabel`.
  `inverse` is for accent-filled panels, `onDark` for photography.
- `IconButton` — square, `label` is required and becomes the accessible name.
- `Badge` — `neutral | accent | success | warning | error | inverse`.
- `Alert` — inline, in-context feedback. YBuy deliberately has **no floating toasts**: a message
  belongs next to the thing it describes, and the error can't be missed or auto-dismissed.
- `SectionHeader`, `EmptyState`, `Surface`, `Field`, `Overlay`.
- `fieldClass()` / `textareaClass()` from `components/form-classes.ts` for every input.

Overlays **must** use `Overlay`. The route wrapper animates opacity, which creates a stacking
context; a `fixed` overlay left inside it paints underneath the sticky header and bottom nav.

The listing card (`components/listing-card.tsx`) is the canonical unit and every grid must match it:

```
┌─────────────────────────┐
│  [ photo, 4:3 ]     ♡   │  Instant / Booked badges top-left
├─────────────────────────┤
│ Category • Irving, TX   │  meta, 12px
│ DeWalt 20V Drill Set    │  display, 15px, 2-line clamp
│ ★ 4.8 (23) • Verified   │  or "New listing" — never 0.0
│ $15 /day                │  tabular
└─────────────────────────┘
```

## 5. Motion

Three durations only — `duration-fast` (120ms), `duration-standard` (200ms), `duration-page`
(280ms) — plus the matching `--motion-*` CSS vars for keyframe animations.

| Moment | Treatment |
|---|---|
| Card hover | `.card-hover` lift 3px + `.zoom-media` 1.06 scale on the photo |
| Favourite toggle | `.animate-heart-pop`, on activate only, never on hover |
| Skeleton → content | `.animate-cross-fade` |
| Route change | `.animate-page-fade` |
| Modal / dropdown | `.animate-modal` |
| Mobile sheet | `.animate-sheet` |
| Booking confirmed | `.animate-booking-confirmed` — the one deliberately noticeable beat |

Everything respects `prefers-reduced-motion`. No scroll-triggered reveals.

## 6. Mobile

Mobile is a different layout, not a narrower desktop.

- Compact search that expands on tap; the hero opens expanded.
- Filters are a bottom sheet with a sticky "Show N items" action, not a side drawer.
- Listing, checkout and create-listing get a sticky bottom action bar; the FAB hides on those
  routes so the two never overlap.
- Horizontal rails on home use scroll-snap; the gallery is swipeable.
- Minimum 44px touch targets. `overflow-x: clip` on `html`/`body` — no horizontal scroll, ever.

## 7. Honesty rules

These are design rules, not just data rules:

- Never render a fabricated figure. No reviews yet means "New listing" or "No reviews yet", never
  `0.0`.
- Only claim proximity when the browser actually returned coordinates.
- Empty states say what to do next and link to it.
- Out-of-scope surfaces stay behind `SHOW_OUT_OF_SCOPE_PAGES`.

## 8. Self-audit checklist

Flag and fix on sight:

- [ ] A raw hex, or a spacing/radius/shadow value not in this file
- [ ] `bg-card/NN` or any alpha variant of a custom utility (renders transparent)
- [ ] A `fixed` overlay not wrapped in `Overlay`
- [ ] A hand-rolled button, badge, input or empty state instead of the primitive
- [ ] ALL-CAPS labels, or "→" inside button text
- [ ] A number that changes in place without `.tnum`
- [ ] A placeholder `0.0` rating, or a distance shown without real coordinates
- [ ] A card grid whose image aspect ratio differs from 4:3
- [ ] An icon-only control without an accessible label
