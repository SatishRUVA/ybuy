import { useMemo, useState, type CSSProperties } from 'react';
import { ArrowLeft, ArrowRight, CalendarCheck, Camera, Check, ChevronRight, Hammer, MapPin, Search as SearchIcon, ShieldCheck, SlidersHorizontal, Tent, Truck, Zap } from 'lucide-react';
import { auctions, categories, listings as imagery, type Listing } from '@/data';
import { addDays, distanceMi, RADII, rangeLabel, rentalDays } from '../preview/dates';
import { RENTAL_MAX_DAYS } from '@/lib/listing-availability';
import { DEFAULT_SEARCH, type Sort } from '../preview/ctx';
import { DateField } from './dates';
import { href } from './state';
import { useMarketplace } from './marketplace-context';
import { Action, Avatar, Button, Dropdown, Empty, ItemCard, Modal, PageHead, Rating, Save, SectionHead, Tag, money, tones } from './ui';

export function SearchBar({ compact = false }: { compact?: boolean }) {
  const { search: s, setSearch, navigate } = useMarketplace();
  return <form className={`p1-search-bar ${compact ? 'p1-search-compact' : ''}`} role="search" onSubmit={(e) => { e.preventDefault(); navigate('search'); }}>
    <label className="p1-search-keyword"><SearchIcon size={21} aria-hidden="true" /><span><small>What do you need?</small><input aria-label="Search rentals" value={s.q} onChange={(e) => setSearch({ q: e.target.value })} placeholder="Camera, tent, tools..." /></span></label>
    <label className="p1-search-location"><MapPin size={20} aria-hidden="true" /><span><small>Where?</small><Dropdown label="Search location" value={s.loc} onChange={(loc) => setSearch({ loc })} options={[...new Set([s.loc, 'Irving, TX', 'Dallas, TX', 'Plano, TX', 'Fort Worth, TX', 'Frisco, TX'])].map((city) => ({ value: city, label: city }))} /></span></label>
    <DateField start={s.start} end={s.end} onChange={(start, end) => setSearch({ start, end })} optional label="When?" />
    <Button type="submit"><SearchIcon size={18} aria-hidden="true" /><span>Search</span></Button>
  </form>;
}

export function Home() {
  const store = useMarketplace();
  const { items, search, setSearch } = store;
  const shelf = [...items].filter((l) => l.listingStatus === 'published').sort((a, b) => store.production
    ? store.distance(a) - store.distance(b) : distanceMi(a, search.loc) - distanceMi(b, search.loc)).slice(0, 4);
  const campItem = items.find(l => l.listingStatus === 'published' && l.title === imagery[3].title);
  const toolItem = items.find(l => l.listingStatus === 'published' && l.title === imagery[1].title);
  const cameraItem = items.find(l => l.listingStatus === 'published' && l.title === imagery[11].title);
  const camp = { id: campItem?.id ?? '', images: imagery[3].images, title: campItem?.title ?? 'Make room for your next adventure', pricePerDay: campItem?.pricePerDay ?? 0 };
  const tool = { id: toolItem?.id ?? '', images: imagery[1].images, title: 'Gear for your next project' };
  const camera = { id: cameraItem?.id ?? '', images: imagery[11].images, title: 'For your next great shot' };
  const cat = (name: string) => { setSearch({ ...DEFAULT_SEARCH, loc: search.loc, cat: name }); store.navigate('search'); };
  const categoryRows = store.production ? store.categories : categories;
  return <main>
    <section className="p1-hero">
      <div className="p1-container p1-hero-layout">
        <div className="p1-hero-copy">
          <h1>Great gear.<br />No need to buy.</h1>
          <p>From a weekend away to the project you keep putting off. Rent the things you need from people nearby.</p>
          <div className="p1-hero-links"><a href="#p1-nearby" className="p1-text-link">Find your next thing <ArrowRight size={18} aria-hidden="true" /></a><a href={href('create')}>Or put your gear to work</a></div>
        </div>
        <div className="p1-hero-collage">
          <a href={href(camp.id ? 'listing' : 'search', camp.id || undefined)} onClick={event => { if (!camp.id) { event.preventDefault(); cat('Camping'); } }} className="p1-hero-main-photo"><img src={camp.images[0]} alt={camp.title} /><span><Tag tone="lime">Make room for adventure</Tag><strong>{camp.title}</strong><small>{campItem ? `Rent it from ${money(camp.pricePerDay)} / day` : 'Find outdoor gear nearby'}</small></span></a>
          <a className="p1-hero-small-photo p1-hero-camera" href={href(camera.id ? 'listing' : 'search', camera.id || undefined)} onClick={event => { if (!camera.id) { event.preventDefault(); cat('Home & Garden'); } }}><img src={camera.images[0]} alt={camera.title} /><span><Camera size={15} aria-hidden="true" /> For your next great shot</span></a>
          <a className="p1-hero-small-photo p1-hero-tool" href={href(tool.id ? 'listing' : 'search', tool.id || undefined)} onClick={event => { if (!tool.id) { event.preventDefault(); cat('Tools'); } }}><img src={tool.images[0]} alt={tool.title} /><span><Hammer size={15} aria-hidden="true" /> Finally finish that project</span></a>
        </div>
        <div className="p1-hero-search"><SearchBar /><div className="p1-search-extras">
          <label className="p1-inline-select">Search radius <Dropdown label="Search radius" value={String(search.radius ?? 'any')} onChange={(value) => setSearch({ radius: value === 'any' ? null : Number(value) as typeof search.radius })} options={RADII.map((r) => ({ value: String(r ?? 'any'), label: r ? `${r} miles` : 'Any distance' }))} /></label>
          <div className="p1-popular"><span>Try</span>{['Cameras', 'Camping', 'Tools', 'Party'].map((name) => <button type="button" key={name} onClick={() => cat(name)}>{name}</button>)}</div>
        </div></div>
      </div>
    </section>
    <section className="p1-container p1-home-section p1-category-section">
      <SectionHead title="What’s the plan?" description="A little inspiration for your next rental." />
      <div className="p1-category-grid">{categoryRows.slice(0, 8).map((c) => <button key={c.id} type="button" onClick={() => cat(c.name)} style={{ '--category': tones[c.name] ?? 'var(--p1-paper)' } as CSSProperties}><img src={c.image} alt="" loading="lazy" /><span>{c.name}<ChevronRight size={16} aria-hidden="true" /></span></button>)}</div>
    </section>
    <section id="p1-nearby" className="p1-container p1-home-section">
      <SectionHead title={`A few good finds in ${search.loc.split(',')[0]}`} description="Meet the gear. Meet the people behind it." to="search" />
      <div className="p1-item-grid">{shelf.map((l) => <ItemCard key={l.id} item={l} />)}</div>
      {store.production && <MarketplaceStatus />}
    </section>
    <section className="p1-container p1-home-section">
      <div className="p1-weekend"><div><Tent size={32} aria-hidden="true" /><h2>Pack light.<br />Live a little.</h2><p>Get out there with tents, coolers and camping essentials. Keep the memories, return the gear.</p><Button variant="lime" onClick={() => cat('Camping')}>Explore outdoor gear <ArrowRight size={18} aria-hidden="true" /></Button></div><img src={camp.images[0]} alt="Camping equipment available to rent" loading="lazy" /></div>
    </section>
    <section className="p1-container p1-home-section">
      <div className="p1-how"><div><h2>Less owning.<br />More doing.</h2><p>Your next rental, without the guesswork.</p></div><ol><li><SearchIcon aria-hidden="true" /><div><h3>Find what fits your plans</h3><p>Search nearby, choose your dates, and get to know the owner.</p></div></li><li><CalendarIcon /><div><h3>Book your days</h3><p>See the rental price, service fee and refundable deposit before you commit.</p></div></li><li><Check aria-hidden="true" /><div><h3>Pick up. Enjoy. Return.</h3><p>Arrange the handoff in messages and keep all your rental details together.</p></div></li></ol></div>
    </section>
    <section className="p1-container p1-home-section"><div className="p1-owner-promo"><div><h2>Your good stuff deserves<br />more than a shelf.</h2><p>Give it a second job. You choose the price, the dates and the days it stays home.</p></div><Action to="create" variant="lime">List your first item <ArrowRight size={18} aria-hidden="true" /></Action></div></section>
  </main>;
}
function CalendarIcon() { return <CalendarCheck aria-hidden="true" />; }

export function Browse() {
  const store = useMarketplace();
  const { items, search: s, setSearch, availableRange } = store;
  const [view, setView] = useState<'grid' | 'list' | 'map'>('grid');
  const [mobileFilters, setMobileFilters] = useState(false);
  const cats = ['All', ...new Set((store.production ? store.categories : items.map((l) => ({ name: l.category }))).map((c) => c.name))];
  const results = useMemo(() => {
    if (store.production) return items;
    const rows = items.filter((l) => l.listingStatus === 'published'
      && (!s.q.trim() || `${l.title} ${l.category} ${l.description}`.toLowerCase().includes(s.q.trim().toLowerCase()))
      && (s.cat === 'All' || s.cat === l.category) && (s.radius === null || distanceMi(l, s.loc) <= s.radius)
      && l.pricePerDay <= s.maxPrice && (!s.instant || l.instantBooking) && (!s.openOnly || l.available)
      && (!s.start || !s.end || availableRange(l.id, s.start, s.end)));
    return rows.sort((a, b) => s.sort === 'price' ? a.pricePerDay - b.pricePerDay : s.sort === 'distance' ? distanceMi(a, s.loc) - distanceMi(b, s.loc) : s.sort === 'rating' ? b.rating - a.rating : b.reviewCount - a.reviewCount);
  }, [items, s, availableRange, store.production]);
  const filters = <div className="p1-filter-body">
    <div className="p1-section-head"><h3>Refine your search</h3><button type="button" className="p1-text-link" onClick={() => setSearch({ ...DEFAULT_SEARCH, loc: s.loc })}>Reset</button></div>
    <label className="p1-field"><span>Category</span><Dropdown label="Category" value={s.cat} onChange={(cat) => setSearch({ cat })} options={cats.map((c) => ({ value: c, label: c }))} /></label>
    <label className="p1-field"><span>Distance</span><Dropdown label="Distance" value={String(s.radius ?? 'any')} onChange={(value) => setSearch({ radius: value === 'any' ? null : Number(value) as typeof s.radius })} options={RADII.map((r) => ({ value: String(r ?? 'any'), label: r ? `Within ${r} miles` : 'Any distance' }))} /></label>
    <label className="p1-field"><span>Up to {money(s.maxPrice)} / day</span><input aria-label="Maximum daily price" type="range" min={5} max={200} step={5} value={s.maxPrice} onChange={(e) => setSearch({ maxPrice: Number(e.target.value) })} /><div className="p1-range-labels"><span>$5</span><span>$200</span></div></label>
    <label className="p1-check"><input type="checkbox" checked={s.instant} onChange={(e) => setSearch({ instant: e.target.checked })} /><span>Instant booking<small>No waiting for approval</small></span></label>
    <label className="p1-check"><input type="checkbox" checked={s.openOnly} onChange={(e) => setSearch({ openOnly: e.target.checked })} /><span>Available items only</span></label>
    <div className="p1-filter-help"><ShieldCheck size={23} aria-hidden="true" /><h3>Get to know your owner</h3><p>Check their reviews, item condition and rental terms before booking.</p></div>
  </div>;
  return <main className="p1-container p1-page">
    <SearchBar compact /><PageHead title={s.q ? `Find “${s.q}” nearby` : `Good gear near ${s.loc.split(',')[0]}`} description={`${store.production ? store.total : results.length} ${store.production ? '' : 'sample '}${results.length === 1 ? 'rental' : 'rentals'}${s.start && s.end ? ` for ${rangeLabel(s.start, s.end)}` : '. Add dates to see what fits your plans.'}`} />
    <div className="p1-browse-layout"><aside className="p1-filters">{filters}</aside><div className="p1-results">
      <div className="p1-results-toolbar"><Button variant="secondary" className="p1-mobile-filter-button" onClick={() => setMobileFilters(true)}><SlidersHorizontal size={17} aria-hidden="true" /> Filters</Button><label className="p1-sort">Sort by <Dropdown label="Sort results" value={s.sort} onChange={(value) => setSearch({ sort: value as Sort })} options={[{ value: 'recommended', label: 'Recommended' }, { value: 'price', label: 'Price: low to high' }, { value: 'distance', label: 'Closest first' }, { value: 'rating', label: 'Best rated' }]} /></label><div className="p1-tabs p1-view-tabs" aria-label="Results view">{(['grid', 'list', 'map'] as const).map((v) => <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>)}</div></div>
      {store.production && <MarketplaceStatus />}
      {results.length === 0 && !store.loading && !store.error ? <Empty title="A little further might do it." body="Try a wider radius, different dates or fewer filters. Or ask the community for what you need."><Button onClick={() => setSearch({ radius: null })}>Search any distance</Button><Button variant="secondary" onClick={() => setSearch({ ...DEFAULT_SEARCH, loc: s.loc, radius: null })}>Clear all filters</Button><Action variant="quiet" to="requests">Post a request</Action></Empty>
        : results.length === 0 ? null
        : view === 'map' ? <DiscoveryMap items={results} /> : <div className={`p1-item-grid p1-results-grid ${view === 'list' ? 'p1-list-view' : ''}`}>{results.map((l) => <ItemCard key={l.id} item={l} compact={view === 'list'} />)}</div>}
      {store.hasMore && <Button variant="secondary" disabled={store.loading} onClick={store.loadMore}>Load more rentals</Button>}
    </div></div>
    <Modal open={mobileFilters} onClose={() => setMobileFilters(false)} title="Search filters" footer={<Button className="p1-full" onClick={() => setMobileFilters(false)}>Show {results.length} results</Button>}>{filters}</Modal>
  </main>;
}

function DiscoveryMap({ items }: { items: Listing[] }) {
  const [selected, setSelected] = useState(items[0].id);
  const active = items.find((l) => l.id === selected) ?? items[0];
  const lats = items.map((l) => l.lat), lngs = items.map((l) => l.lng);
  const minLat = Math.min(...lats), minLng = Math.min(...lngs);
  const latRange = Math.max(...lats) - minLat || 1, lngRange = Math.max(...lngs) - minLng || 1;
  return <div className="p1-discovery-map"><div className="p1-map-caption"><MapPin size={16} aria-hidden="true" />Illustrative location view · not a navigation map</div><div className="p1-map-pins">{items.map((l) => <button key={l.id} type="button" aria-label={`Show ${l.title}`} aria-pressed={active.id === l.id} style={{ left: `${12 + (l.lng - minLng) / lngRange * 74}%`, top: `${12 + (1 - (l.lat - minLat) / latRange) * 60}%` }} onClick={() => setSelected(l.id)}>{money(l.pricePerDay)}</button>)}</div><div className="p1-map-item"><img src={active.images[0]} alt={active.title} /><div><strong>{active.title}</strong><Rating value={active.rating} /><Action to="listing" id={active.id} variant="secondary">View rental</Action></div></div></div>;
}

export function Details({ id }: { id: string }) {
  const store = useMarketplace();
  const item = store.items.find((l) => l.id === id);
  const [gallery, setGallery] = useState(false);
  const [photo, setPhoto] = useState(0);
  if (!item) return <main className="p1-container p1-page">{store.loading || store.error ? <MarketplaceStatus /> : <Empty title="This item isn’t here." body="The link may be outdated. Browse the marketplace instead."><Action to="search">Browse rentals</Action></Empty>}</main>;
  return <ItemDetails key={id} item={item} gallery={gallery} setGallery={setGallery} photo={photo} setPhoto={setPhoto} />;
}
function ItemDetails({ item, gallery, setGallery, photo, setPhoto }: { item: Listing; gallery: boolean; setGallery: (v: boolean) => void; photo: number; setPhoto: (v: number) => void }) {
  const store = useMarketplace();
  const a = store.availFor(item.id);
  const blocked = store.blockedFor(item.id);
  const seed = store.availableRange(item.id, store.search.start, store.search.end) ? store.search : store.firstRange(item.id);
  const [dates, setDates] = useState({ start: seed.start, end: seed.end });
  const days = dates.start && dates.end ? rentalDays(dates.start, dates.end) : 0;
  const { rental: subtotal, fee, insurance = 0, tax } = store.rentalQuote(item, days);
  const valid = store.availableRange(item.id, dates.start, dates.end) && item.available && item.listingStatus === 'published';
  const pickDates = (start: string, end: string) => { setDates({ start, end }); store.setSearch({ start, end }); };
  const book = () => { store.setSearch(dates); store.navigate('checkout', item.id); };
  const contact = () => store.contact(item);
  return <main className="p1-container p1-page p1-details">
    <div className="p1-breadcrumb"><a href={href('search')}><ArrowLeft size={16} aria-hidden="true" /> Back to rentals</a><span>{item.category}</span></div>
    <div className="p1-gallery"><button type="button" onClick={() => { setPhoto(0); setGallery(true); }} className="p1-gallery-main" aria-label="Open item photos"><img src={item.images[0]} alt={item.title} /></button><div className="p1-gallery-side">{item.images.slice(1, 3).map((img, i) => <button type="button" key={`${img}-${i}`} onClick={() => { setPhoto(i + 1); setGallery(true); }} aria-label={`Open photo ${i + 2}`}><img src={img} alt={`${item.title}, view ${i + 2}`} /></button>)}</div><Button variant="secondary" className="p1-gallery-all" onClick={() => setGallery(true)}><Camera size={16} aria-hidden="true" /> All {item.images.length} photos</Button><Save id={item.id} title={item.title} /></div>
    <div className="p1-detail-layout"><div className="p1-detail-content">
      <h1>{item.title}</h1><div className="p1-detail-meta"><Rating value={item.rating} count={item.reviewCount} /><span><MapPin size={16} aria-hidden="true" />{store.production ? store.distance(item) : distanceMi(item, store.search.loc)} miles from {store.search.loc.split(',')[0]}</span><Tag>{item.condition}</Tag></div>
      <div className="p1-detail-owner"><Avatar src={item.owner.avatar} name={item.owner.name} size={52} /><div><p>Rent from <strong>{item.owner.name}</strong></p><span>{item.verifiedOwner ? 'Verified owner' : 'Community owner'} · {store.production ? 'Plan the handoff in messages' : `${item.owner.responseRate}% response rate`}</span></div><Button variant="secondary" onClick={contact}>Message owner</Button></div>
      <section><h2>A little about this rental</h2><p>{item.description}</p></section>
      <section><h2>Everything that comes with it</h2><ul className="p1-included">{item.whatsIncluded.map((x) => <li key={x}><Check size={17} aria-hidden="true" />{x}</li>)}</ul></section>
      <section><h2>Pickup & the practical stuff</h2><div className="p1-practical"><MapPin aria-hidden="true" /><div><h3>Local pickup</h3><p>{item.pickup}</p></div>{item.deliveryAvailable && <><Truck aria-hidden="true" /><div><h3>Delivery available</h3><p>{item.delivery}</p></div></>}</div><details><summary>Cancellation terms</summary><p>{item.cancellation}</p></details><details><summary>Refundable deposit</summary><p>{store.production ? `${money(item.deposit)} is a separate temporary card hold, never part of rental payment. Agree a slot after paying, then authorize the hold within 24 hours before pickup or delivery. Uncaptured funds are released after return; only separately approved deductions may be captured.` : `${money(item.deposit)} is a refundable hold, separate from your rental total. This preview never charges or holds funds.`}</p></details></section>
      <section><SectionHead title="What renters say" /><div className="p1-reviews">{item.reviews.map((r) => <article key={r.id}><div className="p1-review-person"><Avatar src={r.avatar} name={r.author} /><div><strong>{r.author}</strong><Rating value={r.rating} /></div><span>{r.date}</span></div><p>{r.text}</p></article>)}</div></section>
    </div><aside className="p1-booking-panel"><div className="p1-booking-price"><strong>{money(item.pricePerDay)}</strong><span>/ day</span>{item.instantBooking && <Tag tone="blue"><Zap size={13} aria-hidden="true" /> Instant</Tag>}</div><p className="p1-muted">Good gear, for exactly your days.</p>
      <DateField {...dates} onChange={pickDates} min={a.start} max={a.end} maxDays={store.production ? RENTAL_MAX_DAYS : undefined} blocked={blocked} endExclusive={store.production} label="Your rental dates" />
      <p className="p1-window-note">Open {rangeLabel(a.start, store.production ? addDays(a.end, -1) : a.end)}. Taken days stay unavailable.</p>
      <dl className="p1-price-breakdown"><div><dt>{days ? `${money(item.pricePerDay)} × ${days} days` : 'Rental'}</dt><dd>{days ? money(subtotal) : 'Choose dates'}</dd></div><div><dt>{insurance > 0 ? 'Service fee & insurance' : 'Service fee'}</dt><dd>{money(fee + insurance)}</dd></div>{tax !== undefined && <div><dt>Tax (7%)</dt><dd>{money(tax)}</dd></div>}<div className="total"><dt>Rental total</dt><dd>{money(subtotal + fee + insurance + (tax ?? 0))}</dd></div>{!store.production && <div><dt>Refundable deposit hold</dt><dd>{money(item.deposit)}</dd></div>}</dl>
      {store.production && item.deposit > 0 && <p className="p1-locked-note">Separate security hold: {money(item.deposit)}. Not part of rental payment; authorize it at check-in.</p>}
      {tax !== undefined && <p className="p1-muted">Tax is 7% of discounted rental and service fees only. The server confirms the final amount.</p>}
      {store.production && <MarketplaceStatus />}
      <Button className="p1-full" disabled={!valid} onClick={book}>{item.instantBooking ? 'Book these dates' : 'Request these dates'} <ArrowRight size={17} aria-hidden="true" /></Button><p className="p1-booking-note">{item.instantBooking ? 'Review the total before confirming.' : 'No payment until the owner approves.'}</p>
      <a className="p1-text-link" href={!store.production && auctions.some((a) => a.title === item.title) ? href('auction', auctions.find((a) => a.title === item.title)?.id) : href('bidding')}>Explore competitive bidding <ChevronRight size={15} aria-hidden="true" /></a>
    </aside></div>
    <Modal open={gallery} onClose={() => setGallery(false)} title={item.title} wide><div className="p1-lightbox"><img src={item.images[photo]} alt={`${item.title}, view ${photo + 1}`} /><div className="p1-dialog-footer"><Button variant="secondary" onClick={() => setPhoto((photo - 1 + item.images.length) % item.images.length)} aria-label="Previous photo"><ArrowLeft size={18} aria-hidden="true" /></Button><span>{photo + 1} of {item.images.length}</span><Button variant="secondary" onClick={() => setPhoto((photo + 1) % item.images.length)} aria-label="Next photo"><ArrowRight size={18} aria-hidden="true" /></Button></div></div></Modal>
  </main>;
}
export function Favorites() {
  const { items, saved, production, loading, error } = useMarketplace();
  const rows = items.filter((l) => saved.includes(l.id));
  return <main className="p1-container p1-page"><PageHead title="Keep the good finds." description={`${rows.length} saved items. Your next project starts here.`} action={<Action to="search" variant="secondary">Find more gear</Action>} />{production && <MarketplaceStatus />}{rows.length ? <div className="p1-item-grid">{rows.map((l) => <ItemCard key={l.id} item={l} />)}</div> : !loading && !error && <Empty title="Nothing saved. Yet." body="Tap the heart on a rental to keep it here for later."><Action to="search">Browse rentals</Action></Empty>}</main>;
}

function MarketplaceStatus() {
  const { error, loading, retry } = useMarketplace();
  return error ? <div className="p1-error" role="alert"><p>{error}</p><Button variant="secondary" onClick={retry}>Try again</Button></div>
    : loading ? <p className="p1-muted" role="status">Loading rentals…</p> : null;
}
