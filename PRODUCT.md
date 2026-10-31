# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Renters look for nearby items for a project, event, trip, or short-term need and want clear availability, pickup, price, and booking status. Owners publish items they already own, set terms and availability, review regular booking requests, and manage active rentals. The marketplace gives renter discovery and owner acquisition equal prominence.

## Product Purpose

YBuy helps people rent useful items from other people nearby and lets owners make their available belongings rentable. Success means a renter can find an appropriate item and complete the correct booking path, while an owner can publish and manage a listing with accurate terms and dates.

## Positioning

YBuy is a local peer-to-peer rental marketplace. A rental starts through exactly one of two paths: regular booking, which may require owner approval or be instant according to listing settings, or competitive bidding. Private offers and counteroffers are not booking paths.

## Operating Context

Renters discover by item, category, location, distance, dates, and filters; inspect listing details and availability; then request or complete a regular booking, or participate in an eligible auction. Owners create and edit listings, configure price and availability, choose pickup or delivery settings, respond to regular booking requests, coordinate handoff and return, and review their rental activity. Secure payment and booking state transitions are handled by existing YBuy integrations.

## Capabilities and Constraints

- Preserve the existing Vite, React, TypeScript, routing, Supabase APIs, database schemas, authentication, authorization, RLS, Stripe payment verification, notifications, listing approval rules, booking lifecycle, and bidding rules.
- Keep backend integrations authoritative; do not replace them with mock data.
- Keep exactly two booking paths: regular booking and competitive bidding. Do not introduce private offers or counteroffers.
- Keep owner and renter capabilities available without treating them as exclusive account roles.
- Preserve existing validation, loading, empty, error, and access-gated states while redesigning their presentation.
- Treat local synthetic fixtures as test data, not evidence of real customer activity or marketplace demand.

## Brand Commitments

The product is YBuy. Cobalt blue is the brand anchor (#3157E1), paired with premium neutral backgrounds, strong item photography, and restrained supporting accents. Airbnb, Stripe, Linear, and Apple are principle references for marketplace discovery, financial clarity, interface precision, and restraint; their visual identities are not to be copied.

The shared palette is deep charcoal-green ink (#172321), cobalt blue (#3157E1) and electric lime (#D8FF68) on warm paper (#F7F6F1) and white, with forest green (#163D34) for dark sections. Category tints: Cameras #DCE8F7, Outdoor #DCEBDC, Tools #F6E8B9, Sports #F6D8C5, Home #F5DFE4, Fashion #E7E1F2, Baby #D9EEE8, Vehicles #E5E6E2. Photography stays in natural colour. Keep semantic success, warning, and error colors where they communicate status.

## Evidence on Hand

The app has database-backed listings, categories, ratings, availability, bookings, messages, favorites, notifications, and bidding flows. The repository includes YBuy logo assets and category imagery. Test-environment sample offers and seeded synthetic listings are not real demand, testimonials, or performance claims. Do not invent trust, insurance, tax, availability, or customer claims beyond the data and settings the product can verify.

## Product Principles

- Give renters and owners equally clear entry points.
- Make item condition, rental dates, pickup, and total cost legible before commitment.
- Keep the requested booking path and its current status unmistakable.
- Preserve consent, authorization, validation, and server-side decisions.
- Let real inventory and photography carry discovery; do not substitute decorative marketing claims.

## Accessibility & Inclusion

Preserve keyboard navigation, visible focus, semantic labels, accessible validation and status feedback, reduced-motion support, readable contrast, and responsive layouts with usable touch targets.