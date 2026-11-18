# YBuy – Complete Create Listing, Rental & Bidding Workflow

This is the recommended end-to-end product specification covering the owner listing process, AI photo moderation, listing approval, normal rentals, competitive bidding, renter experience, winner selection, and payment.

One important distinction: YBuy supports normal rentals and optional competitive bidding. Private Offers are excluded from the product scope.

Complete owner journey

1. Photos & AI moderation
2. Item details & AI-generated description
3. Rental settings & pricing
4. Availability & rental dates
5. Location, pickup & delivery
6. Competitive bidding configuration (optional)
7. Preview, validation & publish

# 1. Owner – Create Listing

## Step 1: Photos and AI moderation

[DeWalt DCD771 20V MAX Lithium-Ion 1/2" Cordless Drill Driver](https://images.openai.com/static-rsc-4/e7Z2dA3x-NtsEoQjDbUE4UpywiJqgQPQRZu-qNnluPgICWQr8j3o4UrxDcNUsE5kdFDQXN5MUhOk1M3_U9nywjY38JOG0RtjpvpCgVsyFuMqvq-F6awdnJoksyvq-Or3PW-R-jU_XzPpf3T2C0l3F4PKeIjPZjmXO15HFAj0mJg?purpose=inline)

[velio ▷ Gebrauchtes Fahrrad kaufen | Sofort verfügbar](https://images.openai.com/static-rsc-4/TpZYsJW_JLEBJYrhOqj6VJGJLYQB4eSrF5Bbt-xitCZYeLFMBOiR2bmmvXjg8FSrE9S1mIxEpECKWLVoXicqooMX_DOs6zpSWUEWp_1Lpsn-lZDKTkqcAokMyF9SLqDlB6R9FbOTZ9ecvRXjP6ihg-KLcd4SXaKUrRDTWQAL6y4?purpose=inline)

[Rent a Canon EOS R5 Mark II Video KIt](https://images.openai.com/static-rsc-4/wAoK2Y_UUKgAQ8gUEapHidmsq3moFPup8v15QcpCUZbIo8p2cb2wkCfrt_J27K65Z9rnnvueurVbi9F1K0p4mTgNXFJMSAAq3NKcX74BpOsXc0IgPV8S-zU5TSi6lZJoAwtJ4KfXnPHQZmMIwM79fXfXeinMNPm-BdvRetWBUF8?purpose=inline)

8

Photo upload requirements

| Setting                   | Rule                 |
| ------------------------- | -------------------- |
| Maximum photos            | 4                    |
| Maximum upload size       | 3 MB per photo       |
| Accepted formats          | JPEG, PNG, WebP      |
| Preferred storage format  | WebP                 |
| Maximum stored dimensions | 1600 px longest side |
| Target stored size        | 150–250 KB           |
| Minimum dimensions        | 320 px               |

AI photo moderation must check:

- Offensive, hateful, discriminatory, or abusive images.
- Nudity, explicit sexual content, and exploitative images.
- Graphic violence and gore.
- Illegal, prohibited, stolen, or counterfeit products.
- Phone numbers, email addresses, social media handles, QR codes, and personal information.
- Promotional banners, advertisements, and external links.
- Gibberish, irrelevant screenshots, memes, and spam.
- Misleading, manipulated, or unrelated stock photos.
- Blurry, corrupted, duplicate, or low-quality images.
- Hidden text or instructions attempting to manipulate AI moderation.

Photo processing workflow:

1. Owner uploads photos or takes live photos.
2. Validate file size, dimensions, MIME type, and actual file signature.
3. Run security scanning and AI image moderation.
4. Reject or flag prohibited images.
5. Identify the item and suggest its category.
6. Generate an AI title and description.
7. Allow the owner to edit the suggestions.
8. Run final content moderation before publishing.

AI must not automatically classify every ordinary tool or household item as illegal. Uncertain or high-risk cases go to admin review.

## Step 2: Item details

[UX/UI for Social Community Neighbours PWA App E-commerce Resale by Anna  (asol_design) on Dribbble](https://images.openai.com/static-rsc-4/kiVzhQFXm9JU1qPtCcWkz8Hfz4AxPTEs1RUXZmrBf32KiJ_wPGHZXOanEB4YU-fbWyE2qJhKzmYXx994m5Se7nSImHfr3txAHd762RmMgpGWSdXCcZo0MriPjceSpwcIk5PfH-FOE52gyZvxs1AhtcMYTv3PrX9quJmJpJ9_A5I?purpose=inline)

[dribbble.com](https://dribbble.com/shots/23848335-UX-UI-for-Social-Community-Neighbours-PWA-App-E-commerce-Resale?utm_source=chatgpt.com)

AI suggests the following fields based on the photos:

| Field                | Behavior                     |
| -------------------- | ---------------------------- |
| Listing title        | AI-generated, editable       |
| Category             | AI-suggested, owner confirms |
| Description          | AI-generated, editable       |
| Brand                | AI-detected, editable        |
| Model                | AI-detected, editable        |
| Item condition       | Owner selects                |
| Replacement value    | Owner enters                 |
| Included accessories | Owner enters                 |
| Usage instructions   | Optional                     |
| Safety instructions  | Optional                     |

Validation rules

- Title must be meaningful and relevant.
- Description must accurately represent the item.
- No gibberish, spam, misleading claims, or offensive language.
- No contact details or off-platform payment instructions.
- No prohibited products or illegal transactions.
- Prevent HTML/JavaScript injection and malicious payloads.
- Revalidate all owner-edited content.

## Step 3: Rental settings and pricing

[Tarification de la location d'équipement : Comment automatiser les tarifs quotidiens, hebdomadaires et mensuels - Booqable](https://images.openai.com/static-rsc-4/j982AJh9uDazkd-QNukdoLVmYH1gM36AvSCG3x4De5Z5BCuj_RsT-X_7F_8ZoChjdJduyN9WHcdw2nfGSzS8QiWfHVOHPlyK1HbV_-ILHSNhkQZYpopUNY5A9rqBRHiI6wAzBT-07U3JByBMeE3ZrTVTjgniM-LsqS0014H_8kI?purpose=inline)

[booqable.com](https://booqable.com/fr/blog/equipment-pricing-rental-rates/?utm_source=chatgpt.com)

Owner configures:

| Field                   | Description                           |
| ----------------------- | ------------------------------------- |
| Daily rental price      | Amount charged per rental day         |
| Replacement value       | Item replacement cost                 |
| Quantity                | Number of available units             |
| Minimum rental duration | Configurable                          |
| Maximum rental duration | 30 days                               |
| Booking preference      | Instant booking or owner approval     |
| Delivery                | Optional                              |
| Delivery fee            | Configurable, subject to global limit |
| Pickup                  | Available pickup method               |

Pricing and approval rules

- $0–$1,000: No admin approval required under the configured price policy.
- $1,000–$5,000: Admin review required.
- Above $5,000: Block listing submission under the configured policy.

Keep these thresholds configurable by Super Admin.

The listing must not become publicly bookable until all applicable approval requirements are satisfied.

Security and protection

- No separate security deposit by default.
- Default platform protection applies according to the configured protection policy.
- Replacement-value protection rules must be calculated consistently.
- Any owner/renter fees, insurance, taxes, and protection charges must be disclosed before checkout.

## Step 4: Availability and rental dates

[FlexCon Rental Booking, Hire - Manage event & equipment rental bookings. Rent out products. | Shopify App Store](https://images.openai.com/static-rsc-4/a532QlNtu3JEvg4xAbWkZe5VsnCq_rD8WpSqaLOQF35nT9j-x1xDgSsiLGOQYuYGmhTyQidyqtDpeljpnQ9ZJ8iJMBOJGBVpqACmYtL4iAjWqcbJ2MOquR5qlvFJ23DcKCQBRxVqRWz3-SUlMP07ob2KSsMr9yjgICQrT-C61Wk?purpose=inline)

[apps.shopify.com](https://apps.shopify.com/flexcon-product-rental-hire?utm_source=chatgpt.com)

Owner selects when the item is available.

Availability options

- Available immediately: Today.
- Available tomorrow: Next day.
- Available from a future date: Owner selects a date.

Rules

1. Owner must define valid availability dates.
2. Maximum rental duration is 30 days.
3. Allow future availability up to 90 days.
4. Prevent overlapping reservations.
5. Block dates for confirmed bookings.
6. Account for quantity and inventory.
7. Do not allow booking outside availability.
8. Do not allow bidding to close after the rental pickup cutoff.
9. Revalidate availability during checkout.
10. Notify owners about upcoming bookings and availability changes.

Important: Availability must be shared by normal rentals and bidding. Both must use the same inventory validation service.

## Step 5: Location, pickup and delivery

[Case study: Refining an established delivery service app | by Von Gonzaga | Bootcamp | Medium](https://images.openai.com/static-rsc-4/PKo5rB1uPGh94-qUDJVIxu9taM9XqOAMQARFyPygDPl9ZYwViJEisFT1jQMyixa4CxVItcF8P1sgeTxWUJCGks6ItO_TGjeS5bXNslkWLXK6zCpiHL0Cntj5a21lF8lEBj8gogNndFFka6LldQzGR-2SeOTHFCmB_83oqLTi8Ok?purpose=inline)

[medium.com](https://medium.com/design-bootcamp/lalamove-ui-ux-case-study-d8000c4415b1?utm_source=chatgpt.com)

Owner configures:

- Pickup location.
- Pickup instructions.
- Pickup availability.
- Delivery availability.
- Delivery fee.
- Delivery radius or coverage.
- Handoff preferences.

Privacy rules

- Do not publicly expose the owner's full residential address.
- Show an approximate location before booking.
- Share exact pickup details only with the confirmed renter, according to the handoff policy.

## Step 6: Bidding configuration (optional)

[Enjoy a better Timed Auction bidding experience | Ritchie Bros. Auctioneers](https://images.openai.com/static-rsc-4/ed0MCcSbRdBOxAAOrKBmmi1XoUKYuX8mVdm3F81n43eL9qCSKpPyomRzEomy0U7hrNVbpJU9mxiyIH9dIYnN1pgdFBKgPbfhcLlr26o1pe1s6mQg2mv2a5m9b6yGjBbaiTJYFTwZ9vjDERy8rXLjCS3yic7Wj4e-rI9y-qKd5Ls?purpose=inline)

[rbauction.com](https://www.rbauction.com/mp/timed-auction-experience?utm_source=chatgpt.com)

Owner chooses:

Normal rental – default

- Item is available for regular booking.
- Owner can choose instant booking or approval.
- No bidding required.

Enable competitive bidding – optional

When enabled, owner configures:

| Setting                 | Rule                        |
| ----------------------- | --------------------------- |
| Starting daily bid      | Owner-defined               |
| Minimum bid increment   | $1 per rental day           |
| Auction start           | Owner selects date/time     |
| Auction end             | Owner selects date/time     |
| Eligible rental dates   | Selected availability dates |
| Maximum rental duration | 30 days                     |
| Maximum bids per renter | 3                           |
| Auction extension       | 2 minutes                   |
| Maximum extension       | 10 minutes                  |

Important bidding configuration rules:

- Auction must close before the rental pickup cutoff.
- Bidding must be associated with specific rental dates.
- A renter bids on the daily rental price, not the entire rental amount.
- Owner must not be able to configure invalid dates or unavailable inventory.
- Bidding is optional and must be enabled explicitly by the owner.

## Step 7: Preview and publish

Before publishing, display:

- Photos.
- Item details.
- Rental price.
- Replacement value.
- Availability.
- Pickup and delivery details.
- Booking preference.
- Bidding status and rules.
- Applicable fees and protection information.

Run final validation:

- Photo moderation.
- Listing content moderation.
- Prohibited item checks.
- Price validation.
- Availability validation.
- Bidding configuration validation.
- Security validation.

Only eligible listings can be published.

# 2. Listing status and approval workflow

| Status       | Meaning                                 |
| ------------ | --------------------------------------- |
| Draft        | Owner is creating listing               |
| Submitted    | Owner submitted listing                 |
| Under Review | Admin or moderation review              |
| Approved     | Listing passed required approval        |
| Published    | Listing visible and available           |
| Paused       | Owner temporarily stopped listing       |
| Rejected     | Listing failed moderation or approval   |
| Deactivated  | Listing removed from active marketplace |

Important: Approved and Published are separate states. Passing moderation does not automatically mean the item is available for booking.

# 3. Renter – Normal rental flow

[Cleaner App Screen by Ekin Ayhan on Dribbble](https://images.openai.com/static-rsc-4/k3CpSoit6DmmalCUNMA9F_MMdCUEsUash20V3JceC_FZZ1TptC9VK4GB13xzNMHRcjxotaO5GVCJKdanGwuoLeT2X6xIJ78v_wLJHcavhkntuVoRDiLGFMfVUXUNMIVY_ElzgSKO7uemtKW0xIyuwOCWm2eFfifWPvZvRfUslXg?purpose=inline)

[dribbble.com](https://dribbble.com/shots/23542030-Cleaner-App-Screen?utm_source=chatgpt.com)

1. Renter searches or browses listings.
2. Opens item details.
3. Reviews photos, condition, description, owner rating, and replacement value.
4. Selects rental start and end dates.
5. System checks availability and quantity.
6. Renter selects pickup or delivery.
7. System calculates the complete rental price.
8. Renter reviews fees, taxes, and protection.
9. Renter submits booking.

If instant booking is enabled:

- System validates availability.
- Payment is completed.
- Booking is confirmed.

If owner approval is required:

- Booking request is sent to the owner.
- Owner accepts or declines.
- Renter completes payment after acceptance.
- Booking is confirmed only after successful payment.

# 4. Competitive bidding – Complete flow

## Step 1: Auction goes live

When the owner publishes a listing with bidding enabled:

- Auction becomes visible to eligible renters.
- Show starting bid.
- Show current highest bid.
- Show minimum next bid.
- Show auction countdown.
- Show eligible rental dates.
- Show anonymous bidding activity.

[Bidding UI by Four Fries on Dribbble](https://images.openai.com/static-rsc-4/_1aXAZiuOxopawH6hMMdHn-Ygx8LYL97sTIQY1GLyJnltGJoxsgccDmbdU9zBzmTWctAjTnQ2bIN47XTJg-cJZnEj20UtMxA3bkn1St2tCqRH5cBZ-2a1sduqI5pEM4MC4DcibqkZpbEaiAs89Oj2tyBCDoayJOTL9l6jVuVfsw?purpose=inline)

[dribbble.com](https://dribbble.com/shots/6989017-Bidding-UI?utm_source=chatgpt.com)

## Step 2: Renter places a bid

Renter sees:

| Information             | Visibility                                |
| ----------------------- | ----------------------------------------- |
| Starting bid            | Visible                                   |
| Current highest bid     | Visible                                   |
| Minimum next bid        | Visible                                   |
| Countdown timer         | Visible                                   |
| Top 3 bids              | Anonymous                                 |
| Other renter identities | Hidden                                    |
| Owner identity          | According to normal listing privacy rules |

Bidding rules

1. Maximum 3 bids per renter per auction.
2. Minimum new bid must be at least $1/day above the current highest bid.
3. Renter can only bid before auction closure.
4. Bids must be valid for the selected rental dates.
5. Bidding does not charge the renter.
6. Only a successfully paid booking confirms the reservation.
7. Renters cannot see other bidders' identities.
8. Display the top 3 bids anonymously.
9. Keep timestamped bid history.
10. Reject duplicate, invalid, manipulated, or late bids.

## Step 3: Auction extension

Prevent last-second bidding manipulation.

Extension rules:

- If a valid bid arrives in the final 2 minutes, extend the auction by 2 minutes.
- Every qualifying last-minute bid can trigger another extension.
- Maximum total extension is 10 minutes.
- Auction cannot extend beyond the rental pickup cutoff.
- Once the auction closes, reject all new bids.

Example:

Auction countdown example

Original closing time

10:00 PM

Bid arrives at

9:59 PM

New closing time

10:02 PM

Further extensions

Up to 10 minutes total

## Step 4: Owner reviews bidders

[Bidout - Multivendor Auction & Bidding Platform by egenslab | CodeCanyon](https://images.openai.com/static-rsc-4/9lAcfYc7OfNis9QWVVIIIKQrBvxL4uf20KH6Lz7aAXs-usr_T5EBIZUDoGNCxjQWRZSMfWEIr9DWqkJ7QxdH7ThYsPxTP7ejQxNXAW6m7L_bdI5GH0hYeWkzflhPVE8V0NkaVKwRObcwzah6_VyniMpsAA82ZrdXsOWYgSS5PQQ?purpose=inline)

[codecanyon.net](https://codecanyon.net/item/bidout-multivendor-auction-bidding-platform/50229471?utm_source=chatgpt.com)

Owner sees:

- Bidder name.
- Profile.
- Rating and reviews.
- Location.
- Bid amount.
- Bid history.
- Number of bids.
- Verification status.

Renter identities remain anonymous to other renters, but are visible to the owner.

Owner can:

- Select any eligible bidder, not necessarily the highest.
- Review bidder profiles.
- Accept a bidder.
- Allow the system to automatically select the highest eligible bidder if no decision is made within one hour.

The selection must be recorded with timestamp and reason where required.

## Step 5: Winner selection

After auction closes:

1. Stop accepting bids.
2. Validate all bids.
3. Exclude ineligible bidders.
4. Owner has one hour to select an eligible bidder.
5. If owner does not select anyone within one hour, automatically select the highest eligible bidder.
6. Notify the selected renter.
7. Start the payment deadline.

## Step 6: Winner payment

[Property Booking App – Short-Term Rental Mobile UI by Zorg IT Group on Dribbble](https://images.openai.com/static-rsc-4/7FTkKK9udmycwS5Ekj5MLiGQQ-ANeFWUY8bP98jjSqe4XQL2rxbFw3w2ZXDrGzWf6qNqO7NV4c4cW7v6zdCDzXxzVUaoZSQUqrLTOewJSjWo5M6Y12_4sMWW5-RYCtqfq9OeAU1ojlGi2KrjJVgO6oLmJ_4EmeLDOt3XMlfOJIY?purpose=inline)

[dribbble.com](https://dribbble.com/shots/26490827-Property-Booking-App-Short-Term-Rental-Mobile-UI?utm_source=chatgpt.com)

Payment rules

- Selected renter has one hour to complete payment.
- Bidding itself does not charge the renter.
- The booking is not confirmed until payment succeeds.
- Display rental charges, platform fees, applicable taxes, protection, and delivery fees.
- Lock the inventory during the winner's payment window to prevent double booking.

If the selected renter does not pay:

1. Mark the selection as expired.
2. Notify the owner.
3. Move to the next eligible bidder.
4. Give the next renter the configured payment window.
5. Continue until an eligible bidder pays or the auction has no eligible bidders remaining.
6. If nobody completes payment, release the inventory and reopen regular booking or allow the owner to relist.

Payment windows and fallback behavior should be configurable by Super Admin.

# 5. Regular booking while bidding is active

This is an important business rule.

An owner may still receive a normal booking while an auction is running.

Rules:

1. Regular booking must pass the same availability and inventory checks.
2. Once a regular booking is successfully confirmed, overlapping auction availability must be closed or invalidated.
3. Notify all affected bidders that the auction has ended.
4. Reject further bids.
5. Do not allow both a regular booking and a winning bid to reserve the same inventory for overlapping dates.
6. If the listing has multiple units, bidding and regular bookings can continue only when inventory is sufficient.

# 6. Notifications

| Event                      | Recipient                 |
| -------------------------- | ------------------------- |
| Listing submitted          | Owner                     |
| Listing approved/rejected  | Owner                     |
| Listing published          | Owner                     |
| New bid received           | Owner                     |
| Owner receives bid summary | Owner                     |
| Bid placed successfully    | Renter                    |
| Someone outbids renter     | Renter                    |
| Auction extended           | Participating renters     |
| Auction ending soon        | Participating renters     |
| Auction closed             | Owner and renters         |
| Winner selected            | Selected renter           |
| Payment deadline reminder  | Selected renter           |
| Payment successful         | Owner and renter          |
| Payment expired            | Owner and affected renter |
| Next bidder selected       | Next renter               |
| Auction cancelled          | All participants          |

Use separate sections for bidding notifications and regular booking notifications. Keep unread indicators and timestamped activity history.

# 7. Important security and abuse prevention

Implement these protections across listing creation and bidding:

- Backend authorization for every owner and renter action.
- Prevent IDOR and unauthorized access to other users' listings or bids.
- Prevent SQL injection using parameterized queries and ORM-safe operations.
- Prevent XSS through input validation and output encoding.
- Prevent CSRF where applicable.
- Validate all uploaded files and scan for malicious content.
- Prevent prompt injection in images and AI-generated content.
- Never trust frontend-calculated prices or bid amounts.
- Calculate all charges on the backend.
- Use atomic database transactions for bid placement, auction closure, inventory reservation, and booking confirmation.
- Use server-side timestamps for bidding deadlines.
- Prevent race conditions and duplicate payments.
- Add rate limits to listing creation, uploads, and bidding.
- Maintain immutable bid and payment audit records.
- Prevent owners from placing fake bids on their own listings.
- Detect suspicious accounts, bid manipulation, and repeated abuse.

# 8. Core database entities

Suggested logical entities:

| Entity              | Purpose                                   |
| ------------------- | ----------------------------------------- |
| Listings            | Main item information                     |
| ListingPhotos       | Photo metadata and storage keys           |
| ListingModeration   | AI and admin moderation results           |
| ListingPricing      | Daily price and replacement value         |
| ListingAvailability | Available dates and inventory             |
| ListingLocations    | Pickup and delivery details               |
| Auctions            | Auction settings and status               |
| AuctionBids         | Bid amounts, renter IDs, timestamps       |
| AuctionSelections   | Owner/system winner selection             |
| Bookings            | Confirmed rental reservations             |
| BookingPayments     | Payment status and transaction references |
| Notifications       | User notifications                        |
| ModerationAudit     | Moderation history                        |
| ListingAudit        | Listing changes and status history        |

# 9. Complete renter and owner lifecycle

Owner lifecycle

1. Upload photos
2. AI moderation and item identification
3. Edit AI-generated listing details
4. Set price and rental settings
5. Set availability
6. Configure pickup and delivery
7. Enable or disable bidding
8. Submit for review and publish
9. Manage bookings and bids
10. Prepare item for pickup
11. Complete pickup handoff
12. Complete return handoff
13. Receive payout and review renter

Renter lifecycle

1. Search and browse items
2. Review item details and owner profile
3. Select dates
4. Book normally or participate in bidding
5. Complete payment
6. Receive booking confirmation
7. Coordinate pickup
8. Complete pickup handoff and OTP verification
9. Use the rented item
10. Complete return handoff and OTP verification
11. Upload return photos
12. Submit rating and review

# 10. Super Admin configurable settings

Do not hardcode business rules that may change.

| Configuration                     | Default      |
| --------------------------------- | ------------ |
| Maximum photos                    | 4            |
| Maximum photo upload              | 3 MB         |
| Maximum rental duration           | 30 days      |
| Future availability horizon       | 90 days      |
| Maximum bids per renter           | 3            |
| Minimum bid increment             | $1/day       |
| Last-minute extension trigger     | 2 minutes    |
| Extension duration                | 2 minutes    |
| Maximum auction extension         | 10 minutes   |
| Owner selection window            | 1 hour       |
| Winner payment window             | 1 hour       |
| Maximum delivery fee              | $100         |
| Listing price thresholds          | Configurable |
| Moderation thresholds             | Configurable |
| Platform fees                     | Configurable |
| Protection and insurance settings | Configurable |

# 11. Implementation instructions for the coding agent

# YBuy – Complete Listing Creation, Rental and Competitive Bidding Implementation Specification

## Objective

Implement a complete, secure, mobile-first peer-to-peer rental marketplace workflow covering owner listing creation, AI-assisted photo moderation, listing approval, rental settings, availability, normal bookings, optional competitive bidding, winner selection, checkout, and booking confirmation.

## A. Owner listing wizard

Implement these steps in this exact order:

1. Photos
2. Item Details
3. Rental Settings
4. Availability
5. Location & Pickup
6. Bidding Configuration (optional)
7. Preview & Publish

### Photos

- Maximum 4 photos per listing.
- Maximum upload size 3 MB per photo.
- Accept JPEG, PNG, WebP.
- Minimum dimensions 320 px.
- Convert approved photos to WebP.
- Maximum processed dimension 1600 px.
- Target stored image size 150–250 KB.
- Generate 320 px thumbnails.
- Strip EXIF and GPS metadata.
- Store images in object storage, not database BLOBs.
- Delete temporary originals after successful processing.
- Validate actual file content, not only file extension.
- Reject corrupted, malicious, unsupported, or oversized files.

### Photo moderation

Run moderation on every uploaded photo.

Detect:

- Offensive, hateful, discriminatory content.
- Nudity and explicit sexual content.
- Graphic violence and gore.
- Illegal, prohibited, stolen, and counterfeit products.
- Personal information and private documents.
- Phone numbers, email addresses, social handles, QR codes.
- Advertisements, external links, and promotional banners.
- Gibberish, spam, irrelevant screenshots, and memes.
- Misleading, manipulated, and unrelated images.
- Duplicate, blurry, dark, or corrupted images.
- Suspicious hidden text or AI prompt-injection attempts.

Reject prohibited images. Request replacement for low-quality or privacy-sensitive images. Route uncertain or high-risk cases to human review.

### AI item identification and generation

After photo moderation:

- Identify item and category.
- Suggest title.
- Generate description.
- Suggest brand and model where confidently identifiable.
- Allow owner to edit all generated fields.
- Never invent specifications or condition claims.
- Clearly distinguish AI suggestions from owner-confirmed information.

Re-moderate the final edited title, description, and photos before publication.

### Item details

Collect:

- Title.
- Category.
- Description.
- Brand.
- Model.
- Condition.
- Replacement value.
- Included accessories.
- Optional usage and safety instructions.

Prevent gibberish, misleading content, prohibited items, contact details, off-platform payment instructions, HTML/JavaScript injection, and malicious input.

### Rental settings

Collect:

- Daily rental price.
- Replacement value.
- Quantity.
- Minimum rental duration.
- Maximum rental duration.
- Booking mode: instant booking or owner approval.
- Delivery availability.
- Delivery price.

Maximum rental duration: 30 days.

Use existing configured listing price thresholds:

- $0–$1,000: no admin approval.
- $1,000–$5,000: admin review.
- Above $5,000: block submission.

Keep thresholds configurable through Super Admin. Do not publish a listing until all required approvals are complete.

Apply existing platform fees, taxes, insurance, and protection configuration. Do not introduce a separate security deposit by default.

### Availability

Support:

- Immediate availability (today).
- Next-day availability.
- Future availability (selected date).

Rules:

- Future availability up to 90 days.
- Maximum rental duration 30 days.
- Start date must precede end date.
- Validate existing bookings and inventory.
- Block confirmed reservations.
- Prevent overlapping bookings when inventory is insufficient.
- Revalidate availability during checkout.
- Use the same availability and inventory service for regular bookings and auctions.

### Location and pickup

Collect pickup location and instructions, delivery availability, delivery fee, and coverage.

Do not expose the owner's exact residential address publicly. Reveal exact pickup information only to the confirmed renter according to the handoff policy.

## B. Listing publication and moderation

Maintain these statuses:

Draft, Submitted, Under Review, Approved, Published, Paused, Rejected, Deactivated.

Do not confuse Approved with Published.

Publication requires:

- Valid photos.
- Passed moderation.
- Valid listing details.
- Valid pricing.
- Valid availability.
- Valid location.
- Valid bidding configuration if enabled.
- All applicable admin approvals.

Provide actionable rejection reasons and allow owners to replace rejected photos or edit rejected content without restarting the wizard.

## C. Normal rental workflow

Renter:

1. Search and open listing.
2. Review photos, item details, owner rating, condition, and pricing.
3. Select rental dates.
4. Select pickup or delivery.
5. Check availability.
6. Review item price, fees, taxes, and protection.
7. Submit booking.

Instant booking:

- Validate availability.
- Process payment.
- Confirm booking only after successful payment.

Owner approval:

- Send booking request to owner.
- Owner accepts or declines.
- If accepted, allow renter to complete checkout.
- Confirm booking only after successful payment.

## D. Competitive bidding

Bidding is optional and explicitly enabled by the owner.

Owner configures:

- Starting daily bid.
- Auction start and end date/time.
- Eligible rental dates.
- Minimum increment.
- Available inventory.

Default bidding rules:

- Maximum 3 bids per renter.
- Minimum next bid is $1/day above current highest bid.
- Bidding is based on daily rental price.
- Bidding itself does not charge the renter.
- Display top 3 bids anonymously.
- Renters cannot see bidder identities.
- Owner can see bidder profiles, names, ratings, locations, and bid history.
- Maintain timestamped bid history.
- Reject invalid, duplicate, late, or unauthorized bids.
- Use server-side timestamps and calculations.

### Auction extension

- A valid bid received in the final 2 minutes extends closing by 2 minutes.
- Maximum total extension is 10 minutes.
- Never extend beyond the rental pickup cutoff.
- Reject bids after final closure.

### Winner selection

- Close auction and validate bids.
- Owner has 1 hour to choose an eligible bidder.
- Owner may select any eligible bidder, not necessarily the highest.
- If owner does not decide within one hour, automatically select the highest eligible bidder.
- Record owner/system selection and timestamp.
- Notify selected renter.

### Winner payment

- Selected renter has 1 hour to pay.
- Lock relevant inventory during the payment window.
- Do not confirm the booking until payment succeeds.
- On payment expiry, mark selection expired.
- Move to the next eligible bidder and notify them.
- Continue according to configured fallback policy.
- If no bidder pays, release inventory and make it available for normal booking or relisting.

Make payment windows and fallback policy configurable.

## E. Normal booking during an active auction

Allow normal booking while bidding is active only if inventory permits.

After a successful overlapping regular booking:

- Recalculate inventory.
- Close or invalidate affected auction availability.
- Notify bidders.
- Reject further bids for unavailable dates.
- Never allow overlapping confirmed reservations beyond available quantity.

For multiple units, continue only when sufficient inventory remains.

## F. Notifications

Support notifications for:

- Listing submission and moderation.
- Approval, rejection, and publication.
- New bids.
- Outbid events.
- Auction extensions.
- Auction ending soon.
- Auction closure.
- Winner selection.
- Payment reminders and expiry.
- Next bidder selection.
- Booking confirmation and cancellation.

Keep bidding notifications separate from regular booking notifications. Include unread status and timestamps.

## G. Security

Implement:

- Backend authorization for every operation.
- Parameterized SQL and safe ORM queries.
- XSS prevention and output encoding.
- CSRF protection where applicable.
- IDOR prevention.
- File signature validation and malware scanning.
- Prompt-injection defenses.
- Rate limiting and abuse detection.
- Server-side price and fee calculations.
- Server-side bid validation.
- Atomic database transactions.
- Concurrency and race-condition protection.
- Idempotent payment operations.
- Immutable bid and payment audit logs.
- Owner self-bidding prevention.
- Protection against duplicate bookings and payments.

Never trust client-calculated amounts, auction timestamps, owner permissions, or inventory.

## H. Database architecture

Use logical entities for:

- Listings.
- ListingPhotos.
- ListingModeration.
- ListingPricing.
- ListingAvailability.
- ListingLocations.
- Auctions.
- AuctionBids.
- AuctionSelections.
- Bookings.
- BookingPayments.
- Notifications.
- ModerationAudit.
- ListingAudit.

Use database transactions and unique constraints where necessary to enforce inventory, bid, and payment consistency.

## I. Super Admin configuration

Make these settings configurable:

- Photo count and upload limits.
- Image optimization settings.
- Listing price approval thresholds.
- Moderation rules and thresholds.
- Rental duration.
- Availability horizon.
- Bid limits and increments.
- Auction extension rules.
- Owner decision window.
- Winner payment window.
- Delivery fee limit.
- Platform fees.
- Taxes, protection, and insurance.

## J. Required testing

Create automated tests for:

- Photo count and size validation.
- Unsupported and malicious file uploads.
- Photo moderation and replacement.
- AI title and description moderation.
- Listing price thresholds.
- Date validation and inventory conflicts.
- Normal instant booking.
- Owner approval booking.
- Maximum three bids per renter.
- Minimum bid increment.
- Last-minute auction extensions.
- Auction closing and late bid rejection.
- Owner selection of a non-highest eligible bidder.
- Automatic highest-bidder selection after one hour.
- Winner payment expiry and fallback.
- Concurrent bidding.
- Concurrent booking and bidding.
- Duplicate payment and booking prevention.
- Authorization and SQL injection.
- XSS, IDOR, CSRF, and API abuse.

## K. UX requirements

- Mobile-first, responsive design.
- Simple step-by-step listing wizard.
- Autosave drafts and preserve progress.
- Clear validation and actionable errors.
- Show photo upload and moderation progress.
- Show bidding countdown, current bid, minimum next bid, and anonymous top 3.
- Separate owner and renter bidding interfaces.
- Provide clear booking and payment states.
- Avoid unnecessary steps and duplicate information.

## Final acceptance criteria

A listing cannot be published unless it passes required moderation and validation.

A booking cannot be confirmed without successful payment.

A bid cannot exceed the configured rules or be accepted after auction closure.

A confirmed booking cannot exceed available inventory.

All financial, bidding, moderation, and authorization decisions must be enforced by the backend, not merely by the UI.

Implementation priority: Build the listing wizard and shared availability/inventory engine first. Then normal booking and payment. Add competitive bidding on top of the same listing and inventory services. This avoids building two separate booking systems that can accidentally reserve the same item.