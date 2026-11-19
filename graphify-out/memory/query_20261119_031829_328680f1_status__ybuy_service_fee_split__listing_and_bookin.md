---
type: "query"
date: "2026-11-19T03:18:29.604491+00:00"
question: "Status: YBuy service fee split, listing and booking net payable, points multiplier campaigns, and refund automation"
contributor: "graphify"
outcome: "useful"
source_nodes: ["ServiceFeeConfiguration", "ServiceFeeConfigurationSection", "fetchOwnerEarningsQuote", "CheckoutPointsPicker", "RewardCampaigns", "CancellationRefundsSection"]
---

# Q: Status: YBuy service fee split, listing and booking net payable, points multiplier campaigns, and refund automation

## Answer

Expanded from repository vocabulary: [admin, fee, service, owner, renter, earnings, daily, month, points, promotion, refund, payment]. Service fee: admin UI has a numeric total 0-30% and a 0-100% renter-share slider; owner receives the remainder; initial value is 10% renter-paid, so a desired 20-22% band is not enforced. Listing creation shows server-calculated owner net for 1, 7, and 30 rental days; the owner request card also shows expected net before approval. The earnings dashboard is cumulative (earned to date, transferred, upcoming/active), not a daily/weekly/monthly net-payable report. Points: base is configurable from 500, with admin signup campaigns at 1x, 1.5x, 2x, 2.5x, 3x and effective dates; campaign applies to verified signup only and remains test-only, not rental points. Refunds: cancellation and refund are distinct; configured automatic policies can submit Stripe refunds, while other cases go to review; provider confirmation determines completion. SQL graph coverage was unavailable because tree_sitter_sql is not installed; verify SQL directly.

## Outcome

- Signal: useful

## Source Nodes

- ServiceFeeConfiguration
- ServiceFeeConfigurationSection
- fetchOwnerEarningsQuote
- CheckoutPointsPicker
- RewardCampaigns
- CancellationRefundsSection