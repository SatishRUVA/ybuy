# Theme - design tokens

> The approved redesign direction "The Rental Tag" (Anton + Work Sans; chalk, white, harbor ink, ocean, mint, manila, deep ocean, signal orange) is NOT implemented in code yet. Its tokens live in `.superdesign/design-system.md`. The utility class NAMES below are the stable API the redesign keeps; their VALUES change.

## Part 1 - Compact token summary (current code)

Theme mechanism: `src/themes.ts` defines 10 palettes (`makeTheme`); `src/theme-context.tsx` writes the active palette's CSS variables onto `:root`, sets `data-theme`, toggles `.dark`. `defaultTheme = 'mono'` and `SHOW_DEMO_THEMES = false`, so production is locked to "YBuy Monochrome". `:root` in `src/index.css` mirrors the mono values. "Ocean Green" (accent #0E7C66) exists as a theme but is not active.

### Color (CSS variable -> utility class)
| Token | mono (active) | ocean (defined) | Utility |
|---|---|---|---|
| `--bg` | #F7F7F7 | #F7F8F8 | `bg-app` |
| `--bg-subtle` | #F0F0F0 | #EFF2F1 | `bg-subtle` |
| `--bg-card` | #FFFFFF | #FFFFFF | `bg-card` |
| `--text` | #111111 | #0E1A17 | `text-main` |
| `--text-secondary` | #555555 | #586A65 | `text-sec` |
| `--text-muted` | #696969 | #65706E | `text-muted` |
| `--border` | #E6E6E6 | #E4E8E7 | `border-app` (also default `*` border colour) |
| `--border-strong` | #CCCCCC | #CFD6D4 | `border-strong` |
| `--accent` | #171717 | #0E7C66 | `bg-accent`, `border-accent` |
| `--accent-hover` | #333333 | #0A6553 | `bg-accent-hover` |
| `--accent-soft` | #F0F0F0 | #E3F2ED | `bg-accent-soft` |
| `--accent-text` | #FFFFFF | #FFFFFF | `text-accent-text` |
| `--accent-ink` | color-mix(accent 90%, text) | same | `text-accent` |
| `--success` / `--success-soft` | #1E6B42 / #E2F3EA | #17794F / #E3F3EA | `text-success`, `bg-success`, `bg-success-soft` |
| `--warning` / `--warning-soft` | #C9831E / #FBF0DC | #B4740F / #FBF0DC | `text-warning` (uses --warning-ink), `bg-warning-soft` |
| `--error` / `--error-soft` | #B93A27 / #FCE9E6 | #C13A2F / #FBE8E6 | `text-error`, `bg-error-soft`, `border-error` |
| `--star` | #555555 | #E0A538 | `text-star` |
| `--favorite` | #171717 | (not set) | `text-favorite`, `fill-favorite` |
| `--ink` | #111111 | - | used by `.ink-surface`, nav underline, bid banner |

Special surfaces: `.ink-surface` (black band that re-maps tokens to white text), `.photo-mono` (grayscale photos, colour on hover), `.bid-banner*` (ink live-offer strip), `.owner-listing*` (create-listing skin), `.listing-*` (listing detail layout + booking panel), `.calendar-*` (date dialog).

### Typography
- `--font-sans`: 'DM Sans' 400/500/600/700 (body, controls). `--font-display`: 'Manrope' 600/700/800 (all h1-h4, `letter-spacing: -0.02em`). `.font-editorial`: 'Instrument Serif' 400 (home hero, section titles, marquee, mobile menu). Loaded via Google Fonts `@import` at the top of `src/index.css`.
- Sizes in use: 10-13px meta, 14-15px body/controls, 16-18px card titles, 20-32px section/page headings, home editorial clamp(4rem,10.5vw,10.5rem). Prices use `.tnum` (tabular numerals).

### Radius
`--radius-sm` 0.25rem (`rounded-card-sm`), `--radius` 0.375rem (`rounded-card`), `--radius-lg` 0.5rem (`rounded-card-lg`), `--radius-xl` 0.75rem (`rounded-card-xl`); pills `rounded-full`; literal radii on home cards (`rounded-[1.5rem]`), account menu (`rounded-[1.25rem]`), listing booking panel 16px.

### Shadow
`--shadow-xs` none, `--shadow-card` none, `--shadow-hover` 0 2px 6px rgba(17,17,17,.08), `--shadow-pop` 0 8px 24px rgba(0,0,0,.16) -> `shadow-xs/card/hover/pop`.

### Motion
Tailwind `transitionDuration`: `duration-fast` 120ms, `duration-standard` 200ms, `duration-page` 280ms (mirrored by `--motion-fast/standard/page`). Success motion vars (`--motion-success-*`, `--success-ease` cubic-bezier(0.16,1,0.3,1)). Keyframe utilities: `animate-fade-up`, `animate-fade-in`, `animate-scale-in`, `animate-slide-right`, `animate-cross-fade`, `animate-modal`, `animate-page-fade`, `animate-sheet`, `animate-heart-pop`, `.stagger`. `prefers-reduced-motion` disables animation globally.

### Spacing, layout, breakpoints
Tailwind default 4px spacing scale. Page frame `max-w-[1400px] mx-auto px-4 sm:px-6` (header, home), `max-w-[1280px]` (listing). Breakpoints: Tailwind defaults sm 640, md 768, lg 1024, xl 1280, 2xl 1536 (custom CSS also uses 599/639/641/767px). Touch targets min 44px (`min-h-11`, `h-11 w-11`).

## Part 2 - Raw sources

### tailwind.config.js

- 16 lines

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Motion tokens (see AGENTS.md-adjacent motion pass): reuse these everywhere, never a
      // one-off inline duration. Pair with the existing `ease-out`/`ease-in-out` utilities.
      transitionDuration: {
        fast: '120ms', // micro-feedback: button press, favorite toggle, checkbox
        standard: '200ms', // content swap: skeleton -> real content, tab switch
        page: '280ms', // route/page transitions, modal/sheet open-close
      },
    },
  },
  plugins: [],
};
```

### postcss.config.js

- 6 lines

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

### src/index.css (global CSS: font import, :root tokens, utilities, component CSS)

- 837 lines

```css
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&family=Manrope:wght@600;700;800&display=swap');

@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --bg: #FAF7F2;
  --bg-subtle: #F2EDE4;
  --bg-card: #FFFFFF;
  --text: #0F1F1C;
  --text-secondary: #46554F;
  --text-muted: #5F6C67;
  --border: #E7E1D5;
  --border-strong: #CFC7B6;
  --accent: #0E6B5E;
  --accent-hover: #0A5449;
  --accent-soft: #E1F1EE;
  --accent-text: #FFFFFF;
  --success: #1E6B42;
  --success-soft: #E2F3EA;
  --warning: #C9831E;
  --warning-soft: #FBF0DC;
  --error: #B93A27;
  --error-soft: #FCE9E6;
  --star: #E39B2D;
  --favorite: #D8452F;
  --ink: #0C2A26;
  --highlight: #F5C06B;
  --radius-sm: 0.25rem;
  --radius: 0.375rem;
  --radius-lg: 0.5rem;
  --radius-xl: 0.75rem;
  --shadow-xs: none;
  --shadow-card: none;
  --shadow-hover: 0 2px 6px rgba(17,17,17,0.08);
  --shadow-pop: 0 8px 24px rgba(0,0,0,0.16);
  --font-sans: 'DM Sans', system-ui, -apple-system, sans-serif;
  --font-display: 'Manrope', 'DM Sans', system-ui, sans-serif;
  --accent-ink: color-mix(in srgb, var(--accent) 90%, var(--text));
  --warning-ink: color-mix(in srgb, var(--warning) 60%, var(--text));
  /* Shared interaction and success-motion timing. */
  --motion-fast: 120ms;
  --motion-standard: 200ms;
  --motion-page: 280ms;
  --motion-success-enter: 320ms;
  --motion-success-icon: 400ms;
  --motion-success-check: 300ms;
  --motion-success-halo: 700ms;
  --motion-success-confetti: 1300ms;
  --success-ease: cubic-bezier(0.16, 1, 0.3, 1);
}

* {
  border-color: var(--border);
}

html {
  scroll-behavior: smooth;
  scroll-padding-top: 5rem;
  scroll-padding-bottom: calc(5rem + env(safe-area-inset-bottom));
  overflow-x: clip;
}

body {
  background-color: var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  transition: background-color 0.3s ease, color 0.3s ease;
  overflow-x: clip;
}

/* Display face carries all headings; body face carries everything else. */
h1, h2, h3, h4 {
  font-family: var(--font-display);
  letter-spacing: -0.02em;
  overflow-wrap: anywhere;
}

::selection {
  background: var(--accent);
  color: var(--accent-text);
}

/* Consistent keyboard focus across every interactive element. */
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}

.search-input:focus-visible {
  outline: none;
}

.search-input-shell:focus-within {
  box-shadow: 0 0 0 2px var(--accent);
}

.search-control:focus-within {
  box-shadow: 0 0 0 3px var(--accent), var(--shadow-hover);
}

/* Search is one calm row on desktop and a two-row touch layout on tablet. */
@media (min-width: 640px) {
  .search-control { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(7.5rem, .72fr); gap: .375rem; }
  .search-field-keyword { grid-column: 1 / span 2; grid-row: 1; }
  .search-field-divider { display: none; }
  .search-field-location { grid-column: 3; grid-row: 1; }
  .search-field-radius { grid-column: 1; grid-row: 2; }
  .search-field-dates { grid-column: 2; grid-row: 2; }
  .search-field-submit { grid-column: 3; grid-row: 2; }
  .search-field-radius .search-radius-select { height: 3rem; }
  .search-field-dates > div, .search-field-dates > div > button { width: 100%; }
  .search-field-dates > div > button { justify-content: center; padding-inline: .5rem; }
}
@media (min-width: 1024px) {
  .search-control { grid-template-columns: minmax(10rem, 1.35fr) 1px minmax(10.5rem, 1fr) minmax(8rem, .78fr) minmax(12.5rem, 1.3fr) auto; gap: .25rem; }
  .search-field-keyword { grid-column: 1; grid-row: 1; }
  .search-field-divider { display: block; grid-column: 2; grid-row: 1; justify-self: center; }
  .search-field-location { grid-column: 3; grid-row: 1; }
  .search-field-radius { grid-column: 4; grid-row: 1; }
  .search-field-dates { grid-column: 5; grid-row: 1; }
  .search-field-submit { grid-column: 6; grid-row: 1; }
  .search-field-dates > div > button { justify-content: center; padding-inline: .65rem; }
}
@media (max-width: 639px) {
  .search-input { font-size: 16px; }
}

.calendar-dialog { max-height: min(92dvh, 820px); }
.calendar-dialog-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 44px;
  align-items: center;
  gap: 20px;
  padding: 20px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-card);
}
.calendar-dialog-heading { display: flex; align-items: center; gap: 13px; min-width: 0; }
.calendar-dialog-icon {
  display: grid; place-items: center; flex: 0 0 44px; height: 44px;
  border-radius: 14px; color: var(--accent-ink); background: var(--bg-card);
  box-shadow: var(--shadow-card);
}
.calendar-range-pair {
  display: flex; align-items: center; gap: 10px;
  padding: 5px; border: 1px solid var(--border); border-radius: 14px;
  background: var(--bg-card); box-shadow: var(--shadow-xs);
}
.calendar-range-value {
  display: flex; min-width: 132px; flex-direction: column; justify-content: center;
  gap: 2px; padding: 6px 11px; border-radius: 9px; color: var(--text-muted);
}
.calendar-range-value span { font-size: 10px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; }
.calendar-range-value strong { color: var(--text-secondary); font-size: 13px; font-weight: 600; white-space: nowrap; }
.calendar-range-value.is-selected strong { color: var(--text); }
.calendar-range-arrow { color: var(--text-muted); flex: 0 0 auto; }
.calendar-dialog-presets {
  display: flex; align-items: center; gap: 8px; overflow-x: auto;
  padding: 12px 24px; border-bottom: 1px solid var(--border);
  scrollbar-width: none; -ms-overflow-style: none;
}
.calendar-trigger-kicker {
  display: block; color: var(--text-muted); font-size: 9px; font-weight: 750;
  letter-spacing: .075em; line-height: 1.15; text-transform: uppercase;
}
.calendar-dialog-presets::-webkit-scrollbar { display: none; }
.calendar-preset {
  min-height: 40px; padding: 0 14px; border: 1px solid var(--border); border-radius: 999px;
  background: var(--bg-card); color: var(--text-secondary); font-size: 12px; font-weight: 600;
  white-space: nowrap; transition: background-color var(--motion-fast), color var(--motion-fast), border-color var(--motion-fast);
}
.calendar-preset:hover:not(:disabled) { border-color: var(--border-strong); background: var(--bg-subtle); color: var(--text); }
.calendar-preset.is-active { border-color: var(--accent); background: var(--accent); color: var(--accent-text); }
.calendar-preset:disabled { cursor: not-allowed; opacity: .45; }
.calendar-dialog-body { padding: 14px 24px 20px; }
.calendar-dialog-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 4px; }
.calendar-dialog-toolbar > span { color: var(--text-muted); font-size: 12px; }
.calendar-month-nav { display: grid; width: 40px; height: 40px; place-items: center; border-radius: 999px; color: var(--text-secondary); transition: background-color var(--motion-fast), color var(--motion-fast); }
.calendar-month-nav:hover:not(:disabled) { background: var(--bg-subtle); color: var(--text); }
.calendar-month-nav:disabled { cursor: not-allowed; opacity: .35; }
.calendar-months { display: grid; grid-template-columns: minmax(0, 1fr); gap: 28px; }
.calendar-months > div:nth-child(2) { display: none; }
.calendar-months > div > p { margin-bottom: 12px; font-size: 15px; }
.calendar-months > div .grid.grid-cols-7.gap-0\.5 { gap: 3px; }
.calendar-months > div button[data-date] { font-variant-numeric: tabular-nums; }
.calendar-dialog-footer {
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 18px;
  padding: 14px 24px; border-top: 1px solid var(--border); background: var(--bg-subtle);
  padding-bottom: max(14px, env(safe-area-inset-bottom));
}
.calendar-clear { justify-self: start; color: var(--text-secondary); }
.calendar-clear:hover { color: var(--accent-ink); }
.calendar-footer-summary { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.calendar-footer-summary span { color: var(--text-muted); font-size: 11px; }
.calendar-footer-summary strong { overflow: hidden; color: var(--text); font-size: 14px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.calendar-apply {
  min-height: 48px; padding: 0 24px; border-radius: 12px; background: var(--accent); color: var(--accent-text);
  font-size: 14px; font-weight: 700; box-shadow: var(--shadow-xs); transition: background-color var(--motion-fast), transform var(--motion-fast);
}
.calendar-apply:hover:not(:disabled) { background: var(--accent-hover); }
.calendar-apply:active:not(:disabled) { transform: scale(.98); }
.calendar-apply:disabled { cursor: not-allowed; opacity: .45; }
@media (min-width: 640px) {
  .calendar-dialog { width: min(calc(100vw - 2.5rem), 960px); border-radius: var(--radius-xl); }
}
@media (min-width: 768px) {
  .calendar-months { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 28px; }
  .calendar-months > div:nth-child(2) { display: block; }
}
@media (max-width: 639px) {
  .calendar-dialog { max-height: 92dvh; border-right: 0; border-bottom: 0; border-left: 0; }
  .calendar-dialog-header { grid-template-columns: minmax(0, 1fr) 44px; gap: 12px; padding: 16px 16px 13px; }
  .calendar-close { grid-column: 2; grid-row: 1; }
  .calendar-dialog-heading { gap: 10px; }
  .calendar-dialog-heading h2 { font-size: 18px; }
  .calendar-dialog-heading p { font-size: 12px; }
  .calendar-dialog-icon { flex-basis: 40px; height: 40px; border-radius: 12px; }
  .calendar-range-pair { grid-column: 1 / -1; justify-content: space-between; gap: 5px; }
  .calendar-range-value { min-width: 0; flex: 1 1 0; padding: 5px 8px; }
  .calendar-range-value strong { font-size: 12px; }
  .calendar-dialog-presets { gap: 7px; padding: 9px 16px; }
  .calendar-preset { min-height: 40px; padding-inline: 12px; }
  .calendar-dialog-body { padding: 8px 14px 14px; }
  .calendar-dialog-toolbar > span { font-size: 11px; }
  .calendar-months > div .grid.grid-cols-7.gap-0\.5 { gap: 2px; }
  .calendar-dialog-footer { grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; padding: 10px 16px; padding-bottom: max(12px, env(safe-area-inset-bottom)); }
  .calendar-footer-summary { grid-column: 1; }
  .calendar-footer-summary strong { font-size: 13px; }
  .calendar-clear { grid-column: 1; grid-row: 2; justify-self: start; min-height: 36px; padding-left: 0; font-size: 12px; }
  .calendar-apply { grid-column: 2; grid-row: 1 / span 2; min-height: 46px; padding-inline: 17px; }
}
@media (max-width: 767px) {
  .calendar-months > div button[data-date] { width: 100%; max-width: 48px; justify-self: center; }
}
@media (max-height: 600px) and (min-width: 480px) {
  .calendar-dialog-header { grid-template-columns: minmax(0, 1fr) 44px; gap: 6px 12px; padding: 8px 14px; }
  .calendar-dialog-heading { gap: 9px; }
  .calendar-dialog-heading h2 { font-size: 16px; }
  .calendar-dialog-heading p { margin-top: 0; font-size: 11px; }
  .calendar-dialog-icon { flex-basis: 36px; height: 36px; border-radius: 11px; }
  .calendar-range-pair { grid-column: 1 / -1; gap: 4px; }
  .calendar-range-value { min-width: 0; padding: 4px 8px; }
  .calendar-range-value strong { font-size: 12px; }
  .calendar-close { grid-column: 2; grid-row: 1; }
  .calendar-dialog-presets { gap: 6px; padding-block: 6px; }
  .calendar-preset { min-height: 34px; padding-inline: 11px; }
  .calendar-dialog-body { padding-top: 6px; padding-bottom: 8px; }
  .calendar-dialog-toolbar { position: sticky; top: 0; z-index: 2; padding-block: 4px; background: var(--bg-card); }
  .calendar-months > div > p { position: sticky; top: 48px; z-index: 1; padding-block: 4px; background: var(--bg-card); }
  .calendar-months > div > p { margin-bottom: 6px; }
  .calendar-dialog-footer { padding-top: 8px; padding-bottom: max(8px, env(safe-area-inset-bottom)); }
  .calendar-apply { min-height: 40px; }
}

/* Inverted surface: re-maps the semantic tokens so shared utilities stay legible on black. */
.ink-surface {
  --text: #FFFFFF;
  --text-secondary: #B9CBC6;
  --text-muted: #9FB5AF;
  --border: #24443E;
  --border-strong: #3D6159;
  --bg-subtle: #123832;
  --bg-card: #143B35;
  --accent: #F5C06B;
  --accent-hover: #FFD28A;
  --accent-soft: #1D4640;
  --accent-text: #0C2A26;
  background: var(--ink);
  color: #FFFFFF;
}
/* Photography keeps its natural colour; the class stays as a hook for image treatments. */
.photo-mono { transition: transform var(--motion-standard) ease-out; }

/* Utility classes bound to CSS variables */
@layer utilities {
  .bg-app { background-color: var(--bg); }
  .bg-subtle { background-color: var(--bg-subtle); }
  .bg-card { background-color: var(--bg-card); }
  .text-main { color: var(--text); }
  .text-sec { color: var(--text-secondary); }
  .text-muted { color: var(--text-muted); }
  .border-app { border-color: var(--border); }
  .border-strong { border-color: var(--border-strong); }
  .bg-accent { background-color: var(--accent); }
  .bg-accent-hover { background-color: var(--accent-hover); }
  .bg-accent-soft { background-color: var(--accent-soft); }
  .text-accent { color: var(--accent-ink); }
  .text-accent-hover { color: var(--accent-hover); }
  .text-accent-text { color: var(--accent-text); }
  .border-accent { border-color: var(--accent); }
  .border-error { border-color: var(--error); }
  .accent-accent { accent-color: var(--accent); }
  .divide-app > :not([hidden]) ~ :not([hidden]) { border-color: var(--border); }
  .bg-success { background-color: var(--success); }
  .bg-success-soft { background-color: var(--success-soft); }
  .text-success { color: var(--success); }
  .bg-warning { background-color: var(--warning); }
  .bg-warning-soft { background-color: var(--warning-soft); }
  .text-warning { color: var(--warning-ink); }
  .bg-error { background-color: var(--error); }
  .bg-error-soft { background-color: var(--error-soft); }
  .text-error { color: var(--error); }
  .text-star { color: var(--star); }
  .text-favorite { color: var(--favorite); }
  .fill-favorite { fill: var(--favorite); }
  .shadow-xs { box-shadow: var(--shadow-xs); }
  .shadow-card { box-shadow: var(--shadow-card); }
  .shadow-hover { box-shadow: var(--shadow-hover); }
  .shadow-pop { box-shadow: var(--shadow-pop); }
  .font-display { font-family: var(--font-display); }
  .font-editorial { font-family: 'Instrument Serif', 'Times New Roman', serif; font-weight: 400; }
  /* Tailwind can't derive an alpha variant of a hand-written utility (`bg-card/90` is a no-op),
     so translucent surfaces get their own tokens. Used by sticky bars and app chrome. */
  .bg-card-blur { background-color: color-mix(in srgb, var(--bg-card) 88%, transparent); }
  .bg-app-blur { background-color: color-mix(in srgb, var(--bg) 88%, transparent); }
  .glass-surface,
  .glass-nav { background-color: var(--bg-card); }
  .glass-nav-top,
  .glass-nav-bottom { box-shadow: var(--shadow-xs); }
  .rounded-card { border-radius: var(--radius); }
  .rounded-card-lg { border-radius: var(--radius-lg); }
  .rounded-card-xl { border-radius: var(--radius-xl); }
  .rounded-card-sm { border-radius: var(--radius-sm); }
  /* Prices/counters must not jitter as digits change (duration picker, earnings). */
  .tnum { font-variant-numeric: tabular-nums; font-feature-settings: 'tnum'; }
}

@media (min-width: 768px) {
  html { scroll-padding-bottom: 2rem; }
}

.owner-listing {
  --font-sans: 'DM Sans', system-ui, sans-serif;
  --font-display: 'Manrope', system-ui, sans-serif;
  font-family: var(--font-sans);
  background: color-mix(in srgb, var(--accent-soft) 36%, var(--bg));
}

.owner-listing .owner-listing-panel {
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: none;
}

.owner-listing-shell { transition: max-width 220ms ease-out; }
.owner-listing-toolbar { font-size: 14px; }
.owner-listing-toolbar > div { justify-content: flex-end; }
.owner-listing-toolbar [role='status'] { min-height: 2.75rem; }
.owner-listing .owner-listing-fields { font-size: 15px; }
.owner-listing-fields :is(input:not([type='radio']):not([type='checkbox']), select, textarea) { border-radius: var(--radius-sm); }
.owner-listing-fields textarea { min-height: 8rem; }
.owner-listing-fields #listing-additional-details { min-height: 4.5rem; }
.owner-listing-fields .owner-ai-panel { padding: 16px; background: var(--accent-soft); border-radius: var(--radius-lg); }
.owner-ai-panel .text-accent { color: var(--accent); }
.owner-listing-review { font-size: 14px; }
.owner-listing-review .space-y-5 > :not([hidden]) ~ :not([hidden]) { margin-top: 12px; }
.owner-listing-review .grid.gap-4 { gap: 10px; }
.owner-listing-progress .owner-step-button { font-size: 12px; gap: 8px; }
.owner-listing-progress .owner-step-copy { line-height: 1.3; }
.owner-listing-fields .owner-condition { border-radius: 6px; }
.owner-listing-actions { padding-top: 16px; padding-bottom: max(16px, env(safe-area-inset-bottom)); }
.owner-listing-actions > div { margin-left: auto; }
.owner-listing-fields :is(input:not([type='radio']):not([type='checkbox']), select, textarea) { font-size: 16px; }
.owner-availability-months button { border-radius: 10px; min-height: 44px; }
.owner-rental-grid { display: grid; gap: 24px; }
@media (min-width: 1024px) {
  .owner-rental-grid { grid-template-columns: minmax(0, .8fr) minmax(0, 1.35fr) minmax(0, .85fr); gap: 20px; }
  .owner-rental-grid .text-xs { line-height: 1.5; }
  .owner-rental-grid #listing-offers { border-top: 0; padding-top: 0; }
}

.owner-listing-progress > li:not(:last-child)::after {
  content: '';
  position: absolute;
  top: 1.25rem;
  left: calc(50% + 1rem);
  right: calc(-50% + 1rem);
  height: 1px;
  background: var(--border-strong);
}

.owner-listing-progress > li[data-reached='true']:not(:last-child)::after {
  background: var(--accent);
}

.owner-listing-progress [aria-current='step'] .owner-step-number {
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.owner-step-button { touch-action: manipulation; }
.owner-step-button:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: var(--radius); }
.owner-listing-mobile-step { min-height: 1.5rem; }

@media (max-width: 639px) {
  .owner-listing .owner-listing-panel { border-radius: var(--radius-lg); }
  .owner-listing-progress .owner-step-button { min-height: 3.5rem; padding-inline: 0; }
  .owner-listing-progress .owner-step-number { width: 1.875rem; height: 1.875rem; }
  .owner-listing-progress .owner-step-label { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  .owner-listing-fields { scroll-margin-top: 1rem; }
}

.owner-condition:focus-within {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

.owner-listing input[role='switch'] {
  appearance: none;
  position: relative;
  flex-shrink: 0;
  width: 44px;
  height: 26px;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  background: var(--bg-subtle);
  cursor: pointer;
}

.owner-listing input[role='switch']::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--text-secondary);
}

.owner-listing input[role='switch']:checked {
  background: var(--accent);
  border-color: var(--accent);
}

.owner-listing input[role='switch']:checked::after {
  left: 21px;
  background: var(--accent-text);
}

.owner-listing input[role='switch']:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

@media (prefers-reduced-motion: reduce) {
  .owner-listing-shell { transition: none; }
}

/* Scrollbar */
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: var(--border-strong);
  border-radius: 999px;
  border: 2px solid var(--bg);
}
::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }

/* Animations */
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes scaleIn {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes slideInRight {
  from { opacity: 0; transform: translateX(24px); }
  to { opacity: 1; transform: translateX(0); }
}
@keyframes pulse-soft {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
@keyframes modalIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes pageFade {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes bookingConfirmedBeat {
  0% { opacity: 0; transform: scale(0.9); }
  60% { opacity: 1; transform: scale(1.04); }
  100% { opacity: 1; transform: scale(1); }
}

.animate-fade-up { animation: fadeInUp 0.4s ease-out both; }
.animate-fade-in { animation: fadeIn 0.3s ease-out both; }
.animate-scale-in { animation: scaleIn 0.2s ease-out both; }
.animate-slide-right { animation: slideInRight 0.3s ease-out both; }
.animate-pulse-soft { animation: pulse-soft 2s ease-in-out infinite; }

/* Motion-token-driven animations (see --motion-* vars above) */
.animate-cross-fade { animation: fadeIn ease-out both; animation-duration: var(--motion-standard); }
.animate-modal { animation: modalIn ease-in-out both; animation-duration: var(--motion-page); }
.animate-page-fade { animation: pageFade ease-in-out both; animation-duration: var(--motion-page); }
.animate-booking-confirmed { animation: bookingConfirmedBeat ease-out both; animation-duration: 400ms; }

.success-card, .success-notice {
  animation: successEnter var(--motion-success-enter) var(--success-ease) both;
}
.success-check { animation: successCheck var(--motion-success-icon) var(--success-ease) both; }
.success-checkmark path {
  stroke-dasharray: 32;
  stroke-dashoffset: 0;
  animation: successDraw var(--motion-success-check) ease-out 100ms both;
}
.success-halo { animation: successHalo var(--motion-success-halo) ease-out both; }
.success-content { animation: successEnter var(--motion-success-enter) var(--success-ease) 70ms both; }
.success-indicator-subtle { width: 2rem; height: 2rem; }
.success-indicator-subtle svg { width: 18px; height: 18px; }
.success-indicator-subtle .success-halo { display: none; }
@keyframes successEnter {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes successCheck {
  from { opacity: 0; transform: translateY(4px) scale(0.85); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes successDraw {
  from { stroke-dashoffset: 32; }
  to { stroke-dashoffset: 0; }
}
@keyframes successHalo {
  from { opacity: 0.8; transform: scale(1); }
  to { opacity: 0; transform: scale(1.8); }
}
.success-confetti {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
}
.success-confetti span {
  position: absolute;
  top: 50%;
  left: 50%;
  width: var(--particle-size);
  height: calc(var(--particle-size) * 1.4);
  animation: successConfettiDrift var(--motion-success-confetti) cubic-bezier(0.12, 0.65, 0.25, 1) both;
}
.success-confetti i {
  display: block;
  width: 100%;
  height: 100%;
  background: var(--particle-color);
  border-radius: inherit;
  animation: successConfettiFall var(--motion-success-confetti) linear both;
  animation-delay: inherit;
}
.listing-success-hero {
  border-top: 3px solid var(--accent);
}
.listing-hero-confetti {
  position: fixed;
  pointer-events: none;
  --motion-success-confetti: 2400ms;
}
.listing-achievement {
  animation: successCheck 550ms var(--success-ease) both;
}
@keyframes successConfettiDrift {
  from { transform: translateX(0); }
  to { transform: translateX(var(--burst-x)); }
}
@keyframes successConfettiFall {
  0% { opacity: 0; transform: translateY(0) rotate(0); animation-timing-function: ease-out; }
  10% { opacity: 0.85; }
  38% { transform: translateY(var(--burst-y)) rotate(calc(var(--turn) * 0.38)); animation-timing-function: ease-in; }
  65% { opacity: 0.75; }
  100% { opacity: 0; transform: translateY(var(--fall)) rotate(var(--turn)); }
}
@media (prefers-reduced-motion: reduce) {
  .success-confetti, .success-halo { display: none; }
  .success-card, .success-check, .success-checkmark path, .success-content, .success-notice, .listing-achievement { animation: none; }
}

.stagger > *:nth-child(1) { animation-delay: 0ms; }
.stagger > *:nth-child(2) { animation-delay: 40ms; }
.stagger > *:nth-child(3) { animation-delay: 80ms; }
.stagger > *:nth-child(4) { animation-delay: 120ms; }
.stagger > *:nth-child(5) { animation-delay: 160ms; }
.stagger > *:nth-child(6) { animation-delay: 200ms; }
.stagger > *:nth-child(7) { animation-delay: 240ms; }
.stagger > *:nth-child(8) { animation-delay: 280ms; }

/* Hide scrollbar for horizontal scroll */
.no-scrollbar::-webkit-scrollbar { display: none; }
.no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

/* Leaflet map price markers (search page) */
.ybuy-price-pin {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 46px;
  height: 26px;
  padding: 0 9px;
  border-radius: 999px;
  background: var(--bg-card);
  color: var(--text);
  border: 2px solid color-mix(in srgb, var(--accent) 28%, var(--border-strong) 72%);
  box-shadow: 0 3px 10px rgba(0,0,0,0.14), 0 1px 0 rgba(255,255,255,0.35) inset;
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.01em;
  white-space: nowrap;
  cursor: pointer;
  transition: transform 0.15s ease, background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.ybuy-price-pin:hover,
.ybuy-price-pin.is-selected {
  background: var(--accent);
  color: var(--accent-text);
  border-color: var(--accent);
}

.ybuy-pin-marker {
  background: transparent;
  border: 0;
}

.leaflet-container {
  font-family: var(--font-sans);
}

.leaflet-control-zoom a {
  background: color-mix(in srgb, var(--bg-card) 94%, white 6%) !important;
  color: var(--text) !important;
  border-color: var(--border) !important;
}

.leaflet-control-attribution {
  background: color-mix(in srgb, var(--bg-card) 85%, transparent) !important;
  color: var(--text-secondary) !important;
  border-top-left-radius: var(--radius-sm);
}

/* Card hover transition */
.card-hover {
  transition: box-shadow var(--motion-standard) ease-out, border-color var(--motion-standard) ease-out;
}
.card-hover:hover {
  box-shadow: var(--shadow-card);
  border-color: var(--border-strong);
}

/* Media inside a `group` card: slow, subtle push-in on hover. Paired with card-hover. */
.zoom-media {
  transition: transform var(--motion-standard) ease-out;
}
.group:hover .zoom-media { transform: scale(1.02); }

/* Favorite toggle: one short beat on activate only, never on hover. */
@keyframes heartPop {
  0% { transform: scale(1); }
  45% { transform: scale(1.28); }
  100% { transform: scale(1); }
}
.animate-heart-pop { animation: heartPop 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }

/* Mobile bottom sheet (filters, availability, review). */
@keyframes sheetUp {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}
.animate-sheet { animation: sheetUp ease-out both; animation-duration: var(--motion-page); }

/* Skeleton shimmer - subtle, not eye-catching */
.skeleton {
  background: var(--bg-subtle);
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
  .card-hover:hover { transform: none; }
  .group:hover .zoom-media { transform: none; }
}
.listing-date-range-trigger { display: flex; width: 100%; min-height: 66px; align-items: center; gap: 10px; padding: 11px 12px; text-align: left; border: 1px solid var(--border-strong); border-radius: 12px; background: var(--bg-card); color: var(--text); }
.listing-date-range-trigger:hover, .listing-date-range-trigger.is-open { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.listing-date-range-trigger > svg:first-child { color: var(--accent); flex-shrink: 0; }
.listing-date-range-value { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 4px; }
.listing-date-range-value strong { font-size: 11px; font-weight: 700; white-space: nowrap; }
.listing-date-range-value > span { font-size: 10px; color: var(--text-secondary); }
.listing-calendar-popover.calendar-dialog { width: min(640px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); border-radius: 18px; font-family: 'DM Sans', system-ui, sans-serif; }
.listing-calendar-popover .calendar-dialog-header { grid-template-columns: minmax(0, 1fr) 44px; padding: 16px 18px 10px; background: var(--bg-card); }
.listing-calendar-popover .calendar-dialog-icon, .listing-calendar-popover .calendar-range-pair { display: none; }
.listing-calendar-popover .calendar-dialog-heading h2 { font-size: 16px; }
.listing-calendar-popover .calendar-dialog-heading p { font-size: 12px; }
.listing-calendar-popover .calendar-dialog-body { padding: 10px 18px 16px; }
.listing-calendar-popover .calendar-months { gap: 20px; }
.listing-calendar-popover .calendar-dialog-footer { padding: 12px 18px; gap: 10px; }
.listing-calendar-popover .calendar-footer-summary strong { font-size: 12px; }
.listing-calendar-popover .calendar-apply { padding-inline: 16px; font-size: 12px; }
@media (min-width: 641px) {
  .listing-calendar-popover .calendar-months { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .listing-calendar-popover .calendar-months > div:nth-child(2) { display: block; }
}
@media (max-width: 640px) {
  .listing-calendar-popover.calendar-dialog { position: relative !important; top: auto !important; left: auto !important; }
  .listing-calendar-popover .calendar-footer-summary { display: none; }
  .listing-calendar-popover .calendar-dialog-footer { grid-template-columns: 1fr auto; }
  .listing-date-range-trigger { gap: 6px; padding-inline: 8px; }
  .listing-date-range-value strong { font-size: 10px; }
}
.listing-detail { --font-sans: 'DM Sans', system-ui, sans-serif; --font-display: 'Manrope', system-ui, sans-serif; font-family: var(--font-sans); padding-bottom: calc(11rem + env(safe-area-inset-bottom)); }
html:has(.listing-detail) { scroll-padding-bottom: calc(11rem + env(safe-area-inset-bottom)); }
.listing-detail-grid { display: grid; gap: 20px; grid-template-areas: "heading" "gallery" "booking" "details"; }
.listing-heading { grid-area: heading; }
.listing-gallery { grid-area: gallery; }
.listing-details { grid-area: details; }
.listing-booking { grid-area: booking; }
.listing-booking-panel { scroll-margin-top: 6rem; border-radius: 16px; }
.listing-text-action { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 44px; padding: 0 6px; font-size: 12px; font-weight: 600; color: var(--text); border-radius: var(--radius-sm); }
.listing-text-action:hover { background: var(--bg-subtle); }
.listing-rental-estimate { padding: 16px; border: 1px solid var(--border); border-radius: 11px; background: var(--bg-subtle); }
.listing-deposit-box { padding: 16px; border: 1px solid var(--border); border-radius: 11px; background: var(--accent-soft); }
.listing-owner-card { padding: 20px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg-card); }
.listing-section-nav { display: flex; gap: 4px; overflow-x: auto; border-bottom: 1px solid var(--border); }
.listing-section-nav a { display: flex; align-items: center; min-height: 48px; padding: 10px 14px; white-space: nowrap; font-size: 12px; font-weight: 600; color: var(--text-secondary); border-bottom: 2px solid transparent; }
.listing-section-nav a:hover, .listing-section-nav a:focus-visible { color: var(--accent); border-bottom-color: var(--accent); }
.listing-trust-strip { padding-bottom: 16px; border-bottom: 1px solid var(--border); }
.listing-booking-bar { box-shadow: 0 -4px 20px rgba(17,17,17,0.04); }
.listing-detail :is(button, a, input) { scroll-margin-block: 7rem 12rem; }
.listing-image-gallery { display: grid; gap: 10px; }
.listing-image-main { aspect-ratio: 4 / 3; }
.listing-image-thumbnails { display: flex; flex-wrap: wrap; gap: 8px; }
.listing-image-thumbnail { width: 64px; height: 52px; }
@media (min-width: 768px) {
  .listing-detail { padding-bottom: 7rem; }
  .listing-image-gallery:has(.listing-image-thumbnails) { grid-template-columns: 76px minmax(0, 1fr); align-items: start; }
  .listing-image-main { aspect-ratio: 1.65; }
  .listing-image-gallery:has(.listing-image-thumbnails) .listing-image-main { grid-column: 2; grid-row: 1; }
  .listing-image-thumbnails { display: grid; grid-column: 1; grid-row: 1; max-height: 360px; overflow-y: auto; }
  .listing-image-thumbnail { width: 76px; height: 64px; }
}
@media (min-width: 1024px) {
  .listing-detail { padding-bottom: 3rem; }
  .listing-detail-grid { grid-template-columns: minmax(0, 1fr) minmax(340px, 390px); grid-template-rows: auto auto 1fr; grid-template-areas: "heading booking" "gallery booking" "details booking"; gap: 20px 32px; align-items: start; }
  .listing-booking { height: 100%; }
  .listing-booking-sticky { position: sticky; top: 88px; }
  .listing-image-main { aspect-ratio: 1.65; }
}
@media (min-width: 1024px) and (max-height: 740px) {
  .listing-booking-sticky { position: static; }
}
.bid-banner {
  --bid-ink: #FFFFFF;
  --bid-green: #FFFFFF;
  --bid-muted: rgba(255,255,255,.68);
  position: relative;
  isolation: isolate;
  margin: 0;
  width: 100%;
  color: var(--bid-ink);
  background: var(--ink);
  border: 0;
  box-shadow: none;
  overflow: hidden;
  color-scheme: dark;
}
.bid-banner-inner { display: flex; align-items: center; gap: 16px; height: 72px; padding: 8px 56px 8px 16px; }
.bid-banner-inner[hidden] { display: none; }
.bid-banner-error { flex: 1; min-width: 0; max-height: 100%; overflow-y: auto; }
.bid-banner-sleeve { position: absolute; inset: 0 0 auto auto; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; width: 44px; height: 72px; border-left: 1px solid rgba(255,255,255,.16); background: var(--ink); color: #fff; font-size: 10px; font-weight: 700; }
.bid-banner-sleeve:hover { background: #17403A; }
.bid-banner-sleeve:focus-visible { outline: 2px solid var(--bid-green); outline-offset: -4px; }
.bid-banner-collapsed { height: 0; overflow: visible; z-index: 20; background: transparent; box-shadow: none; }
.bid-banner-motion { display: grid; place-items: center; flex-shrink: 0; width: 24px; height: 26px; border-radius: 4px; color: var(--bid-green); }
.bid-banner-motion:focus-visible { outline: 2px solid var(--bid-green); outline-offset: -2px; }
.bid-banner-collapsed::before, .bid-banner-collapsed::after { display: none; }
.bid-banner-collapsed .bid-banner-sleeve { inset: 0 auto auto 0; flex-direction: row; gap: 8px; width: auto; height: 44px; padding: 0 24px 0 16px; border: 0; border-radius: 0 0 16px 0; font-size: 11px; }
.bid-banner-heading { position: relative; flex: 0 0 190px; min-width: 0; padding-inline: 0 8px; }
.bid-banner-heading h2 { font-family: 'Instrument Serif', serif; font-weight: 400; font-size: 24px; line-height: 1; letter-spacing: -.01em; color: var(--bid-ink); }
.bid-banner-live { display: flex; align-items: center; gap: 8px; min-height: 20px; font-size: 11px; font-weight: 700; letter-spacing: .02em; color: var(--bid-green); white-space: nowrap; animation: bid-live-glow 2.6s ease-in-out infinite; }
.bid-banner-live > span { width: 8px; height: 8px; flex-shrink: 0; border-radius: 50%; background: var(--bid-green); animation: bid-heartbeat 1.6s ease-in-out infinite; }
.bid-banner-subtitle { display: none; }
.bid-banner-demo { display: inline-block; margin-top: 3px; padding: 2px 9px; border-radius: 999px; color: var(--ink); background: #fff; font-size: 9px; font-weight: 700; letter-spacing: .04em; }
.bid-banner-viewport { flex: 1; min-width: 0; overflow: hidden; border-radius: 16px; scrollbar-width: none; }
.bid-banner-viewport::-webkit-scrollbar { display: none; }
.bid-banner-track { display: flex; width: max-content; min-width: 200%; animation: bid-news-scroll 48s linear infinite; }
.bid-banner-group { display: flex; flex: 1 0 auto; align-items: center; gap: 10px; padding-right: 10px; }
.bid-banner-item { flex: 0 0 310px; min-width: 0; }
.bid-card { position: relative; display: grid; grid-template-columns: 40px minmax(0, 1fr); grid-template-rows: 22px 14px; align-items: center; gap: 0 12px; height: 56px; padding: 8px 14px 8px 8px; border: 0; border-radius: 16px; background: rgba(255,255,255,.1); color: var(--bid-ink); transition: background-color var(--motion-standard), transform var(--motion-standard); }
a.bid-card:hover { background: rgba(255,255,255,.18); transform: translateY(-1px); }
.bid-card:focus-visible, .bid-banner-viewport:focus-visible, .bid-banner-live:focus-visible { outline: 2px solid #fff; outline-offset: -3px; }
.bid-card-rank { display: none; }
.bid-card-badge { grid-area: 2 / 2; justify-self: start; display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 0; border-radius: 0; font-size: 10px; line-height: 14px; font-weight: 600; color: var(--bid-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bid-card-badge svg { width: 10px; height: 10px; flex-shrink: 0; }
.bid-card-badge-hot, .bid-card-badge-popular, .bid-card-badge-deal { color: var(--bid-muted); background: transparent; }
.bid-card-image { grid-area: 1 / 1 / 3 / 2; display: grid; place-items: center; width: 40px; height: 40px; background: rgba(255,255,255,.14); color: #fff; border-radius: 12px; overflow: hidden; }
.bid-card-image img { width: 100%; height: 100%; object-fit: cover; filter: grayscale(1); }
.bid-card-content { grid-area: 1 / 2; display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; overflow: hidden; }
.bid-card-title { display: block; flex: 1; min-width: 0; font-size: 13px; font-weight: 600; line-height: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bid-card-dates { display: none; }
.bid-card-price { display: block; flex-shrink: 0; padding: 1px 9px; border-radius: 999px; background: var(--highlight); font-size: 12px; font-weight: 700; line-height: 18px; font-variant-numeric: tabular-nums; color: var(--ink); white-space: nowrap; }
.bid-card-price > span { font-size: 10px; font-weight: 600; color: rgba(12,42,38,.72); }
.bid-banner-message { color: var(--bid-muted); font-size: 13px; }
@keyframes bid-news-scroll { to { transform: translateX(-50%); } }
@keyframes bid-live-glow { 50% { opacity: .7; } }
@keyframes bid-heartbeat { 50% { transform: scale(1.5); opacity: .6; } }
.bid-banner-stopped .bid-banner-track, .bid-banner-viewport:focus-within .bid-banner-track { animation: none; transform: none; min-width: 0; width: max-content; }
.bid-banner-stopped .bid-banner-copy, .bid-banner-viewport:focus-within .bid-banner-copy { display: none; }
.bid-banner-stopped .bid-banner-viewport, .bid-banner-viewport:focus-within { overflow-x: auto; }
.bid-banner-stopped .bid-banner-inner .bid-banner-live, .bid-banner-stopped .bid-banner-inner .bid-banner-live > span { animation: none; }
@media (max-width: 599px) {
  .bid-banner-inner { padding-inline: 12px 52px; gap: 10px; }
  .bid-banner-heading { flex-basis: 104px; padding-inline: 0 4px; }
  .bid-banner-heading::after { display: none; }
  .bid-banner-live { font-size: 10px; gap: 6px; }
  .bid-banner-heading h2 { font-size: 20px; }
  .bid-banner-item { flex-basis: 260px; }
}
@media (prefers-reduced-motion: reduce) {
  .bid-banner .bid-banner-track { animation: none; transform: none; min-width: 0; width: max-content; }
  .bid-banner .bid-banner-copy { display: none; }
  .bid-banner .bid-banner-viewport { overflow-x: auto; }
  .bid-banner .bid-banner-live, .bid-banner .bid-banner-live > span { animation: none; }
}
```

### src/themes.ts (palettes)

- 335 lines

```ts
export type ThemeId =
  | 'coral'
  | 'forest'
  | 'ocean'
  | 'slate'
  | 'sunset'
  | 'ybuy'
  | 'sand'
  | 'berry'
  | 'midnight'
  | 'aurora';

export interface Theme {
  id: ThemeId;
  name: string;
  dark: boolean;
  /** short tagline shown in the switcher */
  tagline: string;
  /** CSS variable values applied to :root */
  vars: Record<string, string>;
}

const baseVars = {
  '--radius-sm': '0.25rem',
  '--radius': '0.375rem',
  '--radius-lg': '0.5rem',
  '--radius-xl': '0.75rem',
  '--shadow-xs': 'none',
  '--shadow-card': 'none',
  '--shadow-hover': '0 2px 6px rgba(17,17,17,0.08)',
  '--shadow-pop': '0 8px 24px rgba(0,0,0,0.16)',
  '--font-sans': "'DM Sans', system-ui, -apple-system, sans-serif",
  '--font-display': "'Manrope', 'DM Sans', system-ui, sans-serif",
};

function makeTheme(
  id: ThemeId,
  name: string,
  tagline: string,
  dark: boolean,
  colors: Record<string, string>,
  fonts?: Partial<Record<'--font-sans' | '--font-display', string>>,
): Theme {
  return {
    id,
    name,
    tagline,
    dark,
    vars: { ...baseVars, ...colors, ...(fonts ?? {}) },
  };
}

export const themes: Theme[] = [
  makeTheme(
    'coral',
    'Coral Market',
    'Warm white + coral, Airbnb-inspired',
    false,
    {
      '--bg': '#FAFAF8',
      '--bg-subtle': '#F4F2EE',
      '--bg-card': '#FFFFFF',
      '--text': '#171717',
      '--text-secondary': '#6B6B6B',
      '--text-muted': '#6E6E6C',
      '--border': '#E7E5E2',
      '--border-strong': '#D4D1CC',
      '--accent': '#E0533D',
      '--accent-hover': '#C8442F',
      '--accent-soft': '#FCEDEA',
      '--accent-text': '#FFFFFF',
      '--success': '#3F8F5C',
      '--success-soft': '#E8F5EC',
      '--warning': '#C9831E',
      '--warning-soft': '#FBF0DC',
      '--error': '#D14430',
      '--error-soft': '#FCE9E6',
      '--star': '#E8A53A',
    },
  ),
  makeTheme(
    'forest',
    'Forest',
    'Cream + deep green, earthy marketplace',
    false,
    {
      '--bg': '#F6F5F0',
      '--bg-subtle': '#EDEAE2',
      '--bg-card': '#FFFFFF',
      '--text': '#1A1F1B',
      '--text-secondary': '#5C6B5F',
      '--text-muted': '#626B65',
      '--border': '#E0DCD3',
      '--border-strong': '#CFC9BD',
      '--accent': '#2D6A4F',
      '--accent-hover': '#245540',
      '--accent-soft': '#E2EFE7',
      '--accent-text': '#FFFFFF',
      '--success': '#3F8F5C',
      '--success-soft': '#E8F5EC',
      '--warning': '#C9831E',
      '--warning-soft': '#FBF0DC',
      '--error': '#B14A3A',
      '--error-soft': '#F8E8E4',
      '--star': '#D9A441',
    },
  ),
  makeTheme(
    'ocean',
    'Ocean Green',
    'Cool white + ocean green, clean and crisp',
    false,
    {
      // Neutrals stay near-neutral (only a trace of green) so photography and the accent carry
      // the colour; a heavily tinted grey scale reads washed-out at marketplace density.
      '--bg': '#F7F8F8',
      '--bg-subtle': '#EFF2F1',
      '--bg-card': '#FFFFFF',
      '--text': '#0E1A17',
      '--text-secondary': '#586A65',
      '--text-muted': '#65706E',
      '--border': '#E4E8E7',
      '--border-strong': '#CFD6D4',
      '--accent': '#0E7C66',
      '--accent-hover': '#0A6553',
      '--accent-soft': '#E3F2ED',
      '--accent-text': '#FFFFFF',
      '--success': '#17794F',
      '--success-soft': '#E3F3EA',
      '--warning': '#B4740F',
      '--warning-soft': '#FBF0DC',
      '--error': '#C13A2F',
      '--error-soft': '#FBE8E6',
      '--star': '#E0A538',
    },
  ),
  makeTheme(
    'slate',
    'Slate',
    'Gray + indigo accent, dense utility',
    false,
    {
      '--bg': '#F4F5F7',
      '--bg-subtle': '#E9EBEE',
      '--bg-card': '#FFFFFF',
      '--text': '#1B1F23',
      '--text-secondary': '#596069',
      '--text-muted': '#656A72',
      '--border': '#DFE2E6',
      '--border-strong': '#C7CCD3',
      '--accent': '#3D5AFE',
      '--accent-hover': '#2E49D6',
      '--accent-soft': '#E8EDFE',
      '--accent-text': '#FFFFFF',
      '--success': '#2E8B57',
      '--success-soft': '#E2F3EA',
      '--warning': '#C9831E',
      '--warning-soft': '#FBF0DC',
      '--error': '#D14430',
      '--error-soft': '#FCE9E6',
      '--star': '#E8A53A',
    },
  ),
  makeTheme(
    'sunset',
    'Sunset',
    'Peach + amber, warm and friendly',
    false,
    {
      '--bg': '#FDF8F4',
      '--bg-subtle': '#F7EDE3',
      '--bg-card': '#FFFFFF',
      '--text': '#2A1E16',
      '--text-secondary': '#6E5A4E',
      '--text-muted': '#786960',
      '--border': '#EDE0D4',
      '--border-strong': '#DAC9B8',
      '--accent': '#E07A2C',
      '--accent-hover': '#C26820',
      '--accent-soft': '#FBE6D4',
      '--accent-text': '#FFFFFF',
      '--success': '#3F8F5C',
      '--success-soft': '#E8F5EC',
      '--warning': '#C9831E',
      '--warning-soft': '#FBF0DC',
      '--error': '#C8453A',
      '--error-soft': '#FBE7E5',
      '--star': '#E8A53A',
    },
  ),
  makeTheme(
    'ybuy',
    'YBuy',
    'Pine teal and apricot on warm paper',
    false,
    {
      '--bg': '#FAF7F2',
      '--bg-subtle': '#F2EDE4',
      '--bg-card': '#FFFFFF',
      '--text': '#0F1F1C',
      '--text-secondary': '#46554F',
      '--text-muted': '#5F6C67',
      '--border': '#E7E1D5',
      '--border-strong': '#CFC7B6',
      '--accent': '#0E6B5E',
      '--accent-hover': '#0A5449',
      '--accent-soft': '#E1F1EE',
      '--accent-text': '#FFFFFF',
      '--success': '#1E6B42',
      '--success-soft': '#E2F3EA',
      '--warning': '#C9831E',
      '--warning-soft': '#FBF0DC',
      '--error': '#B93A27',
      '--error-soft': '#FCE9E6',
      '--star': '#E39B2D',
      '--favorite': '#D8452F',
      '--shadow-hover': '0 6px 18px rgba(15,31,28,0.10)',
    },
  ),
  makeTheme(
    'sand',
    'Sand',
    'Beige + terracotta, desert calm',
    false,
    {
      '--bg': '#F5F0E8',
      '--bg-subtle': '#ECE4D6',
      '--bg-card': '#FBF8F2',
      '--text': '#2B211A',
      '--text-secondary': '#6B5D4F',
      '--text-muted': '#6E6459',
      '--border': '#E0D5C5',
      '--border-strong': '#C9BBA7',
      '--accent': '#A8542A',
      '--accent-hover': '#8E4622',
      '--accent-soft': '#F0E0D2',
      '--accent-text': '#FFFFFF',
      '--success': '#3F8F5C',
      '--success-soft': '#E8F5EC',
      '--warning': '#C9831E',
      '--warning-soft': '#FBF0DC',
      '--error': '#B14A3A',
      '--error-soft': '#F8E8E4',
      '--star': '#D9A441',
    },
  ),
  makeTheme(
    'berry',
    'Berry',
    'Soft white + raspberry, playful',
    false,
    {
      '--bg': '#FBF7F8',
      '--bg-subtle': '#F3E9EC',
      '--bg-card': '#FFFFFF',
      '--text': '#231419',
      '--text-secondary': '#6B5560',
      '--text-muted': '#75666C',
      '--border': '#EBDEE2',
      '--border-strong': '#D6C2C9',
      '--accent': '#C2185B',
      '--accent-hover': '#A0124A',
      '--accent-soft': '#F8E0EA',
      '--accent-text': '#FFFFFF',
      '--success': '#3F8F5C',
      '--success-soft': '#E8F5EC',
      '--warning': '#C9831E',
      '--warning-soft': '#FBF0DC',
      '--error': '#C8453A',
      '--error-soft': '#FBE7E5',
      '--star': '#E8A53A',
    },
  ),
  makeTheme(
    'midnight',
    'Midnight',
    'Charcoal + electric cyan, dark premium',
    true,
    {
      '--bg': '#0E1116',
      '--bg-subtle': '#161A21',
      '--bg-card': '#1A1F28',
      '--text': '#F2F4F8',
      '--text-secondary': '#9CA4B0',
      '--text-muted': '#818793',
      '--border': '#262C36',
      '--border-strong': '#363D49',
      '--accent': '#22D3EE',
      '--accent-hover': '#06B6D4',
      '--accent-soft': '#133140',
      '--accent-text': '#06141A',
      '--success': '#34D399',
      '--success-soft': '#0E2E25',
      '--warning': '#FBBF24',
      '--warning-soft': '#332A14',
      '--error': '#F87171',
      '--error-soft': '#3A1A1C',
      '--star': '#FBBF24',
      '--shadow-card': '0 1px 3px rgba(0,0,0,0.3), 0 8px 24px rgba(0,0,0,0.3)',
      '--shadow-hover': '0 4px 12px rgba(0,0,0,0.4), 0 16px 40px rgba(0,0,0,0.5)',
    },
  ),
  makeTheme(
    'aurora',
    'Aurora',
    'Ice white + violet-mint, futuristic 2027',
    false,
    {
      '--bg': '#F5F7FB',
      '--bg-subtle': '#EBEEF6',
      '--bg-card': '#FFFFFF',
      '--text': '#0E1525',
      '--text-secondary': '#4A5B78',
      '--text-muted': '#616C81',
      '--border': '#DDE3F0',
      '--border-strong': '#C4CDE0',
      '--accent': '#6D4EFF',
      '--accent-hover': '#5A3DD6',
      '--accent-soft': '#EDE8FF',
      '--accent-text': '#FFFFFF',
      '--success': '#0EA5A5',
      '--success-soft': '#E0F7F7',
      '--warning': '#E8930C',
      '--warning-soft': '#FBF0DC',
      '--error': '#E0405A',
      '--error-soft': '#FCE8EC',
      '--star': '#FBBF24',
      '--shadow-card': '0 1px 3px rgba(109,78,255,0.04), 0 8px 24px rgba(109,78,255,0.06)',
      '--shadow-hover': '0 4px 12px rgba(109,78,255,0.08), 0 16px 40px rgba(109,78,255,0.10)',
    },
    { '--font-display': "'Inter', system-ui, sans-serif" },
  ),
];

export const defaultTheme: ThemeId = 'ybuy';
```

### src/theme-context.tsx (runtime token injection)

- 50 lines

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { themes, defaultTheme, type ThemeId, type Theme } from '@/themes';
import { SHOW_DEMO_THEMES } from '@/lib/feature-flags';

interface ThemeContextValue {
  theme: Theme;
  themeId: ThemeId;
  setThemeId: (id: ThemeId) => void;
  themes: Theme[];
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'rental-theme';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState<ThemeId>(() => {
    // Only honor a stored theme when the demo switcher is enabled; otherwise the app is
    // locked to the Ocean Green palette regardless of any stale localStorage value.
    if (SHOW_DEMO_THEMES && typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
      if (stored && themes.some((t) => t.id === stored)) return stored;
    }
    return defaultTheme;
  });

  const theme = themes.find((t) => t.id === themeId)!;

  useEffect(() => {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(theme.vars)) {
      root.style.setProperty(key, value);
    }
    root.dataset.theme = theme.id;
    root.classList.toggle('dark', theme.dark);
    localStorage.setItem(STORAGE_KEY, theme.id);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, themeId, setThemeId, themes }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
```

### src/lib/feature-flags.ts (SHOW_DEMO_THEMES and route flags)

- 12 lines

```ts
// Part 1 keeps out-of-scope and prototype-only features hard-disabled.
export const SHOW_OUT_OF_SCOPE_PAGES = false;

// Keep demo theme switcher disabled in Part 1 builds.
export const SHOW_DEMO_THEMES = false;

export const SHOW_HERO_CATEGORY_PILLS = import.meta.env.VITE_SHOW_HERO_CATEGORY_PILLS === 'true';

export const OUT_OF_SCOPE_ROUTES = new Set([
  'item-passport',
  'protection',
]);
```
