import { useState, useRef, useEffect } from 'react';
import { Search, MapPin, ChevronDown, Check, LocateFixed } from 'lucide-react';
import { useTheme } from '@/theme-context';
import { Palette, Moon, Check as CheckIcon } from 'lucide-react';
import { findCities, locationLabel, todayIso, addDaysIso, type MarketplaceLocation } from '@/lib/geo';
import { useMarketplaceLocation } from '@/location-context';
import { DateRangePicker } from '@/components/date-range-picker';

export interface SearchParams {
  keyword: string;
  location: MarketplaceLocation;
  startDate: string;
  endDate: string;
}

const PLACEHOLDER_EXAMPLES = [
  'Camera, drill, projector...',
  'Camping tent, mountain bike...',
  'Party tables, DJ speaker...',
  'Lawn mower, power tools...',
  'VR headset, stand mixer...',
];

export function SearchBar({ onSearch, onLocationChange, variant = 'hero', defaultValue = '', initialStartDate, initialEndDate }: { onSearch?: (params: SearchParams) => void; onLocationChange?: (location: MarketplaceLocation) => void; variant?: 'hero' | 'compact'; defaultValue?: string; initialStartDate?: string; initialEndDate?: string }) {
  const { location, selectCity, requestBrowserLocation, clearLocation } = useMarketplaceLocation();
  const [what, setWhat] = useState(defaultValue);
  const [cityQuery, setCityQuery] = useState('');
  const [cities, setCities] = useState<MarketplaceLocation[]>([]);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [searchingCities, setSearchingCities] = useState(false);
  const [locating, setLocating] = useState(false);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const today = todayIso();
  const [startDate, setStartDate] = useState(initialStartDate ?? today);
  const [endDate, setEndDate] = useState(initialEndDate ?? addDaysIso(today, 1));
  const [showLocMenu, setShowLocMenu] = useState(false);
  // On small screens the compact variant starts as a one-line summary and expands on tap,
  // so the search page keeps its results above the fold.
  const [mobileExpanded, setMobileExpanded] = useState(variant === 'hero');
  const desktopLocRef = useRef<HTMLDivElement>(null);
  const mobileLocRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (what) return; // don't distract the user once they've started typing
    const id = setInterval(() => setPlaceholderIndex((i) => (i + 1) % PLACEHOLDER_EXAMPLES.length), 2000);
    return () => clearInterval(id);
  }, [what]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      const target = e.target as Node;
      const inDesktopMenu = desktopLocRef.current?.contains(target) ?? false;
      const inMobileMenu = mobileLocRef.current?.contains(target) ?? false;
      if (!inDesktopMenu && !inMobileMenu) setShowLocMenu(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!showLocMenu || cityQuery.trim().length < 2) { setCities([]); setSearchingCities(false); return; }
    const controller = new AbortController();
    setSearchingCities(true);
    const timer = setTimeout(() => {
      setLocationError(null);
      void findCities(cityQuery, controller.signal)
        .then(setCities)
        .catch(() => { if (!controller.signal.aborted) setLocationError('City search is unavailable. Try again.'); })
        .finally(() => { if (!controller.signal.aborted) setSearchingCities(false); });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [cityQuery, showLocMenu]);

  function runSearch() {
    onSearch?.({ keyword: what, location, startDate, endDate });
    if (variant === 'compact') setMobileExpanded(false);
  }

  async function chooseBrowserLocation() {
    setLocating(true);
    setLocationError(null);
    try {
      await requestBrowserLocation();
      onLocationChange?.({ city: '', state: '', country: '', source: 'BROWSER' });
      setShowLocMenu(false);
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : 'Could not use your location.');
    } finally {
      setLocating(false);
    }
  }

  function chooseCity(city: MarketplaceLocation) {
    selectCity(city);
    onLocationChange?.(city);
    setCityQuery('');
    setShowLocMenu(false);
  }

  const displayLocation = location.source === 'IP' ? `Near ${locationLabel(location)}` : locationLabel(location);

  const locationMenu = (
    <div role="dialog" aria-label="Choose location" className="absolute top-full mt-2 left-0 z-[100] w-[min(20rem,calc(100vw-2rem))] max-h-[min(22rem,calc(100dvh-10rem))] overflow-y-auto overscroll-contain bg-card border border-app rounded-card-lg shadow-pop p-2 animate-modal">
      <p className="px-2 pb-2 text-sm font-semibold text-main">Location</p>
      <input aria-label="Search city or ZIP" autoComplete="off" value={cityQuery} onChange={(event) => setCityQuery(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Enter' && cities[0]) chooseCity(cities[0]);
      }} placeholder="Search city or ZIP" className="w-full h-10 px-3 rounded-card border border-app bg-card text-sm text-main outline-none focus:border-accent" />
      <button type="button" onClick={() => void chooseBrowserLocation()} disabled={locating} className="w-full flex items-center gap-2 h-11 px-3 mt-2 rounded-card text-left text-sm font-medium text-main hover:bg-subtle disabled:opacity-60">
        <LocateFixed size={16} className="text-accent" />{locating ? 'Finding your city…' : 'Use my location'}
      </button>
      {searchingCities && <p className="px-3 py-2 text-xs text-sec">Searching cities…</p>}
      {cities.map((city) => (
        <button type="button" key={`${city.city}|${city.state}|${city.country}`} onClick={() => chooseCity(city)} className="w-full flex items-center justify-between gap-2 min-h-11 px-3 rounded-card text-left text-sm text-main hover:bg-subtle">
          <span>{locationLabel(city)}{city.country && <span className="block text-xs text-sec">{city.country}</span>}</span>
          {city.city === location.city && city.state === location.state && location.source === 'USER_SELECTED' && <Check size={14} className="text-accent" />}
        </button>
      ))}
      {cityQuery.trim().length >= 2 && !searchingCities && cities.length === 0 && !locationError && <p className="px-3 py-2 text-xs text-sec">No matching city. Try a city or ZIP.</p>}
      {locationError && <p role="status" className="px-3 py-2 text-xs text-error">{locationError}</p>}
      {location.source !== 'NONE' && <button type="button" onClick={() => { clearLocation(); onLocationChange?.({ city: '', state: '', country: '', source: 'NONE' }); setShowLocMenu(false); }} className="w-full h-10 px-3 text-left text-xs font-medium text-sec hover:text-main">Browse without a location</button>}
    </div>
  );

  return (
    <div className="relative z-[80] w-full min-w-0">
      {/* Desktop: one pill, three segments, one action. Segments light up on hover/focus. */}
      <div
        className={`search-control hidden sm:flex items-center w-full min-w-0 glass-surface border border-app rounded-card-lg shadow-xs
          transition-shadow duration-standard ease-out focus-within:shadow-hover hover:shadow-hover
          ${variant === 'hero' ? 'p-1.5' : 'p-1'}`}
      >
        <div className="search-input-shell flex-1 min-w-0 flex items-center gap-2.5 pl-4 pr-3 h-11 rounded-card transition-colors duration-fast hover:bg-subtle focus-within:bg-subtle">
          <Search size={18} className="text-sec shrink-0" />
          <div className="flex-1 min-w-0">
            <label htmlFor="search-what" className="sr-only">Search for items to rent</label>
            <input
              id="search-what"
              name="search-what"
              value={what}
              onChange={(e) => setWhat(e.target.value)}
              placeholder={PLACEHOLDER_EXAMPLES[placeholderIndex]}
              aria-label="Search for items to rent"
              className="search-input w-full bg-transparent outline-none text-sm font-medium text-main placeholder:text-muted placeholder:font-normal min-w-0"
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            />
          </div>
        </div>

        <span className="w-px h-6 bg-[var(--border)] shrink-0" aria-hidden="true" />

        <div ref={desktopLocRef} className="relative min-w-0 shrink-0">
          <button
            onClick={() => setShowLocMenu(!showLocMenu)}
            aria-haspopup="listbox"
            aria-expanded={showLocMenu}
            className="flex items-center gap-2 px-4 h-11 rounded-card text-sm font-medium text-main whitespace-nowrap transition-colors duration-fast hover:bg-subtle"
          >
            {location.source === 'BROWSER' ? <LocateFixed size={16} className="shrink-0 text-accent" /> : <MapPin size={16} className="shrink-0 text-accent" />}
            <span className="max-w-32 truncate">{displayLocation}</span>
            <ChevronDown size={14} className={`text-muted transition-transform duration-fast ${showLocMenu ? 'rotate-180' : ''}`} />
          </button>
          {showLocMenu && locationMenu}
        </div>

        <span className="hidden lg:block w-px h-6 bg-[var(--border)] shrink-0" aria-hidden="true" />
        <div className="hidden lg:block shrink-0">
          <DateRangePicker startDate={startDate} endDate={endDate} onChange={(s, e) => { setStartDate(s); setEndDate(e); }} />
        </div>

        <button
          onClick={runSearch}
          className="ml-1 shrink-0 inline-flex items-center gap-2 h-11 px-5 rounded-card bg-accent text-accent-text font-semibold text-sm hover:bg-accent-hover active:scale-[0.98] transition-all duration-fast"
        >
          <Search size={16} />
          <span>Search</span>
        </button>
      </div>

      {/* Mobile: compact summary that expands into the full form. */}
      <div className="sm:hidden">
        {!mobileExpanded ? (
          <button
            onClick={() => setMobileExpanded(true)}
            className="w-full flex items-center gap-3 h-12 px-4 rounded-card-lg glass-surface border border-app shadow-xs text-left active:scale-[0.99] transition-transform duration-fast"
          >
            <Search size={17} className="text-accent shrink-0" />
            <span className="flex-1 min-w-0 truncate text-sm font-semibold text-main">
              {what || 'Search rentals'}
            </span>
            <span className="text-xs text-sec shrink-0 max-w-28 truncate">{displayLocation}</span>
          </button>
        ) : (
          <div className="rounded-card-xl glass-surface border border-app shadow-card p-3.5 space-y-3 animate-modal">
            <div className="search-input-shell flex items-center gap-2.5 h-11 px-3 rounded-card bg-subtle">
              <Search size={16} className="text-sec shrink-0" />
              <input
                value={what}
                onChange={(e) => setWhat(e.target.value)}
                placeholder={PLACEHOLDER_EXAMPLES[placeholderIndex]}
                aria-label="What do you need?"
                className="search-input w-full bg-transparent outline-none text-sm font-medium text-main placeholder:text-muted placeholder:font-normal"
                onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              />
            </div>

            <div ref={mobileLocRef} className="relative">
              <button
                onClick={() => setShowLocMenu(!showLocMenu)}
                className="w-full flex items-center justify-between h-11 px-3 rounded-card bg-subtle text-sm font-medium text-main"
              >
                <span className="flex items-center gap-2">
                  <MapPin size={15} className="text-accent" />
                  {displayLocation}
                </span>
                <ChevronDown size={14} className={`text-muted transition-transform duration-fast ${showLocMenu ? 'rotate-180' : ''}`} />
              </button>
              {showLocMenu && locationMenu}
            </div>

            <div className="px-1">
              <DateRangePicker
                startDate={startDate}
                endDate={endDate}
                onChange={(s, e) => { setStartDate(s); setEndDate(e); }}
                mode="range"
              />
            </div>

            <button
              onClick={runSearch}
              className="w-full h-12 rounded-card bg-accent text-accent-text font-semibold text-sm active:scale-[0.99] transition-transform duration-fast flex items-center justify-center gap-2"
            >
              <Search size={16} />
              Search
            </button>
          </div>
        )}
      </div>
    </div>
  );
}


export function ThemeSwitcher() {
  const { themes, themeId, setThemeId, theme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-card-lg border border-app bg-card hover:bg-subtle transition-colors text-sm font-medium text-main"
        title="Switch theme"
      >
        {theme.dark ? <Moon size={16} className="text-accent" /> : <Palette size={16} className="text-accent" />}
        <span className="hidden lg:inline">{theme.name}</span>
        <ChevronDown size={14} className="text-muted" />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-2 z-[100] w-72 bg-card border border-app rounded-card-xl shadow-hover p-2 animate-modal">
          <div className="px-2 py-1.5 text-xs font-semibold text-muted uppercase tracking-wide">10 Demo Themes</div>
          <div className="max-h-80 overflow-y-auto space-y-0.5">
            {themes.map((t) => (
              <button
                key={t.id}
                onClick={() => { setThemeId(t.id); setOpen(false); }}
                className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-card text-left transition-colors ${t.id === themeId ? 'bg-accent-soft' : 'hover:bg-subtle'}`}
              >
                <div className="flex gap-1 shrink-0">
                  <span className="w-4 h-4 rounded-full border border-app" style={{ background: t.vars['--bg'] }} />
                  <span className="w-4 h-4 rounded-full border border-app" style={{ background: t.vars['--accent'] }} />
                  <span className="w-4 h-4 rounded-full border border-app" style={{ background: t.vars['--text'] }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-main">{t.name}</span>
                    {t.dark && <Moon size={11} className="text-muted" />}
                  </div>
                  <div className="text-xs text-sec truncate">{t.tagline}</div>
                </div>
                {t.id === themeId && <CheckIcon size={16} className="text-accent shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
