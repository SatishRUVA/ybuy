---
name: YBuy
description: A considered neighborhood marketplace for renting useful things from people nearby.
colors:
  primary: "#3157E1"
  primary-hover: "#2446C5"
  primary-soft: "#EBF0FF"
  neutral-bg: "#FBFCFE"
  neutral-surface: "#FFFFFF"
  neutral-subtle: "#F3F5F8"
  neutral-text: "#172033"
  neutral-secondary: "#4B5568"
  neutral-muted: "#626C7D"
  neutral-border: "#E4E8EF"
  success: "#17794F"
  success-soft: "#E8F5EC"
  warning: "#A15C00"
  warning-soft: "#FFF1D6"
  error: "#B42318"
  error-soft: "#FEE9E7"
typography:
  display:
    fontFamily: "Manrope, DM Sans, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.035em"
  body:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "0.5rem"
  md: "0.625rem"
  lg: "0.75rem"
  xl: "1rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral-surface}"
    rounded: "{rounded.md}"
    padding: "0.625rem 1rem"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  surface:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.neutral-text}"
    rounded: "{rounded.lg}"
---

## Overview

YBuy is a peer-to-peer rental marketplace. Its interface should make discovery feel local and personal, while keeping booking, handoff, and money movement precise. The visual language pairs porcelain surfaces and deep ink with a restrained cobalt action color. Product photography carries most of the visual character.

## Colors

Use cobalt for the main action, selection, and links. Keep most page area porcelain or white, with cool gray for quiet grouping and dividers. Reserve green, amber, and red for success, attention, and errors. Do not use semantic colors as decoration or infer financial status from color alone.

## Typography

Use Manrope for display and page headings, and DM Sans for body text, controls, and supporting information. Keep page headings compact and section headings clearly subordinate. Use tabular numerals for prices, balances, dates, and counts.

## Layout

Public discovery uses a wide centered content area, search first, and a small number of distinct listing collections. Customer workspaces use four primary destinations—browse, rentals, listings, and messages—with secondary tools grouped behind a clear disclosure. Admin keeps the current section visible in a compact header switcher; its permission-filtered destinations stay grouped in an on-demand section menu so operational work gets the full page width. Keep task actions close to the records they affect.

## Elevation & Depth

Prefer surface contrast, alignment, and whitespace over floating stacks of cards. Use a fine border and a restrained shadow for elevated controls and hover feedback. Sticky navigation and search surfaces remain opaque for legibility.

## Shapes

Use compact rounded rectangles for buttons, inputs, and status labels. Listing imagery may use a slightly larger corner. Avoid pill-shaped cards and heavy outlines; reserve full circles for avatars and icon controls.

## Components

- Primary buttons use cobalt; secondary actions use a white surface and a clear border; lower-priority actions use a quiet text button.
- Badges identify concise states and retain a text label. Alerts provide an icon, readable message, and an assertive role for errors.
- Surfaces have a white background, a fine cool-gray border, and little or no shadow. Use interactive treatment only when the whole surface is clickable.
- Filters remain visible as removable selections once applied. Keep advanced filters grouped in one panel.
- Booking and payment summaries distinguish rental charges, fees, estimated taxes, optional protection, and security holds using the backend-provided amounts and states.
- Empty and loading states explain the next useful action without presenting fake data.

## Do's and Don'ts

- Do lead with the visitor's next task and keep renter and owner tools easy to find.
- Do use actual inventory and owner imagery where available.
- Do explain booking status and the action that is valid for that status.
- Do keep financial status text explicit and backend-driven.
- Don't invent marketplace inventory, fee calculations, refund outcomes, or reward capabilities.
- Don't use large metric tiles for information that does not help the current task.
- Don't scatter primary navigation across multiple unrelated menus.
- Don't add gradients, decorative badges, or repeated card grids without a clear job.
