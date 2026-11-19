# YBuy platform redesign

## Scope and mode

Public marketplace is Persuade. Customer workspaces and the separate admin portal are Operate. One identity serves all three; each shell keeps its role-specific tasks and permissions.

## Audience and job

Neighbors find nearby rentable items; renters request, pay, pick up, and return them; owners publish inventory and coordinate rentals; admins handle operational exceptions. Show real availability, costs, current state, and next valid action. Do not infer trust, demand, coverage, or financial outcomes from fixture data.

## Direction contract

**THESIS:** YBuy makes locally owned gear circulate through a clear, accountable rental journey. Avoid both the generic storefront and a dashboard that presents every feature at once.

**OWN-WORLD:** Keep the YBuy name and mark. Use a cool porcelain canvas, deep ink, and cobalt for primary action and selection. Reserve green, amber, and red for real success, warning, and error states. DM Sans carries working copy; Manrope carries short display headings. Real item photography supplies color and character.

**STORY:** Visitors search real inventory by item, place, and dates, then understand who approves and what happens next. Renters and owners see the current booking state and its valid next action. Admins see operational work grouped by urgency and permission.

**FIRST VIEWPORT:** Public home: quiet top navigation; a compact location-aware search is the first task; a photo-led field of real nearby listings proves the marketplace beneath it. Customer workspace: role-aware destination navigation, one page title and task summary, then actionable attention states before secondary metrics. Admin: separate authenticated shell with grouped operations navigation and an attention-first work area.

**FORM:** Operate direction assigned candidate 3, seed:3abb99e0bfbf6c4d; Persuade direction assigned candidate 4, seed:6fb0f7fd738847db. Both rolls were degraded, without catalog challengers or quality-bar boards. The brief explicitly grants design authority, so the implementation uses the shared circulation story and existing YBuy product evidence as its source.

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Constraints

Preserve routes, authentication, authorization, Supabase/RLS, Stripe verification, backend-calculated pricing, listing approval, bidding, booking, cancellation/refund, handoff, return, rewards, and existing admin permission checks. Keep preview themes and the separate admin deployment configuration unchanged. Do not add unsupported fee, redemption, insurance, or performance claims.
