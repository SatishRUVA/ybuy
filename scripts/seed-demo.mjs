// Populates the DB with a realistic demo catalog + personalized content (bookings, reviews,
// messages, favorites) for every real signed-in profile, so the app looks fully populated for a
// demo. Runs automatically before `pnpm run dev` (see package.json). When DEMO_MODE=true it
// idempotently seeds the demo data; when DEMO_MODE is not 'true' it tears down any previously
// seeded demo data (so toggling the flag off actually removes the demo content, not just skips
// re-seeding it).
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  AVATARS, CATEGORY_ITEMS, CITIES, CONDITION_NOTES, MESSAGE_THREADS, PERSON_NAMES, REVIEW_TEXTS, VARIANTS,
} from './demo-catalog.mjs';

const url = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.warn('[seed-demo] VITE_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are missing — skipping.');
  process.exit(0);
}

const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
let supportsListingFeatureColumns = true;

// Total published demo listings to keep in the catalog (hand-written CATALOG items included).
const TARGET_LISTINGS = Math.max(0, Number(process.env.DEMO_LISTING_COUNT ?? 1000));
const CATEGORY_NAMES = Object.keys(CATEGORY_ITEMS);

async function teardown() {
  const { data: demoProfiles, error } = await db.from('profiles').select('id').ilike('email', '%@ybuy.demo');
  if (error) throw error;
  const demoIds = (demoProfiles ?? []).map((p) => p.id);
  if (demoIds.length === 0) return; // nothing was ever seeded

  console.log('[seed-demo] DEMO_MODE is not true — removing previously seeded demo data...');

  // Conversations/messages referencing demo accounts (must go before bookings/listings, which
  // conversations reference without ON DELETE CASCADE). Split into two `in` filters rather than a
  // combined `or` — with dozens of demo ids the combined filter makes the request URL huge.
  await db.from('conversations').delete().in('participant_one', demoIds);
  await db.from('conversations').delete().in('participant_two', demoIds);

  // Bookings involving a demo account either as renter or owner (cascades payments + reviews + payouts).
  await db.from('bookings').delete().in('renter_id', demoIds);
  await db.from('bookings').delete().in('owner_id', demoIds);

  // The real users' own seed-created listings (owned by real users, so not covered below).
  await db.from('listings').delete().in('title', REAL_OWNER_LISTING_TITLES);

  // The demo catalog itself (cascades listing_images/listing_availability/favorites).
  await db.from('listings').delete().in('owner_id', demoIds);

  // The synthetic auth accounts (cascades their profiles row).
  for (const id of demoIds) {
    await db.auth.admin.deleteUser(id);
  }

  console.log('[seed-demo] Demo data removed.');
}

const OWNER_NAME_INDEXES = [0, 1, 2, ...Array.from({ length: 21 }, (_, i) => 4 + i)];
const RENTER_NAME_INDEXES = [3, ...Array.from({ length: 11 }, (_, i) => 25 + i)];

const seedIdentity = (prefix, nameIdx, i) => ({
  email: `${prefix}-${i + 1}@ybuy.demo`,
  name: PERSON_NAMES[nameIdx],
  avatar: AVATARS[nameIdx % AVATARS.length],
});

// demo-owner-1..3 / demo-renter-1 keep their original names + avatars so previously seeded rows stay stable.
const OWNER_SEEDS = OWNER_NAME_INDEXES.map((nameIdx, i) => seedIdentity('demo-owner', nameIdx, i));
const RENTER_SEEDS = RENTER_NAME_INDEXES.map((nameIdx, i) => seedIdentity('demo-renter', nameIdx, i));

// Listings the seed creates under a REAL user's account (so their Owner Dashboard has content).
// Teardown removes exactly these titles — keep the list in sync with REAL_OWNER_LISTINGS below.
const REAL_OWNER_LISTING_TITLES = [
  'Craftsman Table Saw',
  'Weber Genesis Gas Grill',
  'Canon EOS R8 + 24-105mm Lens',
  'Pressure Washer 3000 PSI',
  'Folding Tables & Chairs Set (Party Pack)',
  'Roof Cargo Box + Crossbars',
];

// title/description/images/price copied from the prototype's original mock catalog (src/data.ts)
// so the demo uses the same vetted, already-working stock photos.
const CATALOG = [
  { title: 'Sony A7 IV Mirrorless Camera', category: 'Electronics', price: 85, deposit: 500, ownerIdx: 0, location: 'Irving, TX', lat: 32.814, lng: -96.949,
    description: 'Full-frame 33MP mirrorless camera with 4K60p video. Includes versatile 24–70mm f/2.8 lens.',
    images: ['https://images.pexels.com/photos/19969452/pexels-photo-19969452.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop', 'https://images.pexels.com/photos/19969445/pexels-photo-19969445.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop'] },
  { title: 'DeWalt 20V Cordless Drill Kit', category: 'Tools & Equipment', price: 25, deposit: 100, ownerIdx: 1, location: 'Dallas, TX', lat: 32.78, lng: -96.8,
    description: 'Professional-grade cordless drill with two 20V batteries, charger, and a full set of bits.',
    images: ['https://images.pexels.com/photos/30413428/pexels-photo-30413428.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop', 'https://images.pexels.com/photos/6790821/pexels-photo-6790821.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop'] },
  { title: '4K Ultra Short Throw Projector', category: 'Electronics', price: 60, deposit: 400, ownerIdx: 2, location: 'Irving, TX', lat: 32.81, lng: -96.94,
    description: 'Bright 4K short-throw projector, perfect for movie nights and presentations.',
    images: ['https://images.pexels.com/photos/5515482/pexels-photo-5515482.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop'] },
  { title: '4-Person Camping Tent + Sleeping Bags', category: 'Outdoor & Camping', price: 35, deposit: 150, ownerIdx: 0, location: 'Las Colinas, TX', lat: 32.88, lng: -96.95,
    description: 'Waterproof 4-person dome tent with rain fly. Includes 4 sleeping bags and pads.',
    images: ['https://images.pexels.com/photos/2526025/pexels-photo-2526025.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop'] },
  { title: 'Round Banquet Tables (10) + Chairs (80)', category: 'Party & Events', price: 120, deposit: 300, ownerIdx: 1, location: 'Dallas, TX', lat: 32.78, lng: -96.85,
    description: 'Complete party setup: 10 round 60" banquet tables and 80 padded chairs.',
    images: ['https://images.pexels.com/photos/35985211/pexels-photo-35985211.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop'] },
  { title: 'Trek Full Suspension Mountain Bike', category: 'Sports & Fitness', price: 45, deposit: 600, ownerIdx: 2, location: 'Irving, TX', lat: 32.82, lng: -96.92,
    description: 'Trek Fuel EX 8, full suspension trail bike, size L. Helmet and lock included.',
    images: ['https://images.pexels.com/photos/36450314/pexels-photo-36450314.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop'] },
  { title: 'Self-Propelled Lawn Mower', category: 'Home & Garden', price: 30, deposit: 150, ownerIdx: 0, location: 'Coppell, TX', lat: 32.95, lng: -96.99,
    description: 'Honda self-propelled mower with bagging and mulching options. 21" cutting deck.',
    images: ['https://images.pexels.com/photos/37554739/pexels-photo-37554739.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop'] },
  { title: 'BOB Revolution Stroller + Car Seat', category: 'Other', price: 15, deposit: 100, ownerIdx: 1, location: 'Irving, TX', lat: 32.83, lng: -96.95,
    description: 'BOB Revolution jogging stroller with infant car seat adapter. Clean and safety-checked.',
    images: ['https://images.pexels.com/photos/5997705/pexels-photo-5997705.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop'] },
  { title: 'Fender Stratocaster + Boss Katana Amp', category: 'Other', price: 40, deposit: 400, ownerIdx: 2, location: 'Dallas, TX', lat: 32.79, lng: -96.84,
    description: 'American Professional Stratocaster with Boss Katana 100W amp, cable, strap, and gig bag.',
    images: ['https://images.pexels.com/photos/35486274/pexels-photo-35486274.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop'] },
  { title: 'Pioneer DDJ-1000 DJ Controller', category: 'Party & Events', price: 75, deposit: 350, ownerIdx: 0, location: 'Plano, TX', lat: 33.02, lng: -96.7,
    description: 'Professional 4-channel DJ controller with full-size jog wheels, Rekordbox compatible.',
    images: ['https://images.pexels.com/photos/1481316/pexels-photo-1481316.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop'] },
  { title: 'Meta Quest 3 VR Headset (128GB)', category: 'Electronics', price: 30, deposit: 150, ownerIdx: 1, location: 'Irving, TX', lat: 32.81, lng: -96.95,
    description: 'Meta Quest 3 with controllers and silicone face cover. Pre-loaded with popular games.',
    images: ['https://images.pexels.com/photos/36812934/pexels-photo-36812934.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop'] },
  { title: 'KitchenAid Stand Mixer + Attachments', category: 'Home & Garden', price: 20, deposit: 150, ownerIdx: 2, location: 'Irving, TX', lat: 32.84, lng: -96.93,
    description: 'KitchenAid Artisan 5-qt stand mixer with paddle, whisk, dough hook, and pasta roller.',
    images: ['https://images.pexels.com/photos/6996340/pexels-photo-6996340.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop'] },
  { title: 'RadWagon Electric Cargo E-Bike', category: 'Vehicles', price: 40, deposit: 300, ownerIdx: 2, location: 'Plano, TX', lat: 33.01, lng: -96.69,
    description: 'Electric cargo e-bike with pedal assist and a 45-mile range. Helmet and heavy-duty lock included.',
    images: ['https://images.pexels.com/photos/36450314/pexels-photo-36450314.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop'] },
];
const REAL_OWNER_LISTINGS = [
  { title: 'Craftsman Table Saw', category: 'Tools & Equipment', price: 30, deposit: 150, status: 'published', location: 'Irving, TX', lat: 32.85, lng: -96.96,
    description: 'Sturdy 10" table saw, great for cabinetry and framing projects.',
    image: 'https://images.pexels.com/photos/6790821/pexels-photo-6790821.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop' },
  { title: 'Weber Genesis Gas Grill', category: 'Home & Garden', price: 35, deposit: 150, status: 'published', location: 'Coppell, TX', lat: 32.95, lng: -96.99,
    description: 'Three-burner gas grill with a side burner, cover, and cleaned grates. Tank not included.',
    image: 'https://images.pexels.com/photos/6996344/pexels-photo-6996344.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop' },
  { title: 'Canon EOS R8 + 24-105mm Lens', category: 'Electronics', price: 72, deposit: 450, status: 'published', location: 'Dallas, TX', lat: 32.78, lng: -96.8,
    description: 'Lightweight full-frame body with a versatile 24–105mm zoom, two batteries, and a 128GB card.',
    image: 'https://images.pexels.com/photos/19969445/pexels-photo-19969445.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop' },
  { title: 'Pressure Washer 3000 PSI', category: 'Tools & Equipment', price: 38, deposit: 200, status: 'published', location: 'Las Colinas, TX', lat: 32.88, lng: -96.95,
    description: 'Gas pressure washer with four nozzles, surface cleaner, and 50 ft of hose.',
    image: 'https://images.pexels.com/photos/30413424/pexels-photo-30413424.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop' },
  { title: 'Folding Tables & Chairs Set (Party Pack)', category: 'Party & Events', price: 55, deposit: 200, status: 'published', location: 'Plano, TX', lat: 33.02, lng: -96.7,
    description: 'Six 6-foot folding tables and 40 folding chairs with dollies for easy loading.',
    image: 'https://images.pexels.com/photos/35985211/pexels-photo-35985211.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop' },
  { title: 'Roof Cargo Box + Crossbars', category: 'Vehicles', price: 20, deposit: 140, status: 'draft', location: 'Irving, TX', lat: 32.81, lng: -96.95,
    description: 'Aerodynamic 18 cu ft roof box with crossbars and keys. Still writing up the pickup details.',
    image: 'https://images.pexels.com/photos/30413428/pexels-photo-30413428.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop' },
];

const round2 = (n) => Math.round(n * 100) / 100;

function isoDateOffset(daysFromToday) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + daysFromToday);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function seedListingAvailability(listingId, seedOffset = 0) {
  const rows = [];
  for (let i = 0; i < 45; i++) {
    const date = isoDateOffset(i + 1);
    const d = new Date(date);
    const dow = d.getDay();
    const blocked = ((i + seedOffset) % 11 === 0) || (dow === 0 && (i + seedOffset) % 2 === 0);
    if (blocked) rows.push({ listing_id: listingId, date, is_available: false });
  }
  if (rows.length === 0) return;
  const { error } = await db.from('listing_availability').upsert(rows, { onConflict: 'listing_id,date' });
  if (error) throw error;
}

function priced(dailyRate, days, deposit) {
  const subtotal = round2(dailyRate * days);
  const service_fee_pct = 0.1;
  const service_fee_amount = round2(subtotal * service_fee_pct);
  const total = round2(subtotal + service_fee_amount + deposit);
  return { subtotal, service_fee_pct, service_fee_amount, total };
}

function buildListingPatch(item, featureSeed) {
  const base = {
    description: item.description,
    price_per_day: item.price,
    deposit: item.deposit,
    location_lat: item.lat,
    location_lng: item.lng,
    location_label: item.location,
    status: 'published',
  };
  if (!supportsListingFeatureColumns) return base;
  return {
    ...base,
    instant_booking: featureSeed % 3 !== 0,
    protection_eligible: featureSeed % 2 === 0,
    delivery_available: featureSeed % 4 === 0,
    owner_verified: true,
  };
}

async function updateListingWithFallback(listingId, patch) {
  let { error } = await db.from('listings').update(patch).eq('id', listingId);
  if (error && supportsListingFeatureColumns && /instant_booking|protection_eligible|delivery_available|owner_verified/.test(error.message)) {
    supportsListingFeatureColumns = false;
    const fallbackPatch = { ...patch };
    delete fallbackPatch.instant_booking;
    delete fallbackPatch.protection_eligible;
    delete fallbackPatch.delivery_available;
    delete fallbackPatch.owner_verified;
    ({ error } = await db.from('listings').update(fallbackPatch).eq('id', listingId));
  }
  if (error) throw error;
}

async function insertListingWithFallback(row) {
  let { data, error } = await db.from('listings').insert(row).select('id').single();
  if (error && supportsListingFeatureColumns && /instant_booking|protection_eligible|delivery_available|owner_verified/.test(error.message)) {
    supportsListingFeatureColumns = false;
    const fallbackRow = { ...row };
    delete fallbackRow.instant_booking;
    delete fallbackRow.protection_eligible;
    delete fallbackRow.delivery_available;
    delete fallbackRow.owner_verified;
    ({ data, error } = await db.from('listings').insert(fallbackRow).select('id').single());
  }
  if (error) throw error;
  return data;
}

async function insertBooking({ listingId, renterId, ownerId, dailyRate, deposit, startDate, endDate, status }) {
  const days = Math.round((new Date(endDate) - new Date(startDate)) / 86400000);
  const p = priced(dailyRate, days, deposit);
  const { data, error } = await db.from('bookings').insert({
    listing_id: listingId, renter_id: renterId, owner_id: ownerId, start_date: startDate, end_date: endDate,
    quantity: 1, status, daily_rate: dailyRate, days, deposit, ...p,
  }).select('id, total').single();
  if (error) throw error;
  return data;
}

async function getOrCreateUser(seed) {
  const { data: existing } = await db.from('profiles').select('id').eq('email', seed.email).maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await db.auth.admin.createUser({
    email: seed.email, email_confirm: true, user_metadata: { full_name: seed.name, avatar_url: seed.avatar },
  });
  if (error) throw error;
  return data.user.id;
}

// ─── Bulk catalog generator (DEMO_MODE only) ─────────────────────────────────

async function insertChunked(table, rows, chunkSize = 500) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const { error } = await db.from(table).insert(rows.slice(i, i + chunkSize));
    if (error) throw error;
  }
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function fetchDemoListingTitles(ownerIds) {
  const titles = new Set();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db.from('listings').select('title').in('owner_id', ownerIds).range(from, from + pageSize - 1);
    if (error) throw error;
    for (const row of data) titles.add(row.title);
    if (data.length < pageSize) break;
  }
  return titles;
}

// Deterministic per-index generation: re-running the seed produces the same titles, so the
// "skip titles that already exist" check makes the whole generator idempotent.
function buildGeneratedListing(index, ownerIds, usedTitles) {
  const rnd = mulberry32(0x9e3779b9 ^ Math.imul(index + 1, 2654435761));
  const categoryName = CATEGORY_NAMES[index % CATEGORY_NAMES.length];
  const items = CATEGORY_ITEMS[categoryName];
  const itemIdx = Math.floor(index / CATEGORY_NAMES.length) % items.length;
  const variantIdx = Math.floor(index / (CATEGORY_NAMES.length * items.length)) % VARIANTS.length;
  const source = items[itemIdx];
  const variant = VARIANTS[variantIdx];
  const city = CITIES[(index * 5 + itemIdx) % CITIES.length];

  let title = variant ? `${source.name} — ${variant}` : source.name;
  if (usedTitles.has(title)) title = `${title} (${city.label.split(',')[0]})`;
  for (let n = 2; usedTitles.has(title); n++) title = `${title} #${n}`;

  const price = Math.max(5, Math.round(source.price * (0.75 + rnd() * 0.6)));
  const deposit = Math.round((source.deposit * (0.7 + rnd() * 0.7)) / 10) * 10;
  const imageCount = 2 + Math.floor(rnd() * 2);
  const imageOffset = Math.floor(rnd() * source.images.length);

  return {
    title,
    categoryName,
    images: Array.from({ length: Math.min(imageCount, source.images.length) }, (_, i) => source.images[(imageOffset + i) % source.images.length]),
    row: {
      id: randomUUID(),
      owner_id: ownerIds[(index * 7 + itemIdx) % ownerIds.length],
      title,
      description: `${source.description} ${CONDITION_NOTES[index % CONDITION_NOTES.length]}`,
      price_per_day: price,
      price_per_week: rnd() < 0.55 ? Math.round(price * 5.5) : null,
      deposit,
      location_lat: Math.round((city.lat + (rnd() - 0.5) * 0.06) * 1e5) / 1e5,
      location_lng: Math.round((city.lng + (rnd() - 0.5) * 0.06) * 1e5) / 1e5,
      location_label: city.label,
      status: 'published',
      instant_booking: rnd() < 0.55,
      protection_eligible: rnd() < 0.6,
      delivery_available: rnd() < 0.35,
      owner_verified: rnd() < 0.8,
    },
  };
}

async function seedGeneratedCatalog(ownerIds, renterIds, categoryId) {
  const existingTitles = await fetchDemoListingTitles(ownerIds);
  const usedTitles = new Set(existingTitles);
  const remaining = TARGET_LISTINGS - existingTitles.size;
  if (remaining <= 0) {
    console.log(`[seed-demo] Catalog already has ${existingTitles.size} demo listings — nothing to generate.`);
    return;
  }
  console.log(`[seed-demo] Generating ${remaining} additional demo listings...`);

  const listingRows = [];
  const imageRows = [];
  const availabilityRows = [];
  const bookingRows = [];
  const reviewRows = [];

  for (let n = 0; listingRows.length < remaining; n++) {
    const generated = buildGeneratedListing(n, ownerIds, usedTitles);
    if (existingTitles.has(generated.title)) continue;
    usedTitles.add(generated.title);

    const { row, images } = generated;
    if (!supportsListingFeatureColumns) {
      delete row.instant_booking; delete row.protection_eligible;
      delete row.delivery_available; delete row.owner_verified;
    }
    row.category_id = categoryId(generated.categoryName);
    listingRows.push(row);

    images.forEach((imgUrl, i) => imageRows.push({ listing_id: row.id, url: imgUrl, sort_order: i }));

    const rnd = mulberry32(Math.imul(n + 17, 374761393));
    for (let d = 1; d <= 60; d++) {
      if (rnd() < 0.08) availabilityRows.push({ listing_id: row.id, date: isoDateOffset(d), is_available: false });
    }

    // Past completed rentals so every owner/listing shows a real rating instead of "0.0".
    const reviewCount = 2 + Math.floor(rnd() * 3);
    for (let r = 0; r < reviewCount; r++) {
      const renterId = renterIds[(n * 3 + r) % renterIds.length];
      const days = 1 + Math.floor(rnd() * 4);
      const startOffset = -(10 + ((n * 7 + r * 13) % 320));
      const pricing = priced(row.price_per_day, days, row.deposit);
      const bookingId = randomUUID();
      bookingRows.push({
        id: bookingId, listing_id: row.id, renter_id: renterId, owner_id: row.owner_id,
        start_date: isoDateOffset(startOffset), end_date: isoDateOffset(startOffset + days),
        quantity: 1, status: 'completed', daily_rate: row.price_per_day, days, deposit: row.deposit, ...pricing,
      });
      reviewRows.push({
        booking_id: bookingId, reviewer_id: renterId, reviewee_id: row.owner_id,
        rating: rnd() < 0.72 ? 5 : rnd() < 0.8 ? 4 : 3,
        body: REVIEW_TEXTS[(n + r) % REVIEW_TEXTS.length],
      });
    }
  }

  await insertChunked('listings', listingRows, 200);
  await insertChunked('listing_images', imageRows);
  await insertChunked('listing_availability', availabilityRows, 1000);
  await insertChunked('bookings', bookingRows, 300);
  await insertChunked('reviews', reviewRows, 500);

  console.log(`[seed-demo] Added ${listingRows.length} listings, ${imageRows.length} images, ${bookingRows.length} past rentals, ${reviewRows.length} reviews.`);
}

async function detectListingFeatureColumns() {
  const { error } = await db.from('listings').select('instant_booking').limit(1);
  if (error) {
    supportsListingFeatureColumns = false;
    console.warn('[seed-demo] Listing feature columns missing — seeding without them. Apply migrations, then rerun.');
  }
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Listings seeded before the feature-flag migration landed have all four flags false, which makes
// the search filters look broken. Give those a deterministic spread of flags.
async function backfillListingFlags(ownerIds) {
  if (!supportsListingFeatureColumns) return;
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db.from('listings')
      .select('id, owner_id, category_id, title, price_per_day')
      .in('owner_id', ownerIds)
      .eq('instant_booking', false).eq('protection_eligible', false)
      .eq('delivery_available', false).eq('owner_verified', false)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  if (rows.length === 0) return;

  const patched = rows.map((row) => {
    const rnd = mulberry32(hashString(row.id));
    const instant = rnd() < 0.55;
    const protection = rnd() < 0.6;
    const delivery = rnd() < 0.35;
    return {
      ...row,
      instant_booking: instant,
      protection_eligible: protection,
      delivery_available: delivery,
      // Guarantee at least one flag so this row isn't re-selected by the all-false filter next run.
      owner_verified: rnd() < 0.8 || !(instant || protection || delivery),
    };
  });
  for (let i = 0; i < patched.length; i += 300) {
    const { error } = await db.from('listings').upsert(patched.slice(i, i + 300), { onConflict: 'id' });
    if (error) throw error;
  }
  console.log(`[seed-demo] Backfilled search flags on ${patched.length} listings.`);
}

async function main() {
  console.log('[seed-demo] DEMO_MODE=true — checking demo data...');

  await detectListingFeatureColumns();

  const ownerIds = [];
  for (const seed of OWNER_SEEDS) ownerIds.push(await getOrCreateUser(seed));
  const renterIds = [];
  for (const seed of RENTER_SEEDS) renterIds.push(await getOrCreateUser(seed));
  const renterId = renterIds[0];

  const { data: categories, error: catErr } = await db.from('categories').select('id, name');
  if (catErr) throw catErr;
  const categoryId = (name) => categories.find((c) => c.name === name)?.id;

  const { data: existingCatalog } = await db.from('listings').select('id, title')
    .in('owner_id', ownerIds).in('title', CATALOG.map((c) => c.title));
  const listingIdByTitle = new Map((existingCatalog ?? []).map((l) => [l.title, l.id]));

  for (const item of CATALOG) {
    const featureSeed = item.ownerIdx + item.price;
    const listingPatch = buildListingPatch(item, featureSeed);

    if (listingIdByTitle.has(item.title)) {
      const listingId = listingIdByTitle.get(item.title);
      await updateListingWithFallback(listingId, listingPatch);
      await seedListingAvailability(listingId, featureSeed);
      continue;
    }

    const listing = await insertListingWithFallback({
      owner_id: ownerIds[item.ownerIdx], category_id: categoryId(item.category), title: item.title,
      ...listingPatch,
    });
    await db.from('listing_images').insert(item.images.map((imgUrl, i) => ({ listing_id: listing.id, url: imgUrl, sort_order: i })));
    await seedListingAvailability(listing.id, featureSeed);
    listingIdByTitle.set(item.title, listing.id);
    console.log(`[seed-demo] Added catalog listing: ${item.title}`);
  }

  const cameraListingId = listingIdByTitle.get('Sony A7 IV Mirrorless Camera');

  // Cross-reviews so every demo listing/owner shows a real rating (not an empty "0.0"). Each
  // catalog item gets 2 completed rentals + item reviews from other demo accounts. Idempotent:
  // skips a (listing, reviewer) pair if that completed demo booking already exists.
  const reviewerPool = [renterId, ownerIds[0], ownerIds[1], ownerIds[2]];
  let reviewSeq = 0;
  for (const item of CATALOG) {
    const listingId = listingIdByTitle.get(item.title);
    const ownerId = ownerIds[item.ownerIdx];
    const picks = reviewerPool.filter((r) => r !== ownerId).slice(0, 2);
    for (const reviewerId of picks) {
      const { data: existing } = await db.from('bookings')
        .select('id').eq('listing_id', listingId).eq('renter_id', reviewerId).eq('status', 'completed').maybeSingle();
      if (existing) continue;
      const dayStart = 2 + (reviewSeq % 20); // spread across early-July 2026, all in the past
      const start = `2026-07-${String(dayStart).padStart(2, '0')}`;
      const end = `2026-07-${String(dayStart + 1).padStart(2, '0')}`;
      const booking = await insertBooking({
        listingId, renterId: reviewerId, ownerId, dailyRate: item.price, deposit: item.deposit,
        startDate: start, endDate: end, status: 'completed',
      });
      await db.from('reviews').insert({
        booking_id: booking.id, reviewer_id: reviewerId, reviewee_id: ownerId,
        rating: 4 + (reviewSeq % 2), body: REVIEW_TEXTS[reviewSeq % REVIEW_TEXTS.length],
      });
      reviewSeq++;
    }
  }

  await seedGeneratedCatalog(ownerIds, renterIds, categoryId);
  await backfillListingFlags(ownerIds);

  const { data: realProfiles, error: profErr } = await db.from('profiles').select('id, email').not('email', 'ilike', '%@ybuy.demo');
  if (profErr) throw profErr;

  // A slice of the demo catalog reused for each real user's favorites/bookings/threads.
  const { data: pool, error: poolErr } = await db.from('listings')
    .select('id, owner_id, title, price_per_day, deposit').in('owner_id', ownerIds).eq('status', 'published').limit(60);
  if (poolErr) throw poolErr;

  // Renter-side bookings covering the whole state machine, so every dashboard tab has content.
  const RENTER_BOOKING_PLAN = [
    { status: 'completed', from: -40, days: 3, review: true },
    { status: 'completed', from: -25, days: 2, review: true },
    { status: 'completed', from: -12, days: 1, review: false },
    { status: 'return_pending', from: -3, days: 2 },
    { status: 'active', from: -1, days: 4 },
    { status: 'confirmed', from: 6, days: 3 },
    { status: 'confirmed', from: 18, days: 2 },
    { status: 'pending_payment', from: 9, days: 2 },
    { status: 'requested', from: 14, days: 3 },
    { status: 'cancelled', from: -30, days: 2 },
    { status: 'rejected', from: -18, days: 1 },
  ];
  const PAID_STATUSES = new Set(['confirmed', 'active', 'return_pending', 'completed']);

  // Owner-side incoming bookings against the real user's own listings.
  const OWNER_BOOKING_PLAN = [
    { status: 'requested', from: 5, days: 2 },
    { status: 'requested', from: 11, days: 3 },
    { status: 'requested', from: 21, days: 1 },
    { status: 'confirmed', from: 4, days: 3 },
    { status: 'confirmed', from: 16, days: 2 },
    { status: 'active', from: -1, days: 3 },
    { status: 'return_pending', from: -4, days: 2 },
    { status: 'completed', from: -35, days: 2, review: true },
    { status: 'completed', from: -20, days: 3, review: true, payout: true },
    { status: 'completed', from: -9, days: 1, review: true, payout: true },
  ];

  const demoAccountIds = [...ownerIds, ...renterIds];
  const poolIds = pool.map((l) => l.id);

  // Wipes the demo-generated half of a real user's content so personalization can be re-applied
  // (earlier seed versions created a smaller set). Only touches rows whose counterparty is a demo
  // account, so anything the user created by hand against real users is left alone.
  async function resetPersonalization(realId) {
    await db.from('conversations').delete().eq('participant_one', realId).in('participant_two', demoAccountIds);
    await db.from('conversations').delete().eq('participant_two', realId).in('participant_one', demoAccountIds);
    await db.from('bookings').delete().eq('renter_id', realId).in('owner_id', demoAccountIds);
    await db.from('bookings').delete().eq('owner_id', realId).in('renter_id', demoAccountIds);
    await db.from('favorites').delete().eq('user_id', realId).in('listing_id', [cameraListingId, ...poolIds]);
    await db.from('listings').delete().eq('owner_id', realId).in('title', REAL_OWNER_LISTING_TITLES);
  }

  for (const real of realProfiles) {
    // Marker for the current personalization shape — present only once this version has run.
    const { data: marker } = await db.from('listings').select('id')
      .eq('owner_id', real.id).eq('title', REAL_OWNER_LISTINGS[1].title).maybeSingle();
    if (marker) continue;

    console.log(`[seed-demo] Personalizing demo content for ${real.email}...`);
    await resetPersonalization(real.id);

    await db.from('favorites').insert(
      [{ user_id: real.id, listing_id: cameraListingId }]
        .concat(pool.slice(0, 11).filter((l) => l.id !== cameraListingId).map((l) => ({ user_id: real.id, listing_id: l.id }))),
    );

    // ─ Renter side ─
    const renterConversationSeeds = [];
    for (const [i, plan] of RENTER_BOOKING_PLAN.entries()) {
      const target = pool[(i * 4 + 1) % pool.length];
      const booking = await insertBooking({
        listingId: target.id, renterId: real.id, ownerId: target.owner_id,
        dailyRate: Number(target.price_per_day), deposit: Number(target.deposit),
        startDate: isoDateOffset(plan.from), endDate: isoDateOffset(plan.from + plan.days), status: plan.status,
      });
      if (PAID_STATUSES.has(plan.status)) {
        await db.from('payments').insert({
          booking_id: booking.id, amount: booking.total, status: 'succeeded',
          stripe_checkout_session_id: 'demo_seed', stripe_payment_intent_id: 'demo_seed',
        });
      }
      if (plan.review) {
        await db.from('reviews').insert([
          { booking_id: booking.id, reviewer_id: real.id, reviewee_id: target.owner_id, rating: 5, body: REVIEW_TEXTS[i % REVIEW_TEXTS.length] },
          { booking_id: booking.id, reviewer_id: target.owner_id, reviewee_id: real.id, rating: 5, body: 'Great renter — returned everything on time and in great shape.' },
        ]);
      }
      if (renterConversationSeeds.length < MESSAGE_THREADS.length) {
        renterConversationSeeds.push({ listingId: target.id, bookingId: booking.id, otherId: target.owner_id });
      }
    }

    for (const [i, seed] of renterConversationSeeds.entries()) {
      const { data: convo, error: convoErr } = await db.from('conversations')
        .insert({ listing_id: seed.listingId, booking_id: seed.bookingId, participant_one: real.id, participant_two: seed.otherId })
        .select('id').single();
      if (convoErr) throw convoErr;
      const thread = MESSAGE_THREADS[i % MESSAGE_THREADS.length];
      await db.from('messages').insert(thread.map((body, m) => ({
        conversation_id: convo.id, sender_id: m % 2 === 0 ? real.id : seed.otherId, body,
      })));
    }

    // ─ Owner side: the real user's own listings plus incoming requests/rentals ─
    const ownListings = [];
    for (const spec of REAL_OWNER_LISTINGS) {
      const { data: ownListing, error: ownErr } = await db.from('listings').insert({
        owner_id: real.id, category_id: categoryId(spec.category), title: spec.title, description: spec.description,
        price_per_day: spec.price, deposit: spec.deposit, location_lat: spec.lat, location_lng: spec.lng,
        location_label: spec.location, status: spec.status,
      }).select('id').single();
      if (ownErr) throw ownErr;
      await db.from('listing_images').insert({ listing_id: ownListing.id, url: spec.image, sort_order: 0 });
      await seedListingAvailability(ownListing.id, spec.price);
      ownListings.push({ id: ownListing.id, ...spec });
    }
    const rentableOwnListings = ownListings.filter((l) => l.status === 'published');

    for (const [i, plan] of OWNER_BOOKING_PLAN.entries()) {
      const listing = rentableOwnListings[i % rentableOwnListings.length];
      const incomingRenterId = renterIds[i % renterIds.length];
      const booking = await insertBooking({
        listingId: listing.id, renterId: incomingRenterId, ownerId: real.id,
        dailyRate: listing.price, deposit: listing.deposit,
        startDate: isoDateOffset(plan.from), endDate: isoDateOffset(plan.from + plan.days), status: plan.status,
      });
      if (PAID_STATUSES.has(plan.status)) {
        await db.from('payments').insert({
          booking_id: booking.id, amount: booking.total, status: 'succeeded',
          stripe_checkout_session_id: 'demo_seed', stripe_payment_intent_id: 'demo_seed',
        });
      }
      if (plan.review) {
        await db.from('reviews').insert({
          booking_id: booking.id, reviewer_id: incomingRenterId, reviewee_id: real.id,
          rating: 5, body: REVIEW_TEXTS[(i + 3) % REVIEW_TEXTS.length],
        });
      }
      if (plan.payout) {
        await db.from('payouts').insert({
          booking_id: booking.id, owner_id: real.id, amount: round2(listing.price * plan.days),
          status: 'paid', paid_at: new Date().toISOString(), notes: 'Demo payout',
        });
      }
      if (i < 3) {
        const { data: convo, error: convoErr } = await db.from('conversations')
          .insert({ listing_id: listing.id, booking_id: booking.id, participant_one: incomingRenterId, participant_two: real.id })
          .select('id').single();
        if (convoErr) throw convoErr;
        const thread = MESSAGE_THREADS[(i + 2) % MESSAGE_THREADS.length];
        await db.from('messages').insert(thread.map((body, m) => ({
          conversation_id: convo.id, sender_id: m % 2 === 0 ? incomingRenterId : real.id, body,
        })));
      }
    }
  }

  console.log('[seed-demo] Done.');
}

if (process.env.DEMO_MODE !== 'true') {
  teardown()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[seed-demo] Teardown failed:', err);
      process.exit(1);
    });
} else {
  main().catch((err) => {
    console.error('[seed-demo] Failed:', err);
    process.exit(1);
  });
}
