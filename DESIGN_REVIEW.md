# Design Review: YBuy Homepage

Reviewed against: User-provided YBuy product brief; no `DESIGN_BRIEF.md` was present  
Philosophy: Neighborhood-first rental marketplace with an evergreen, soft-sage, and citrus identity  
Date: 2026-11-06  
Scope: `http://localhost:5174/` only

## Screenshots Captured

| Screenshot | Breakpoint | Description |
| --- | --- | --- |
| `screenshots/review-home-desktop-1280.jpg` | Desktop (1280×800) | Full homepage, including the listing error state |
| `screenshots/review-home-tablet-768.jpg` | Tablet (768×1024) | Full homepage with tablet navigation and stacked search |
| `screenshots/review-home-mobile-375.jpg` | Mobile (375×812) | Full homepage with mobile navigation and touch-sized search controls |

## Summary

The homepage has a recognizable YBuy identity, confident image-led hero, and a clear responsive hierarchy. The captured test environment returned HTTP 503 for listing requests and HTTP 502 for the local Realtime WebSocket, so product cards and live auction activity could not be visually validated in this pass.

## Must Fix

1. **Restore the test environment's data services before release validation.** The root page correctly surfaces a listing error, but unavailable database and Realtime services prevent verification of product imagery, listing rails, and the auction cloud. This is an environment blocker, not a confirmed UI defect.

## Should Fix

1. **Recheck live content once services are healthy.** Confirm the listing and category states with real records, and inspect an active auction card and its update behavior. The current captures cannot verify those data-driven states.
2. **Keep the sparse-inventory layout balanced.** Desktop rails now center capped cards when only one or two listings are available; recheck this with live inventory before final sign-off. See [`home.tsx`](./src/main-site/pages/home.tsx#L425).

## Could Improve

1. **Add an automated contrast and keyboard pass.** The palette and visible controls appear coherent in the screenshots, but contrast ratios and full keyboard operation were not measured in this visual-only check.

## What Works Well

- The evergreen accent, citrus highlight, and display typography create a more distinctive identity than a grayscale marketplace template. See [`ybuy-design.css`](./src/main-site/ybuy-design.css#L26).
- The homepage leads with a clear, memorable headline and high-visibility search rather than generic product copy. See [`home.tsx`](./src/main-site/pages/home.tsx#L459).
- Mobile and tablet reorganize navigation and search controls instead of simply shrinking the desktop layout; all captured widths had no horizontal page overflow.
- The data error is explicit and recoverable through a retry action rather than appearing as a successful empty result.
- Reduced-motion preferences are accounted for in the shared design styles. See [`ybuy-design.css`](./src/main-site/ybuy-design.css#L178).
