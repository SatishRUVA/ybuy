# Extractable components (candidates for Superdesign DraftComponents)

Menu of codebase components that recur across pages or define shared patterns. Full source is in `components.md` and `layouts.md`; this file lists only what to extract and which props vary per page.

> Redesign note: the approved direction "The Rental Tag" (`.superdesign/design-system.md`) changes the header information architecture (Live bids, Wanted, Lend an item) and the whole visual language. Converting these components from current source reproduces the CURRENT, pre-redesign UI. Extract them for pixel reproductions of existing pages, not for Rental Tag redesign drafts.
>
> Logo: every logo position renders `BrandLogo` (`src/components/brand-logo.tsx`) with `src/assets/ybuy-logo.png` (phones: `src/assets/ybuy-icon.png`). A converted template must embed the uploaded Brand Asset URL for that file, never initials or a text-only mark.

## Layout Components

## Header
- Source: `src/components/nav.tsx` (`Header`)
- Category: layout
- Description: Sticky top bar with logo, main nav (Browse, Requests & offers, Bidding), "List an item" pill, notification bell, admin shield, account menu or "Sign in / Join"
- Extractable props: activeItem (string, default: "none"; one of browse | requests | bidding | none), signedIn (boolean, default: false), unreadCount (number, default: 0), showAdmin (boolean, default: false)
- Hardcoded: BrandLogo image, nav labels, account menu items (Bookings, Messages, Saved items, Your profile, Admin console, Switch account, Sign out), lucide icons (PackagePlus, Bell, ShieldCheck, User, ChevronDown, Menu, X), all CSS

## BottomNav
- Source: `src/components/nav.tsx` (`BottomNav`)
- Category: layout
- Description: Phone-only fixed bottom tab bar (Home, Browse, Bookings, Messages, Account) with ink active pill, plus floating round "List an item" button
- Extractable props: activeItem (string, default: "home"), showFab (boolean, default: true)
- Hardcoded: tab labels, lucide icons (Home, Search, Calendar, MessageSquare, User, Plus), all CSS

## BiddingTicker
- Source: `src/components/bidding-ticker.tsx` (`BiddingTicker`)
- Category: layout
- Description: Full-width ink strip under the header showing the top live rental bids (thumbnail, title, daily rate, time left) with pause-motion and collapse controls; hidden when the `bidding` flag is off
- Extractable props: collapsed (boolean, default: false), paused (boolean, default: false)
- Hardcoded: heading and live label copy, badge labels, icons (Flame, Zap, Tag, Pause, Play, ChevronUp, CalendarDays, Package), `.bid-banner*` / `.bid-card*` CSS from `src/index.css`

## HomeFooter
- Source: `src/pages/home.tsx` (`Footer`, rendered on the home page only)
- Category: layout
- Description: Logo, footer links (Browse, List an item, Guidelines), giant editorial "YBuy" wordmark, copyright line
- Extractable props: none
- Hardcoded: BrandLogo image, link labels, wordmark, all CSS

## AdminShell
- Source: `src/pages/admin/admin-page.tsx` (`AdminPage`)
- Category: layout
- Description: Admin console layout with grouped sidebar navigation (Operations, Finance, Super admin, Coming with their modules) and a section content area
- Extractable props: activeSection (string, default: "overview")
- Hardcoded: group titles, item labels, lucide icons, all CSS

## Basic Components

## ListingCard
- Source: `src/components/listing-card.tsx` (`ListingCard`)
- Category: basic
- Description: Grid card with 4:3 photo, Instant / Booked badges, favorite heart, category + distance line, 2-line title, rating or "New listing" + "Verified owner", price per day
- Extractable props: favorited (boolean, default: false), showInstant (boolean, default: false), booked (boolean, default: false)
- Hardcoded: layout, icons (MapPin, Star, Zap, Heart), all CSS

## ListingCardWide
- Source: `src/components/listing-card.tsx` (`ListingCardWide`)
- Category: basic
- Description: Horizontal row version of ListingCard used in search list mode
- Extractable props: favorited (boolean, default: false)
- Hardcoded: layout, icons, all CSS

## FavoriteButton
- Source: `src/components/listing-card.tsx` (`FavoriteButton`)
- Category: basic
- Description: Round white heart toggle placed over listing photos
- Extractable props: liked (boolean, default: false)
- Hardcoded: Heart icon, pop animation, all CSS

## ImageGallery
- Source: `src/components/listing-card.tsx` (`ImageGallery`)
- Category: basic
- Description: Listing photo viewer with main image, previous/next buttons, "n / total" counter and thumbnail rail
- Extractable props: activeIndex (number, default: 0)
- Hardcoded: ChevronLeft / ChevronRight / ImageOff icons, `.listing-image-*` CSS

## Button
- Source: `src/components/ui.tsx` (`Button`)
- Category: basic
- Description: Shared action button (primary, secondary, ghost, danger, success, inverse, onDark; sm/md/lg)
- Extractable props: variant (string, default: "primary"), size (string, default: "md"), loading (boolean, default: false), fullWidth (boolean, default: false)
- Hardcoded: base classes, Loader2 spinner, all CSS

## IconButton
- Source: `src/components/ui.tsx` (`IconButton`)
- Category: basic
- Description: Square icon-only button with required accessible label
- Extractable props: variant (string, default: "secondary"), size (string, default: "md")
- Hardcoded: all CSS

## Badge
- Source: `src/components/ui.tsx` (`Badge`)
- Category: basic
- Description: Small pill status label
- Extractable props: tone (string, default: "neutral")
- Hardcoded: all CSS

## Alert
- Source: `src/components/ui.tsx` (`Alert`)
- Category: basic
- Description: Inline status message with icon (warning, error, success, info)
- Extractable props: tone (string, default: "warning"), showTitle (boolean, default: false)
- Hardcoded: icons (AlertTriangle, CheckCircle2, Info), all CSS

## SectionHeader
- Source: `src/components/ui.tsx` (`SectionHeader`)
- Category: basic
- Description: Section heading with optional subtitle and right-hand "See all" style action
- Extractable props: showAction (boolean, default: false)
- Hardcoded: ArrowRight icon, all CSS

## EmptyState
- Source: `src/components/ui.tsx` (`EmptyState`)
- Category: basic
- Description: Dashed panel explaining an empty list with one next action
- Extractable props: showAction (boolean, default: true)
- Hardcoded: all CSS

## Surface
- Source: `src/components/ui.tsx` (`Surface`)
- Category: basic
- Description: Bordered white card surface used for panels and review cards
- Extractable props: interactive (boolean, default: false)
- Hardcoded: all CSS

## Field (with fieldClass input)
- Source: `src/components/ui.tsx` (`Field`) + `src/components/form-classes.ts` (`fieldClass`, `textareaClass`)
- Category: basic
- Description: Label above control with inline error under the field
- Extractable props: invalid (boolean, default: false)
- Hardcoded: all CSS

## Rating / VerifiedBadge / TrustChip
- Source: `src/components/trust.tsx`
- Category: basic
- Description: Star + score + count (or "No reviews yet"), green "Verified owner" mark, rounded trust chip
- Extractable props: showCount (boolean, default: true)
- Hardcoded: Star / BadgeCheck icons, all CSS

## SearchBar
- Source: `src/components/search.tsx` (`SearchBar`)
- Category: basic
- Description: Keyword, location, radius and date-range search control with a submit button (hero and compact variants)
- Extractable props: variant (string, default: "hero")
- Hardcoded: field labels and placeholders, icons, `.search-*` CSS

## DateRangePicker
- Source: `src/components/date-range-picker.tsx` (`DateRangePicker`)
- Category: basic
- Description: Rental dates trigger plus two-month calendar dialog with presets, booked/blocked days, summary and Apply
- Extractable props: open (boolean, default: false)
- Hardcoded: copy, icons, `.calendar-*` and `.listing-date-range-*` CSS

## PriceTag (home)
- Source: `src/pages/home.tsx` (`PriceTag`, local to the home page)
- Category: basic
- Description: Luggage-tag shaped white label with a punched hole that hangs a price or category name off a photo edge
- Extractable props: none
- Hardcoded: clip-path shape, hole dot, all CSS

## BookingPanel (listing detail)
- Source: `src/pages/listing.tsx` (`bookingPanel` JSX, lines 255-373)
- Category: basic
- Description: Sticky booking panel: price per day, rental dates, rental length options, pickup area, quantity, price breakdown, refundable deposit, estimated total, "Request to book" / "Book instantly"
- Extractable props: instantBooking (boolean, default: false), isOwner (boolean, default: false)
- Hardcoded: copy, icons (MapPin, ShieldCheck, Lock, ChevronRight), `.listing-*` CSS
