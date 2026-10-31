# YBuy Design System: "The Rental Tag"

Approved redesign direction for YBuy (source: the approved redesign spec; product truth: `PRODUCT.md` and the existing code). This file supplies FORM only. The codebase still renders the previous monochrome UI (see `.superdesign/init/theme.md`); when the two disagree on visual style, this file wins. Existing code is used for functionality, routes, content and business rules only, never as visual inspiration.

## 1. Product context

- YBuy is a local peer-to-peer rental marketplace. Renters rent useful items from people nearby for exact dates; owners make things they already own rentable. Renting and lending get equal prominence.
- Exactly two booking paths: regular booking (instant or owner approval, per listing) and competitive bidding (live bids on auctions). No private offers, no counteroffers.
- Jobs to be done:
  - Renter: "Find the right item near me for my dates, and know the total before I commit."
  - Owner: "List what I own with accurate terms and dates, and approve the right requests."
- Truth rules: never invent claims, numbers, reviews, insurance, tax or availability. Design drafts use obviously sample content (for example "Sony A7 III with 28-70mm lens", "$32/day", "Deposit $150").

### Key routes and the one question each answers
- `/` Home: "What can I rent near me, and can I lend mine?" Deep ocean hero field with a large manila search tag and a smaller owner tag (equal prominence for lending). Then categories, near you (listings), live bids (auctions), how a rental works (find, book or bid, pick up, return), lend your things, answers, reply card, footer.
- `/search`: "Which of these fits my dates and distance?" h1 states the count and place; filter bar (category chips, dates, distance, price, instant book, bidding), sort, grid of ListingCards, map when available.
- `/listing/:id`: "Is this the right item, and what will it cost for my dates?" Gallery left; sticky booking Ticket right (price/day, Out/Back, quantity, pickup or delivery, line-item total, the one correct CTA for the listing's path); details below: owner trust, condition, included, pickup area, availability, reviews, rules.
- `/checkout/:id`: steps left, Ticket summary right. `/confirmation/:id`: pickup pass ticket with status and handoff code when available.
- `/bidding`, `/bidding/:id`, `/auction/:id`: live lots as live tags with countdown, current bid and bid count; the bid panel uses signal orange.
- `/requests`, `/need-something`: the Wanted board and the request form.
- `/dashboard?tab=renting|lending`: "What needs me next?" Next handoff as a tag, then the tag rack of active rentals.

## 2. Concept

- Idea: every rental is a tag that goes out and comes back. The interface is built from that tag: out date, back date, price per day, deposit, handoff code.
- Metaphor: the swing tag / claim ticket at a rental counter (luggage tag, coat-check stub).
- Signature: the live rental tag. Home hero: a large manila tag that holds the search (what, where, out, back) and fills in as you type. Listing page: the booking panel is a ticket whose totals update as dates change.
- Emotion: confident, neighbourly, exact. Motion verb: tags swing and settle (rotate from the hole, once).

## 3. Colour tokens

Use the semantic utility classes (same class API as `src/index.css`); values below are the approved ones.

```css
:root {
  --bg: #F4F6F3;              /* chalk: page ground            -> bg-app */
  --bg-card: #FFFFFF;         /* panels, cards                  -> bg-card */
  --bg-subtle: #EBEFEA;       /* tone step, secondary buttons   -> bg-subtle */
  --text: #0F2530;            /* harbor ink                     -> text-main */
  --text-secondary: #44555C;  /*                                -> text-sec */
  --text-muted: #5B6B70;      /*                                -> text-muted */
  --border: #DCE2DC;          /*                                -> border-app */
  --border-strong: #C2CBC3;   /*                                -> border-strong */
  --accent: #0E7C66;          /* ocean: primary action, links, selected -> bg-accent / text-accent / border-accent */
  --accent-hover: #0B6957;
  --accent-soft: #DDF3EA;     /* mint field                     -> bg-accent-soft */
  --accent-text: #FFFFFF;
  --tag: #F2E1B0;             /* manila: tag objects only       -> bg-tag */
  --tag-edge: #E2C987;        /* tag edge, hole ring            -> border-tag / bg-tag-edge */
  --deep: #0B3B33;            /* deep ocean: hero field, footer, dark panels -> bg-deep */
  --on-deep: #E6F4EE;         /*                                -> text-on-deep */
  --on-deep-muted: #A9C9BE;   /*                                -> text-on-deep-muted */
  --live: #C2410C;            /* signal orange: live auctions and "ending soon" only -> bg-live / text-live */
  --live-soft: #FDE8DD;       /*                                -> bg-live-soft */
  --live-dot: #F2622A;        /* live dot only */
  --success: #157A4E;  --success-soft: #E1F3EA;
  --warning: #B4740F;  --warning-soft: #FBEFD9;   /* text via text-warning */
  --error: #BE3A2E;    --error-soft: #FBE7E4;
  --favorite: #E0364F;        /* saved heart only */
  --star: #D99B1C;            /* rating star next to a number */
  --radius-sm: 0.25rem;
  --radius: 12px;             /* rounded-card: media, inputs */
  --radius-lg: 16px;          /* rounded-card-lg: panels */
  --radius-xl: 24px;          /* rounded-card-xl: big feature panels */
  --shadow-pop: 0 8px 24px rgba(0,0,0,0.16); /* floating things only */
  --font-display: 'Anton', 'Impact', sans-serif;
  --font-sans: 'Work Sans', system-ui, -apple-system, sans-serif;
}
```

Proportions: chalk ground and white panels carry about 85% of every screen; ink text; ocean only on the primary action, links and selected state; manila only on tag objects; deep ocean for the hero field, the footer and dark panels; signal orange only for live auctions and "ending soon".

Pairings: ink (`text-main` / `text-sec`) on manila, never `text-muted` on manila. On deep ocean use `text-on-deep` and `text-on-deep-muted`. White text on ocean buttons. Status colours keep their meaning only (success, warning, error).

## 4. Typography

- Fonts: Anton 400 (Google Fonts) and Work Sans 400/500/600/700 (Google Fonts). No other families.
- Display `font-display` = Anton (single weight, condensed caps). Only for short system text: page titles (h1), hero headline, prices on tags, dates on tags ("SAT 2 NOV"), countdowns, big totals, handoff codes. Uppercase, `tracking-[0.01em]`, line-height 0.9 to 1. Never below 20px, never for user-generated titles (listing titles), never for paragraphs.
- Text `font-sans` = Work Sans. Body 16px (15px allowed in dense rows), small 13px, nothing under 12px. Section headings (h2/h3) Work Sans 600/700 at 20 to 24px. Listing titles Work Sans 600. Field labels Work Sans 600 13px above the field.
- Numerals in tables, prices in rows and totals use tabular figures (`tnum`).
- Banned: tracked uppercase eyebrow labels above headings, monospace for data, accent-coloured words inside headlines, gradient text, "A · B · C" middle-dot meta strings (use separate spans with a gap, or icons).

## 5. Shape and depth

- Controls are fully round (`rounded-full`): buttons, chips, the search pill, segmented controls, icon buttons.
- Panels `rounded-card-lg` (16px); media `rounded-card` (12px); inputs `rounded-card` (12px); big feature panels `rounded-card-xl` (24px).
- Flat. Separate surfaces by tone step (`bg-card` on `bg-app`, `bg-subtle` inside cards). A surface uses a 1px `border-app` OR a shadow, never both. `shadow-pop` only on floating things: menus, dialogs, popovers, the phone sticky booking bar.
- Never: gradients, glass / backdrop blur, glows, icon-in-tinted-circle feature rows, identical icon + heading + text card grids, section numbers (01 / 02 / 03), emoji.

## 6. Signature components (anatomy)

- **RentalTag**: a manila (`--tag`) swing tag. Rectangle with the hole end cut at both corners (angled shoulders), a punched round hole near that end with a `--tag-edge` reinforcement ring, an optional thin string loop through the hole, 1px `--tag-edge` outline. Content: Work Sans 600 13px labels + Anton values. Props: `size` (sm / md / lg), `tone` ('manila' | 'card' | 'live' | 'deep'), `holeSide` (left / top / right). Settles with one small swing from the hole on entry (reduced motion: static).
- **Ticket + TicketStub**: white panel (16px radius) with two semicircular side notches cut in at the perforation line (notches show the page ground through them), a dashed perforation line across the panel, and a stub below the perforation that holds the total and the CTA.
- **DateStamp**: label (Out / Back / Ends) in Work Sans 600 13px + the date in Anton uppercase ("SAT 2 NOV").
- **PriceMark**: Anton amount + Work Sans unit ("/day").
- **ListingCard**: 4:3 photo (`rounded-card`); a small manila price tag hangs from the photo's top-left corner on a short string, showing a PriceMark; white round heart button top-right; title Work Sans 600, 2 lines max; one meta row of separate items: distance, rating (star + number + count, or "New listing"), pickup / delivery chips; instant-book bolt icon when instant. Auction lots get a live tag (signal orange) with current bid and time left.
- **Button** variants: primary (ocean fill, white text), secondary (`bg-subtle` fill, ink text), ghost, danger, success, inverse, onDark (for deep ocean: on-deep text, 1px on-deep-muted outline, no blur), live (signal orange). Sizes sm 36px, md 44px, lg 48px. Pill shaped. `loading` keeps the same verb.
- Also: IconButton (44px round, always labelled), Badge (tones neutral / accent / success / warning / error / inverse / live / tag), Alert (inline, next to what it describes), SectionHeader (Work Sans h2 + optional "See all" link), EmptyState, Card, Field (label above, error below tied with aria-describedby), PageHeader (h1 in Anton + one finding sentence + one primary action + optional back link).

## 7. Layout and spacing

- Page frame: `max-w-[1280px] mx-auto px-5 sm:px-8 lg:px-12` (one pair of margins everywhere). Desktop drafts are designed at 1440px wide.
- App screens: section gaps 32 to 48px, card padding 16 to 24px, 4px grid. Home: section gaps 96 to 160px.
- One `h1` per page. Every section has a heading that names it.
- Touch targets at least 44px. Phone layouts composed for 375 to 390px, no horizontal scroll.

## 8. Header and footer

- Header, desktop (1024px and up): light ground (`bg-app` or `bg-card`) with a 1px `border-app` bottom edge, about 72px tall, so the logo's harbor-ink wordmark keeps its contrast. Left to right: logo (exact Brand Asset image) | compact search pill (what, where, when; hidden on home where the hero holds the search) | "Live bids" (with a pulsing `--live-dot` dot) | "Wanted" | "Lend an item" (secondary pill) | saved, messages, notifications icon buttons (signed in) | account menu (Rentals, Lending, Profile and trust, Admin if allowed, Sign out) or "Sign in" (signed out).
- Tablet: logo | search icon | Lend | notifications | account. Phone: logo icon | search pill | notifications | account, plus a 5-item bottom nav (Explore, Bids, Lend, Rentals, Inbox).
- Footer: the back of the tag on deep ocean. Wordmark at full width; columns Rent / Lend / Help and trust / Legal using only routes that exist. The logo sits on a light tag plate (its ink wordmark needs a light ground).

## 9. Motion

- Durations: `duration-fast` 120ms, `duration-standard` 200ms, `duration-page` 280ms; ease-out. Every control gives press / hover / focus feedback.
- One signature move per surface (tag settle, ticket tear). Animate transform and opacity only. Respect `prefers-reduced-motion`.

## 10. States

Loading: fixed-size skeletons matching the final layout. Empty: frame and heading stay, one sentence on why, one real next action. Error: inside the failed block, plain cause + Retry. Validation: label above, error under the field. Success: inline confirmation next to the thing that changed. Disabled: native disabled + reduced emphasis.

## 11. Copy

- Plain, specific, sentence case. Buttons name the action: "Search", "Request to book", "Book now", "Place bid", "List an item", "Approve request", "Confirm pickup".
- Never: "seamless", "elevate", "unlock", em dashes in UI copy, invented proof (ratings, counts, testimonials, guarantees, insurance).
- Keep the product's factual copy, for example "Approximate pickup area. Exact address after confirmation.", "No charge until the owner approves.", "Refundable deposit. Refunded after the owner confirms the return."

## 12. Logo

- Brand Asset: `src/assets/ybuy-logo.png` (1882 x 697 transparent PNG: mint-to-teal leaf "Y" mark + harbor-ink "Buy" wordmark + "RENT ANYTHING LOCALLY" tagline).
- Every logo position renders this exact image (about 48px tall, about 130px wide in the header). Place it only on light grounds (chalk, white, manila); on deep ocean put it on a light tag plate.
- Never recolour, crop, redraw, or replace it with initials, emoji, a generic mark, an invented SVG, or text alone.

## 13. Accessibility

WCAG AA contrast, visible focus (2px ocean outline, 2px offset), semantic labels, keyboard navigation, status messages announced, reduced-motion support, 44px touch targets.
