# YBuy design directions

This folder is an isolated, static design exploration. It does not change the
Vite application, routing, or production design tokens.

## Preview

Open `index.html` directly, or serve this folder:

```powershell
python -m http.server 4173 --directory design-showcase
```

Then open `http://localhost:4173/`.

Run the responsive and interaction smoke check from the repository root:

```powershell
python .agents\skills\webapp-testing\scripts\with_server.py --server "python -m http.server 4173 --directory design-showcase" --port 4173 -- node design-showcase/verify-showcase.mjs
```

This uses the repository's existing Playwright package and Chromium installation.

The eight concept pages share the same sample listings and core rental loop so
their visual differences can be compared fairly. The interactive journey
prototype is available at `journey.html`; its screen is selected with the
`screen` query parameter, for example `journey.html?screen=checkout`. Its
direction selector can compare all eight themes without leaving the current
screen.

Listings and prices come from the repository's local sample fixtures; they are
not live inventory, availability, or prices. Filters, saves, owner decisions,
messages, listing drafts, handover steps, and review previews only change the
current page. No listing or booking is created, no message is sent, and the
checkout preview does not collect card details or charge users. Listing
photographs are the existing Pexels image URLs used by those fixtures. The
YBuy logo is the existing project asset.

## Concepts

| Direction | Palette | Type | Composition | Best fit | Trade-off |
|---|---|---|---|---|---|
| [Quiet Luxury](quiet-luxury.html) | Porcelain `#F5F1E8`, pine `#24362B`, lichen `#68735D`, brass `#BDA16A` | Gloock + DM Sans | Spacious, image-led split hero; calm catalogue | Trust and considered, higher-value rentals | Keep practical controls crisp |
| [Contemporary Commerce](modern-minimal.html) | Mist `#F1F3EE`, forest `#315B49`, ink `#1A2722`, line `#D5DDD5` | Manrope | Architectural grid with high-clarity discovery | Fast, everyday rentals | Needs a distinctive brand voice |
| [Fresh Neighborhood](neighborhood-marketplace.html) | Sage `#F2F5ED`, spruce `#172D26`, leaf `#A4BD78`, green `#315B49` | DM Sans + Manrope | Warm local-first canvas with community in focus | Community-first discovery | Keep location privacy clear |
| [Bold Creative](bold-contemporary.html) | Chalk `#F4F3E9`, forest ink `#1D2A21`, vermilion `#BD3C27`, citron `#D8ED65` | Archivo + Space Grotesk | Oversized, asymmetrical headline and editorial product image | A memorable brand moment | Large type must not crowd search |
| [Editorial Lifestyle](editorial-premium.html) | Paper `#F5EFE6`, charcoal `#292321`, oxblood `#702B38`, clay `#B78170` | Newsreader + Work Sans | Magazine-like feature story and structured catalogue | Curated, design-conscious browsing | Keep everyday tasks quick |
| [Sophisticated Dark](sophisticated-dark.html) | Deep spruce `#111A16`, pale sage `#E6EEE7`, mint `#9BE0B3`, brass `#D3AE66` | Space Grotesk + DM Sans | Left-led dark canvas with bright product photography | Confident evening browsing | Maintain contrast throughout |
| [Colorful Premium](colorful-luxury.html) | Shell `#FFF5EF`, plum `#39232F`, berry `#8F3150`, marigold `#E4B94F`, leaf `#6A8B70` | Bodoni Moda + DM Sans | Jewel-toned feature layout and warm catalogue rhythm | Events and lifestyle rentals | Let the objects lead |
| [Experimental Objects](experimental.html) | Charcoal `#22231F`, warm paper `#F3F0E8`, aged gold `#D6A764`, line `#4A4B42` | Gloock + DM Sans | Spatial, gallery-like presentation | Brand exploration | Keep core actions familiar |

## Comparison and recommendation

The prototype covers discovery, item details, date selection, a no-charge
checkout preview, renter and owner workspaces, listing draft steps, messages,
booking handover, and review preview. The showcase directions also include
working category and text filters; those controls operate on sample cards only.

**Recommendation: Fresh Neighborhood.** Its warm, local-first character makes
the person-to-person nature of YBuy immediate without returning to a dated
classifieds look. Location, availability, price, and owner approval stay easy
to scan.

**Practical alternative: Contemporary Commerce.** Choose it when fast,
utilitarian browsing is the priority.

The recommendation is a design judgement, not user research. No ratings,
testimonials, or marketplace performance claims have been added.
