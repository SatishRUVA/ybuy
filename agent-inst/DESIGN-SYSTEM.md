# YBuy — Design System

**Purpose of this file:** the single source of truth for visual decisions. Every screen, every
generated component (21st.dev Magic MCP, Copilot, OpenCode) gets checked against this — not
invented fresh per screen. This is also the checklist for the design-consistency audit pass.

## 0. Grounding

Subject: peer-to-peer rental of real, physical objects — drills, tents, cameras, party gear —
between people who live near each other. Audience: everyday people, not businesses. The job of
the design: make a stranger's item feel trustworthy enough to book in under a minute, and make
the *item* — not the platform — the visual interest.

Target feeling: a trusted neighbor's garage or tool shed. Tactile, plain-spoken, considered —
not a fintech dashboard, not a glossy SaaS product, not a marketing site for the platform itself.

## 1. Color

| Name | Hex | Use |
|---|---|---|
| Canvas | `#EDE8DD` | Page background — warm stone paper, greyer than a cream default |
| Chalk | `#FAF8F3` | Card/surface background — sits slightly lighter than Canvas |
| Ink | `#211F1A` | Primary text — warm near-black, never flat `#000`/`#111` |
| Tarp | `#3D4A3C` | Secondary dark — headers, nav, borders, deep-canvas green |
| Brass | `#9C7A3C` | Primary accent — CTAs, active states, price emphasis (worn-hardware tone) |
| Rust | `#A24E3D` | Sparse use only — alerts, cancellations, destructive actions |

Explicitly avoided: warm cream (`#F4F1EA`) + terracotta (`#D97757`) — the current AI-default
pairing. Also avoided: flat near-black backgrounds with a single neon accent, and the identical
soft-grey-shadow SaaS-card look (see §5).

## 2. Type

- **Display/headline — Fraunces.** Listing titles, hero text, section headers. Has warmth and
  character; ties to "handmade/considered" rather than corporate-neutral.
- **Body/UI — Public Sans.** Everything else: body copy, buttons, form labels, nav. Plain,
  legible, utilitarian — deliberately not Inter/Helvetica (the default-default).

Scale (desktop; scale down proportionally for mobile, don't just shrink font-size uniformly —
re-check line length at each step):
| Role | Face | Size/line-height | Weight |
|---|---|---|---|
| Hero display | Fraunces | 40px/1.1 | 500 |
| Section header (H2) | Fraunces | 28px/1.2 | 500 |
| Card/listing title (H3) | Fraunces | 20px/1.3 | 500 |
| Body | Public Sans | 16px/1.5 | 400 |
| Meta/label (distance, category) | Public Sans | 14px/1.4 | 500, sentence case |
| Price | Public Sans, tabular figures | 18–20px | 600 |

Line length under 80 characters for body copy. No ALL-CAPS labels anywhere. No single-word
accent-in-italic headline tricks.

## 3. Layout

- **Listing cards are photography-first**: image fills ~70% of the card height, no drop shadow —
  a 1px `Tarp` border at ~10% opacity instead. Title + price sit left-aligned below the image in
  the scale above. This is the one component every generated screen must match exactly.
- **Left-aligned throughout** — this is a practical, browsable marketplace, not a centered
  marketing page.
- **Home/search grid is asymmetric, not a uniform tile grid**: one larger featured listing,
  others smaller — closer to a classifieds/bulletin-board layout than a repeated SaaS card grid.
- **Border radius**: 6px on interactive elements (buttons, inputs, chips). Photos and cards
  themselves stay at 0–4px — not the same heavy rounding on everything regardless of hierarchy.
- **No decorative gradients, no icon-in-a-circle badges as filler.** If a badge/icon appears, it
  carries real information (verified, favorited) — never decoration.

ASCII sketch of the listing card (the canonical unit, referenced by every screen that shows one):
```
┌─────────────────────────┐
│                         │
│      [ item photo ]     │
│                         │
├─────────────────────────┤
│ DeWalt 20V Drill Set    │  ← Fraunces, 20px
│ $15/day · Euless, TX    │  ← Public Sans, 14px meta
│ ★ 4.8 (23)      ♡       │  ← Public Sans, price/rating tabular
└─────────────────────────┘
```

## 4. Motion

One deliberate moment only: the booking-confirmed transition (a small, quiet checkmark/state
change — not confetti, not a modal takeover). Everything else is instant. No hover-fade on every
card, no scroll-triggered fade-and-slide-up on every section — these are the generic default and
the audit pass should flag them on sight.

## 5. Self-audit checklist (run this against every screen)

Flag and fix any of the following if found — these are the recognizable AI-default tells:
- [ ] Cream background + terracotta/warm-clay accent (`#F4F1EA` / near `#D97757`)
- [ ] Every card sharing one border-radius and the same soft grey `rgba(0,0,0,.1)` shadow
- [ ] ALL-CAPS eyebrow label above a heading
- [ ] A "→" appended to button/link text
- [ ] Meta strings joined with middle dots (`A · B · C`) — use plain separators instead
- [ ] Numbered markers (01/02/03) on content that isn't actually a sequence
- [ ] Hover-fade or slide-up animation applied uniformly to every card/section
- [ ] Any color, type, or spacing value not listed in this file

## 6. Voice (applies to all copy, empty states, errors)

Active voice, plain verbs, sentence case. A button that says "Request to rent" produces a
confirmation that says "Request sent" — same vocabulary through the whole flow, not "Submit" →
"Success!". Errors state what happened and how to fix it, without apologizing or being vague.
Empty states are an invitation to act ("No listings near you yet — be the first to add one"), not
a flat "No results."

## 7. Implementation notes (Tailwind)

Add these as custom colors/fonts in `tailwind.config` rather than using arbitrary hex values
inline anywhere in the app — every component pulls from these tokens, never a one-off value:
```js
colors: {
  canvas: '#EDE8DD',
  chalk:  '#FAF8F3',
  ink:    '#211F1A',
  tarp:   '#3D4A3C',
  brass:  '#9C7A3C',
  rust:   '#A24E3D',
},
fontFamily: {
  display: ['Fraunces', 'serif'],
  body: ['"Public Sans"', 'sans-serif'],
},
```
