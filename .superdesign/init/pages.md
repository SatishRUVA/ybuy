# Pages - component dependency trees

How to read: each tree is traced recursively from the page entry through every local import (`@/` alias and relative), skipping node_modules and type-only imports. Each file appears once per page (at its first occurrence). Tags: `[logic]` data/API/context/router code (strip when passing context), `[style]` CSS, `[asset]` image. Untagged = UI. Line counts help the PAYLOAD BUDGET (~900-line threshold per file).

These trees are the CANDIDATE set for `--context-file`, not an include-everything list.

## Global shell (rendered around every page except /admin and /access)
Entry: `src/App.tsx`
Dependencies (pages excluded):
- `src/theme-context.tsx` (50 lines) [logic]
  - `src/themes.ts` (335 lines) [logic]
  - `src/lib/feature-flags.ts` (12 lines) [logic]
- `src/auth-context.tsx` (339 lines) [logic]
  - `src/lib/supabase.ts` (12 lines) [logic]
  - `src/lib/auth-providers.ts` (24 lines) [logic]
- `src/location-context.tsx` (162 lines) [logic]
  - `src/lib/geo.ts` (151 lines) [logic]
    - `src/lib/marketplace-countries.ts` (30 lines) [logic]
  - `src/components/ui.tsx` (226 lines)
- `src/components/require-auth.tsx` (36 lines)
  - `src/components/skeleton.tsx` (144 lines)
- `src/components/sign-in-dialog.tsx` (155 lines)
  - `src/components/form-classes.ts` (12 lines)
  - `src/components/provider-icon.tsx` (28 lines)
  - `src/data.ts` (1225 lines) [logic]
- `src/router.tsx` (211 lines) [logic]
  - `src/lib/search-state.ts` (80 lines) [logic]
- `src/components/nav.tsx` (352 lines)
  - `src/lib/admin.ts` (235 lines) [logic]
    - `src/lib/listings.ts` (722 lines) [logic]
      - `src/lib/text-safety.ts` (44 lines) [logic]
      - `src/lib/reviews.ts` (108 lines) [logic]
  - `src/components/search.tsx` (496 lines)
    - `src/components/date-range-picker.tsx` (435 lines)
    - `src/components/shadcn/select.tsx` (55 lines)
      - `src/lib/utils.ts` (6 lines) [logic]
  - `src/lib/notifications.ts` (117 lines) [logic]
  - `src/components/brand-logo.tsx` (11 lines)
    - `src/assets/ybuy-logo.png` [asset]
    - `src/assets/ybuy-icon.png` [asset]
- `src/components/bidding-ticker.tsx` (209 lines)
  - `src/lib/use-feature-flags.ts` (48 lines) [logic]
    - `src/lib/feature-flag-store.ts` (95 lines) [logic]
  - `src/lib/bidding-samples.ts` (16 lines) [logic]
    - `src/assets/offer-demo-canopy.png` [asset]
    - `src/assets/offer-demo-backpack.png` [asset]
    - `src/assets/offer-demo-camera.png` [asset]
  - `src/lib/auction-countdown.ts` (15 lines) [logic]
- `src/components/vpn-notice.tsx` (78 lines)
  - `src/components/shadcn/alert-dialog.tsx` (45 lines)

Shell UI files: `src/App.tsx`, `src/components/bidding-ticker.tsx`, `src/components/brand-logo.tsx`, `src/components/date-range-picker.tsx`, `src/components/form-classes.ts`, `src/components/nav.tsx`, `src/components/provider-icon.tsx`, `src/components/require-auth.tsx`, `src/components/search.tsx`, `src/components/shadcn/alert-dialog.tsx`, `src/components/shadcn/select.tsx`, `src/components/sign-in-dialog.tsx`, `src/components/skeleton.tsx`, `src/components/ui.tsx`, `src/components/vpn-notice.tsx` - 2429 lines total. Global CSS: `src/index.css` (837 lines).

## / (Home)
Entry: `src/pages/home.tsx` (736 lines) - exports HomePage
Top-level blocks (name:line): POOL_SIZE:23, RAIL_SIZE:24, EASE:25, HomePage:28, Shell:202, Reveal:207, PriceTag:223, WALL_ASPECTS:234, Hero:236, WallColumn:324, Aisle:348, CategoryTile:395, MoreTile:432, openListingLink:458, listingPlace:464, listingRating:470, ShelfCard:475, Shelf:507, Tape:545, MockBidding:570, STEPS:602, STUB_NOTCH:609, Journey:611, AskBand:641, OWNER_STEPS:674, STACK:675, OwnerInvite:681, Footer:720
Dependencies:
- `src/components/search.tsx` (496 lines)
  - `src/theme-context.tsx` (50 lines) [logic]
    - `src/themes.ts` (335 lines) [logic]
    - `src/lib/feature-flags.ts` (12 lines) [logic]
  - `src/lib/geo.ts` (151 lines) [logic]
    - `src/lib/marketplace-countries.ts` (30 lines) [logic]
      - `src/lib/supabase.ts` (12 lines) [logic]
  - `src/location-context.tsx` (162 lines) [logic]
    - `src/components/ui.tsx` (226 lines)
  - `src/components/date-range-picker.tsx` (435 lines)
  - `src/components/shadcn/select.tsx` (55 lines)
    - `src/lib/utils.ts` (6 lines) [logic]
    - `src/components/form-classes.ts` (12 lines)
  - `src/lib/search-state.ts` (80 lines) [logic]
- `src/components/listing-card.tsx` (238 lines)
  - `src/components/trust.tsx` (96 lines)
- `src/components/brand-logo.tsx` (11 lines)
  - `src/assets/ybuy-logo.png` [asset]
  - `src/assets/ybuy-icon.png` [asset]
- `src/router.tsx` (211 lines) [logic]
- `src/auth-context.tsx` (339 lines) [logic]
  - `src/lib/auth-providers.ts` (24 lines) [logic]
- `src/data.ts` (1225 lines) [logic]
- `src/lib/listings.ts` (722 lines) [logic]
  - `src/lib/text-safety.ts` (44 lines) [logic]
  - `src/lib/reviews.ts` (108 lines) [logic]
- `src/lib/favorites.ts` (32 lines) [logic]
- `src/lib/use-feature-flags.ts` (48 lines) [logic]
  - `src/lib/admin.ts` (235 lines) [logic]
  - `src/lib/feature-flag-store.ts` (95 lines) [logic]

UI candidate files: `src/pages/home.tsx` + `src/components/form-classes.ts`, `src/components/trust.tsx`, `src/components/search.tsx`, `src/components/shadcn/select.tsx`, `src/components/listing-card.tsx`, `src/components/ui.tsx`, `src/components/brand-logo.tsx`, `src/components/date-range-picker.tsx` - 2305 lines; plus shell UI and `src/index.css`.

## /listing/:id (Listing detail)
Entry: `src/pages/listing.tsx` (681 lines) - exports ListingPage
Top-level blocks (name:line): formatMoney:31, formatDateShort:35, ListingPage:40, bookingPanel:255 (booking panel JSX), ListingPage main render return:375 (page layout JSX), Block:652, PassportField:664, PriceRow:673
Dependencies:
- `src/components/listing-card.tsx` (238 lines)
  - `src/components/ui.tsx` (226 lines)
  - `src/components/trust.tsx` (96 lines)
  - `src/lib/feature-flags.ts` (12 lines) [logic]
- `src/router.tsx` (211 lines) [logic]
  - `src/lib/search-state.ts` (80 lines) [logic]
- `src/lib/listings.ts` (722 lines) [logic]
  - `src/lib/supabase.ts` (12 lines) [logic]
  - `src/lib/text-safety.ts` (44 lines) [logic]
  - `src/lib/reviews.ts` (108 lines) [logic]
- `src/lib/messages.ts` (195 lines) [logic]
- `src/lib/favorites.ts` (32 lines) [logic]
- `src/lib/availability.ts` (42 lines) [logic]
- `src/components/date-range-picker.tsx` (435 lines)
  - `src/lib/geo.ts` (151 lines) [logic]
    - `src/lib/marketplace-countries.ts` (30 lines) [logic]
- `src/auth-context.tsx` (339 lines) [logic]
  - `src/lib/auth-providers.ts` (24 lines) [logic]
- `src/lib/settings.ts` (23 lines) [logic]
- `src/components/skeleton.tsx` (144 lines)
- `src/components/marketplace-offer-form.tsx` (92 lines)
  - `src/components/form-classes.ts` (12 lines)
  - `src/lib/marketplace.ts` (479 lines) [logic]
- `src/components/insurance-amount.tsx` (17 lines)
  - `src/lib/insurance-pricing.ts` (13 lines) [logic]
  - `src/lib/use-feature-flags.ts` (48 lines) [logic]
    - `src/lib/admin.ts` (235 lines) [logic]
    - `src/lib/feature-flag-store.ts` (95 lines) [logic]
- `src/lib/demo-tax.ts` (8 lines) [logic]
- `src/lib/rental-pricing.ts` (42 lines) [logic]

UI candidate files: `src/pages/listing.tsx` + `src/components/form-classes.ts`, `src/components/trust.tsx`, `src/components/insurance-amount.tsx`, `src/components/listing-card.tsx`, `src/components/skeleton.tsx`, `src/components/ui.tsx`, `src/components/date-range-picker.tsx`, `src/components/marketplace-offer-form.tsx` - 1941 lines; plus shell UI and `src/index.css`.

## /search (Search results)
Entry: `src/pages/search.tsx` (966 lines) - exports SearchPage
Top-level blocks (name:line): PRICE_FILTER_MAX:22, initialSearchPageSize:24, SearchPage:33, FilterPanel:648, FilterToggle:743, MapView:762
Dependencies:
- `src/components/search.tsx` (496 lines)
  - `src/theme-context.tsx` (50 lines) [logic]
    - `src/themes.ts` (335 lines) [logic]
    - `src/lib/feature-flags.ts` (12 lines) [logic]
  - `src/lib/geo.ts` (151 lines) [logic]
    - `src/lib/marketplace-countries.ts` (30 lines) [logic]
      - `src/lib/supabase.ts` (12 lines) [logic]
  - `src/location-context.tsx` (162 lines) [logic]
    - `src/components/ui.tsx` (226 lines)
  - `src/components/date-range-picker.tsx` (435 lines)
  - `src/components/shadcn/select.tsx` (55 lines)
    - `src/lib/utils.ts` (6 lines) [logic]
    - `src/components/form-classes.ts` (12 lines)
  - `src/lib/search-state.ts` (80 lines) [logic]
- `src/components/listing-card.tsx` (238 lines)
  - `src/components/trust.tsx` (96 lines)
- `src/router.tsx` (211 lines) [logic]
- `src/auth-context.tsx` (339 lines) [logic]
  - `src/lib/auth-providers.ts` (24 lines) [logic]
- `src/lib/listings.ts` (722 lines) [logic]
  - `src/lib/text-safety.ts` (44 lines) [logic]
  - `src/lib/reviews.ts` (108 lines) [logic]
- `src/lib/favorites.ts` (32 lines) [logic]
- `src/lib/leaflet.ts` (65 lines) [logic]
- `src/lib/use-feature-flags.ts` (48 lines) [logic]
  - `src/lib/admin.ts` (235 lines) [logic]
  - `src/lib/feature-flag-store.ts` (95 lines) [logic]
- `src/components/skeleton.tsx` (144 lines)
- `src/components/shadcn/dialog.tsx` (89 lines)
- `src/components/category-icon.tsx` (54 lines)
- `src/data.ts` (1225 lines) [logic]

UI candidate files: `src/pages/search.tsx` + `src/components/form-classes.ts`, `src/components/trust.tsx`, `src/components/search.tsx`, `src/components/shadcn/select.tsx`, `src/components/listing-card.tsx`, `src/components/skeleton.tsx`, `src/components/shadcn/dialog.tsx`, `src/components/ui.tsx`, `src/components/category-icon.tsx`, `src/components/date-range-picker.tsx` - 2811 lines; plus shell UI and `src/index.css`.

## /checkout/:id and /confirmation/:id (Checkout and confirmation)
Entry: `src/pages/checkout.tsx` (443 lines) - exports CheckoutPage, ConfirmationPage
Top-level blocks (name:line): formatDay:27, formatMoney:32, CheckoutPage:36, Row:265, ConfirmationPage:286
Dependencies:
- `src/router.tsx` (211 lines) [logic]
  - `src/lib/search-state.ts` (80 lines) [logic]
- `src/auth-context.tsx` (339 lines) [logic]
  - `src/lib/supabase.ts` (12 lines) [logic]
  - `src/lib/auth-providers.ts` (24 lines) [logic]
- `src/lib/listings.ts` (722 lines) [logic]
  - `src/lib/text-safety.ts` (44 lines) [logic]
  - `src/lib/reviews.ts` (108 lines) [logic]
- `src/lib/bookings.ts` (206 lines) [logic]
- `src/lib/owner-promotions.ts` (36 lines) [logic]
- `src/components/booking-pickup.tsx` (37 lines)
  - `src/components/ui.tsx` (226 lines)
  - `src/components/skeleton.tsx` (144 lines)
- `src/lib/messages.ts` (195 lines) [logic]
- `src/components/trust.tsx` (96 lines)
- `src/components/success-feedback.tsx` (164 lines)
- `src/lib/payments.ts` (49 lines) [logic]
- `src/components/rental-settlement.tsx` (53 lines)
  - `src/lib/payouts.ts` (88 lines) [logic]
- `src/components/checkout-reservation.tsx` (47 lines)
- `src/components/rental-agreement.tsx` (56 lines)
  - `src/lib/agreements.ts` (21 lines) [logic]
- `src/lib/settings.ts` (23 lines) [logic]
- `src/lib/use-feature-flags.ts` (48 lines) [logic]
  - `src/lib/admin.ts` (235 lines) [logic]
  - `src/lib/feature-flag-store.ts` (95 lines) [logic]
- `src/components/form-classes.ts` (12 lines)
- `src/lib/rental-pricing.ts` (42 lines) [logic]
- `src/lib/insurance-pricing.ts` (13 lines) [logic]
- `src/components/insurance-amount.tsx` (17 lines)
- `src/lib/demo-tax.ts` (8 lines) [logic]

UI candidate files: `src/pages/checkout.tsx` + `src/components/form-classes.ts`, `src/components/rental-settlement.tsx`, `src/components/trust.tsx`, `src/components/checkout-reservation.tsx`, `src/components/rental-agreement.tsx`, `src/components/insurance-amount.tsx`, `src/components/success-feedback.tsx`, `src/components/skeleton.tsx`, `src/components/booking-pickup.tsx`, `src/components/ui.tsx` - 1295 lines; plus shell UI and `src/index.css`.

## /dashboard?tab=renting|lending (Bookings dashboard (renting + lending))
Entry: `src/pages/dashboards.tsx` (1036 lines) - exports BookingsPage
Top-level blocks (name:line): formatRange:57, StatCard:66, BookingRow:88, BookingsPage:139, RenterDashboard:188, AttentionRow:437, OwnerDashboard:452, PayoutControl:947, Sheet:953, ReviewModal:995
Dependencies:
- `src/router.tsx` (211 lines) [logic]
  - `src/lib/search-state.ts` (80 lines) [logic]
- `src/auth-context.tsx` (339 lines) [logic]
  - `src/lib/supabase.ts` (12 lines) [logic]
  - `src/lib/auth-providers.ts` (24 lines) [logic]
- `src/data.ts` (1225 lines) [logic]
- `src/lib/bookings.ts` (206 lines) [logic]
  - `src/lib/listings.ts` (722 lines) [logic]
    - `src/lib/text-safety.ts` (44 lines) [logic]
    - `src/lib/reviews.ts` (108 lines) [logic]
- `src/lib/messages.ts` (195 lines) [logic]
- `src/lib/payouts.ts` (88 lines) [logic]
- `src/components/rental-settlement.tsx` (53 lines)
  - `src/components/ui.tsx` (226 lines)
- `src/components/booking-pickup.tsx` (37 lines)
  - `src/components/skeleton.tsx` (144 lines)
- `src/lib/availability.ts` (42 lines) [logic]
- `src/components/availability-calendar.tsx` (96 lines)
  - `src/lib/geo.ts` (151 lines) [logic]
    - `src/lib/marketplace-countries.ts` (30 lines) [logic]
- `src/components/duration-discount-control.tsx` (102 lines)
  - `src/components/form-classes.ts` (12 lines)
  - `src/lib/listing-flow.ts` (197 lines) [logic]
  - `src/lib/use-feature-flags.ts` (48 lines) [logic]
    - `src/lib/admin.ts` (235 lines) [logic]
    - `src/lib/feature-flag-store.ts` (95 lines) [logic]
  - `src/lib/rental-pricing.ts` (42 lines) [logic]
- `src/components/owner-promotion-control.tsx` (48 lines)
  - `src/lib/owner-promotions.ts` (36 lines) [logic]
- `src/components/listing-negotiation-settings.tsx` (94 lines)
  - `src/components/listing-offer-preferences.tsx` (91 lines)
    - `src/components/shadcn/switch.tsx` (21 lines)
      - `src/lib/utils.ts` (6 lines) [logic]
    - `src/components/shadcn/select.tsx` (55 lines)
  - `src/components/listing-auction-preferences.tsx` (75 lines)
    - `src/components/date-range-picker.tsx` (435 lines)
  - `src/lib/listing-auctions.ts` (152 lines) [logic]
- `src/lib/feature-flags.ts` (12 lines) [logic]
- `src/components/trust.tsx` (96 lines)
- `src/components/success-feedback.tsx` (164 lines)

UI candidate files: `src/pages/dashboards.tsx` + `src/components/form-classes.ts`, `src/components/rental-settlement.tsx`, `src/components/trust.tsx`, `src/components/duration-discount-control.tsx`, `src/components/shadcn/select.tsx`, `src/components/listing-auction-preferences.tsx`, `src/components/listing-negotiation-settings.tsx`, `src/components/owner-promotion-control.tsx`, `src/components/success-feedback.tsx`, `src/components/skeleton.tsx`, `src/components/listing-offer-preferences.tsx`, `src/components/booking-pickup.tsx`, `src/components/shadcn/switch.tsx`, `src/components/ui.tsx`, `src/components/availability-calendar.tsx`, `src/components/date-range-picker.tsx` - 2785 lines; plus shell UI and `src/index.css`.

## /create-listing and /edit-listing/:id (Create / edit listing)
Entry: `src/pages/create-listing.tsx` (851 lines) - exports CreateListingPage
Top-level blocks (name:line): STEPS:26, STEP_TITLES:27, CreateListingPage:41
Dependencies:
- `src/router.tsx` (211 lines) [logic]
  - `src/lib/search-state.ts` (80 lines) [logic]
- `src/auth-context.tsx` (339 lines) [logic]
  - `src/lib/supabase.ts` (12 lines) [logic]
  - `src/lib/auth-providers.ts` (24 lines) [logic]
- `src/lib/listings.ts` (722 lines) [logic]
  - `src/lib/text-safety.ts` (44 lines) [logic]
  - `src/lib/reviews.ts` (108 lines) [logic]
- `src/lib/listing-flow.ts` (197 lines) [logic]
- `src/lib/listing-ai.ts` (86 lines) [logic]
- `src/lib/listing-rules.ts` (116 lines) [logic]
- `src/lib/geo.ts` (151 lines) [logic]
  - `src/lib/marketplace-countries.ts` (30 lines) [logic]
- `src/components/ui.tsx` (226 lines)
- `src/components/form-classes.ts` (12 lines)
- `src/components/pickup-location.tsx` (186 lines)
  - `src/location-context.tsx` (162 lines) [logic]
  - `src/lib/google-maps.ts` (62 lines) [logic]
- `src/components/listing-photo-editor.tsx` (84 lines)
  - `src/components/skeleton.tsx` (144 lines)
- `src/components/listing-negotiation-settings.tsx` (94 lines)
  - `src/components/listing-offer-preferences.tsx` (91 lines)
    - `src/components/shadcn/switch.tsx` (21 lines)
      - `src/lib/utils.ts` (6 lines) [logic]
    - `src/components/shadcn/select.tsx` (55 lines)
  - `src/components/listing-auction-preferences.tsx` (75 lines)
    - `src/components/date-range-picker.tsx` (435 lines)
  - `src/lib/listing-auctions.ts` (152 lines) [logic]
  - `src/lib/use-feature-flags.ts` (48 lines) [logic]
    - `src/lib/admin.ts` (235 lines) [logic]
    - `src/lib/feature-flag-store.ts` (95 lines) [logic]
- `src/components/listing-availability-picker.tsx` (84 lines)
  - `src/lib/listing-availability.ts` (12 lines) [logic]
- `src/components/success-feedback.tsx` (164 lines)
- `src/components/shadcn/alert-dialog.tsx` (45 lines)
- `src/lib/listing-item-details.ts` (25 lines) [logic]
- `src/lib/rental-pricing.ts` (42 lines) [logic]

UI candidate files: `src/pages/create-listing.tsx` + `src/components/form-classes.ts`, `src/components/shadcn/select.tsx`, `src/components/listing-auction-preferences.tsx`, `src/components/listing-negotiation-settings.tsx`, `src/components/success-feedback.tsx`, `src/components/skeleton.tsx`, `src/components/listing-offer-preferences.tsx`, `src/components/shadcn/alert-dialog.tsx`, `src/components/listing-photo-editor.tsx`, `src/components/shadcn/switch.tsx`, `src/components/ui.tsx`, `src/components/listing-availability-picker.tsx`, `src/components/date-range-picker.tsx`, `src/components/pickup-location.tsx` - 2567 lines; plus shell UI and `src/index.css`.

## /bidding, /bidding/:id, /auction/:id (Bidding)
Entry: `src/pages/bidding.tsx` (620 lines) - exports BiddingPage, BiddingDetailPage, AuctionPage
Top-level blocks (name:line): AuctionImage:23, isAuctionLive:34, auctionStatus:38, auctionDeadline:53, matchesAuctionFilter:60, OwnerBiddingDashboard:68, LiveBidding:211, LiveBiddingDirectory:318, MockBiddingGate:445, BiddingPage:468, BiddingDetailPage:475, RentalAuctionDetail:483, MockBiddingPage:535, AuctionPage:558, DemoAuction:562
Dependencies:
- `src/data.ts` (1225 lines) [logic]
- `src/router.tsx` (211 lines) [logic]
  - `src/lib/search-state.ts` (80 lines) [logic]
- `src/auth-context.tsx` (339 lines) [logic]
  - `src/lib/supabase.ts` (12 lines) [logic]
  - `src/lib/auth-providers.ts` (24 lines) [logic]
- `src/lib/use-feature-flags.ts` (48 lines) [logic]
  - `src/lib/admin.ts` (235 lines) [logic]
    - `src/lib/listings.ts` (722 lines) [logic]
      - `src/lib/text-safety.ts` (44 lines) [logic]
      - `src/lib/reviews.ts` (108 lines) [logic]
  - `src/lib/feature-flag-store.ts` (95 lines) [logic]
- `src/components/ui.tsx` (226 lines)
- `src/components/form-classes.ts` (12 lines)
- `src/lib/bidding-samples.ts` (16 lines) [logic]
  - `src/assets/offer-demo-canopy.png` [asset]
  - `src/assets/offer-demo-backpack.png` [asset]
  - `src/assets/offer-demo-camera.png` [asset]
- `src/lib/listing-auctions.ts` (152 lines) [logic]
  - `src/lib/geo.ts` (151 lines) [logic]
    - `src/lib/marketplace-countries.ts` (30 lines) [logic]
- `src/components/category-icon.tsx` (54 lines)
- `src/components/skeleton.tsx` (144 lines)
- `src/components/listing-auction-panel.tsx` (116 lines)
  - `src/lib/auction-countdown.ts` (15 lines) [logic]

UI candidate files: `src/pages/bidding.tsx` + `src/components/form-classes.ts`, `src/components/skeleton.tsx`, `src/components/listing-auction-panel.tsx`, `src/components/ui.tsx`, `src/components/category-icon.tsx` - 1172 lines; plus shell UI and `src/index.css`.

## /requests and /need-something (Wanted board and request form)
Entry: `src/pages/requests.tsx` (904 lines) - exports RequestsPage, NeedSomethingPage
Top-level blocks (name:line): RequestsPage:48, RequestCard:283, RequestImages:318, OfferComposer:341, MyRequestCard:410, MyRequestDetails:453, RequestEditForm:529, NegotiationCard:582, RequestSkeleton:715, NeedSomethingPage:720
Dependencies:
- `src/router.tsx` (211 lines) [logic]
  - `src/lib/search-state.ts` (80 lines) [logic]
- `src/auth-context.tsx` (339 lines) [logic]
  - `src/lib/supabase.ts` (12 lines) [logic]
  - `src/lib/auth-providers.ts` (24 lines) [logic]
- `src/components/ui.tsx` (226 lines)
- `src/components/form-classes.ts` (12 lines)
- `src/components/skeleton.tsx` (144 lines)
- `src/components/date-picker.tsx` (93 lines)
  - `src/components/shadcn/dialog.tsx` (89 lines)
    - `src/lib/utils.ts` (6 lines) [logic]
  - `src/components/date-range-picker.tsx` (435 lines)
    - `src/lib/geo.ts` (151 lines) [logic]
      - `src/lib/marketplace-countries.ts` (30 lines) [logic]
- `src/lib/listings.ts` (722 lines) [logic]
  - `src/lib/text-safety.ts` (44 lines) [logic]
  - `src/lib/reviews.ts` (108 lines) [logic]
- `src/lib/marketplace.ts` (479 lines) [logic]
- `src/lib/messages.ts` (195 lines) [logic]
- `src/lib/use-feature-flags.ts` (48 lines) [logic]
  - `src/lib/admin.ts` (235 lines) [logic]
  - `src/lib/feature-flag-store.ts` (95 lines) [logic]

UI candidate files: `src/pages/requests.tsx` + `src/components/form-classes.ts`, `src/components/date-picker.tsx`, `src/components/skeleton.tsx`, `src/components/shadcn/dialog.tsx`, `src/components/ui.tsx`, `src/components/date-range-picker.tsx` - 1903 lines; plus shell UI and `src/index.css`.

## /notifications (Notifications)
Entry: `src/pages/notifications.tsx` (481 lines) - exports NotificationsPage
Top-level blocks (name:line): PAGE_SIZE:30, UUID:31, notificationRoute:33, NotificationIcon:51, relativeTime:71, MarketplaceUpdates:82, NotificationsPage:188
Dependencies:
- `src/auth-context.tsx` (339 lines) [logic]
  - `src/lib/supabase.ts` (12 lines) [logic]
  - `src/lib/auth-providers.ts` (24 lines) [logic]
- `src/components/ui.tsx` (226 lines)
- `src/components/shadcn/card.tsx` (30 lines)
  - `src/lib/utils.ts` (6 lines) [logic]
- `src/components/skeleton.tsx` (144 lines)
- `src/components/form-classes.ts` (12 lines)
- `src/lib/notifications.ts` (117 lines) [logic]
- `src/router.tsx` (211 lines) [logic]
  - `src/lib/search-state.ts` (80 lines) [logic]
- `src/lib/marketplace.ts` (479 lines) [logic]
  - `src/lib/text-safety.ts` (44 lines) [logic]
  - `src/lib/geo.ts` (151 lines) [logic]
    - `src/lib/marketplace-countries.ts` (30 lines) [logic]

UI candidate files: `src/pages/notifications.tsx` + `src/components/form-classes.ts`, `src/components/shadcn/card.tsx`, `src/components/skeleton.tsx`, `src/components/ui.tsx` - 893 lines; plus shell UI and `src/index.css`.

## /messages and /messages/:id (Messages)
Entry: `src/pages/messaging.tsx` (253 lines) - exports MessagingPage, ConversationPage
Top-level blocks (name:line): timeAgo:11, MessagingPage:21, ConversationPage:107, Avatar:111, ChatView:117
Dependencies:
- `src/router.tsx` (211 lines) [logic]
  - `src/lib/search-state.ts` (80 lines) [logic]
- `src/auth-context.tsx` (339 lines) [logic]
  - `src/lib/supabase.ts` (12 lines) [logic]
  - `src/lib/auth-providers.ts` (24 lines) [logic]
- `src/lib/messages.ts` (195 lines) [logic]
  - `src/lib/text-safety.ts` (44 lines) [logic]
  - `src/lib/listings.ts` (722 lines) [logic]
    - `src/lib/reviews.ts` (108 lines) [logic]
- `src/components/skeleton.tsx` (144 lines)
- `src/components/ui.tsx` (226 lines)
- `src/components/form-classes.ts` (12 lines)

UI candidate files: `src/pages/messaging.tsx` + `src/components/form-classes.ts`, `src/components/skeleton.tsx`, `src/components/ui.tsx` - 635 lines; plus shell UI and `src/index.css`.
