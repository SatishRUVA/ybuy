import { useState, useRef, useEffect } from 'react';
import { Search, MapPin, ChevronDown, Check, LocateFixed, Map } from 'lucide-react';
import { useTheme } from '@/theme-context';
import { Palette, Moon, Check as CheckIcon } from 'lucide-react';
import { findCities, haversineMiles, locationLabel, type MarketplaceLocation } from '@/lib/geo';
import { useMarketplaceLocation } from '@/location-context';
import { DateRangePicker } from '@/components/date-range-picker';
import { SEARCH_RADII, parseSearchRadius, savedSearchState, saveSearchState, type SearchRadius } from '@/lib/search-state';

export interface SearchParams {
  keyword: string;
  location: MarketplaceLocation;
  startDate: string;
  endDate: string;
  radius: SearchRadius;
}

export function SearchRadiusSelect({ value, onChange, label = 'Search radius' }: {
  value: SearchRadius; onChange: (value: SearchRadius) => void; label?: string;
}) {
  return (
    <select aria-label={label} value={value === null ? 'any' : value}
      onChange={(event) => onChange(parseSearchRadius(event.target.value))}
      className="h-11 w-full min-w-0 rounded-card border border-app bg-card px-3 text-sm font-medium text-main focus-visible:outline-accent">
      {SEARCH_RADII.map((miles) => <option key={miles} value={miles}>Within {miles} miles</option>)}
      <option value="any">Any distance</option>
    </select>
  );
}

const PLACEHOLDER_EXAMPLES = [
  'Camera, drill, projector...',
  'Camping tent, mountain bike...',
  'Party tables, DJ speaker...',
  'Lawn mower, power tools...',
  'VR headset, stand mixer...',
];

export function SearchBar({ onSearch, onLocationChange, variant = 'hero', defaultValue = '', initialStartDate, initialEndDate, initialRadius = 5, radius: controlledRadius, onRadiusChange }: {
  onSearch?: (params: SearchParams) => void;
  onLocationChange?: (location: MarketplaceLocation) => void;
  variant?: 'hero' | 'compact'; defaultValue?: string; initialStartDate?: string; initialEndDate?: string;
  initialRadius?: SearchRadius; radius?: SearchRadius; onRadiusChange?: (radius: SearchRadius) => void;
}) {
  const { location, selectCity, requestBrowserLocation, clearLocation } = useMarketplaceLocation();
  const [what, setWhat] = useState(defaultValue);
  const [cityQuery, setCityQuery] = useState('');
  const [cities, setCities] = useState<MarketplaceLocation[]>([]);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [searchingCities, setSearchingCities] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationPermission, setLocationPermission] = useState<PermissionState | 'unavailable'>('prompt');
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [startDate, setStartDate] = useState(initialStartDate ?? '');
  const [endDate, setEndDate] = useState(initialEndDate ?? '');
  const [selectedRadius, setSelectedRadius] = useState(initialRadius);
  const radius = controlledRadius === undefined ? selectedRadius : controlledRadius;
  const [showLocMenu, setShowLocMenu] = useState(false);
  // On small screens the compact variant starts as a one-line summary and expands on tap,
  // so the search page keeps its results above the fold.
  const [mobileExpanded, setMobileExpanded] = useState(variant === 'hero');
  const desktopLocRef = useRef<HTMLDivElement>(null);
  const mobileLocRef = useRef<HTMLDivElement>(null);
  const locationTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => { setWhat(defaultValue); }, [defaultValue]);
  useEffect(() => { setStartDate(initialStartDate ?? ''); setEndDate(initialEndDate ?? ''); }, [initialStartDate, initialEndDate]);
  useEffect(() => {
    if (variant === 'hero') saveSearchState({ ...savedSearchState(), q: what, start: startDate, end: endDate, radius });
  }, [variant, what, startDate, endDate, radius]);

  useEffect(() => {
    if (showLocMenu) {
      const container = window.matchMedia('(min-width: 640px)').matches ? desktopLocRef.current : mobileLocRef.current;
      container?.querySelector('input')?.focus();
    } else {
      locationTriggerRef.current?.focus();
    }
  }, [showLocMenu]);

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
    if (!showLocMenu) return;
    const controller = new AbortController();
    const query = cityQuery.trim();
    if (query.length < 2 && location.source !== 'BROWSER') {
      setCities([]);
      setSearchingCities(false);
      return () => controller.abort();
    }
    setSearchingCities(true);
    setCities([]);
    const nearbyLookup = !query && location.source === 'BROWSER'
      && location.latitude !== undefined && location.longitude !== undefined;
    const timer = setTimeout(() => {
      setLocationError(null);
      void findCities(
        query || location.city,
        controller.signal,
        nearbyLookup ? { latitude: location.latitude!, longitude: location.longitude! } : undefined,
      )
        .then((results) => {
          if (!nearbyLookup) {
            setCities(results);
            return;
          }
          const nearby = results
            .filter((result) => result.latitude !== undefined && result.longitude !== undefined)
            .map((result) => ({
              result,
              distance: haversineMiles(location.latitude!, location.longitude!, result.latitude!, result.longitude!),
            }))
            .filter(({ distance }) => distance <= 100)
            .sort((first, second) => first.distance - second.distance)
            .map(({ result }) => result);
          setCities(nearby);
        })
        .catch(() => { if (!controller.signal.aborted) setLocationError('City search is unavailable. Try again.'); })
        .finally(() => { if (!controller.signal.aborted) setSearchingCities(false); });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [cityQuery, location.city, location.latitude, location.longitude, location.source, showLocMenu]);

  useEffect(() => {
    if (!showLocMenu || !navigator.permissions) {
      setLocationPermission('unavailable');
      return;
    }
    let active = true;
    let status: PermissionStatus | undefined;
    void navigator.permissions.query({ name: 'geolocation' }).then((permission) => {
      if (!active) return;
      status = permission;
      setLocationPermission(permission.state);
      permission.onchange = () => setLocationPermission(permission.state);
    }).catch(() => setLocationPermission('unavailable'));
    return () => {
      active = false;
      if (status) status.onchange = null;
    };
  }, [showLocMenu]);

  function runSearch() {
    onSearch?.({ keyword: what, location, startDate, endDate, radius });
    if (variant === 'compact') setMobileExpanded(false);
  }

  async function chooseBrowserLocation() {
    setLocating(true);
    setLocationError(null);
    try {
      const nextLocation = await requestBrowserLocation();
      if (nextLocation) onLocationChange?.(nextLocation);
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

  const isSelectedCity = (city: MarketplaceLocation) =>
    location.source === 'USER_SELECTED' && city.city === location.city && city.state === location.state && city.postalCode === location.postalCode;
  const suggestions = cities;
  function changeRadius(next: SearchRadius) {
    setSelectedRadius(next);
    onRadiusChange?.(next);
  }

  function toggleLocation(event: React.MouseEvent<HTMLButtonElement>) {
    locationTriggerRef.current = event.currentTarget;
    setShowLocMenu(!showLocMenu);
  }

  // z-[210] clears the shared dim Overlay (z-200) so the menu never renders under its own backdrop.
  const locationMenu = (
    <div role="dialog" aria-modal="true" aria-label="Choose location" onKeyDown={(event) => {
      if (event.key === 'Escape') { event.stopPropagation(); setShowLocMenu(false); }
      if (event.key === 'Tab') {
        const controls = event.currentTarget.querySelectorAll<HTMLElement>('input, button:not(:disabled)');
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }} className="absolute top-full mt-2 left-0 z-[210] w-[min(19rem,calc(100vw-2rem))] max-h-[min(22rem,calc(100dvh-10rem))] overflow-y-auto overscroll-contain bg-card border border-app rounded-card-lg shadow-pop p-2 animate-modal">
      <input aria-label="Search city or ZIP" autoComplete="off" value={cityQuery} onChange={(event) => setCityQuery(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Enter' && !searchingCities && suggestions[0]) chooseCity(suggestions[0]);
      }} placeholder="City or ZIP/postal code" className="w-full min-w-0 h-11 px-3 rounded-card border border-strong bg-card text-base sm:text-sm text-main focus:border-accent" />
      <div className="mt-1">
        {searchingCities && <p role="status" className="px-2 py-2 text-xs text-sec">Searching cities…</p>}
        {suggestions.map((city) => {
          const selected = isSelectedCity(city);
          return (
            <button
              type="button"
              key={`${city.city}|${city.state}|${city.country}|${city.postalCode ?? ''}`}
              onClick={() => chooseCity(city)}
              className={`w-full flex items-center justify-between gap-2 min-h-10 px-2 rounded-card text-left text-sm transition-colors duration-fast ${
                selected ? 'bg-accent-soft text-accent font-semibold' : 'text-main hover:bg-subtle'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <MapPin size={14} className={selected ? 'text-accent' : 'text-muted'} />
                {locationLabel(city)}
              </span>
              {selected && <Check size={15} className="text-accent shrink-0" />}
            </button>
          );
        })}
        {!searchingCities && cities.length === 0 && !locationError && <p role="status" className="px-2 py-2 text-xs text-sec">{cityQuery.trim().length >= 2 ? 'No matching location. Try another city or postal code.' : 'Enter a city or ZIP/postal code to search.'}</p>}
        {locationError && <p role="status" className="px-2 py-2 text-xs text-error">{locationError}</p>}
      </div>
      <div className="mt-1 pt-2 border-t border-app">
        {locationPermission === 'denied' && <p className="px-2 pb-2 text-xs text-sec">Location access is blocked. Allow it in browser settings, or enter a city or ZIP code above.</p>}
        <button type="button" onClick={() => void chooseBrowserLocation()} disabled={locating || locationPermission === 'denied'} className="w-full flex items-center gap-2.5 min-h-10 px-2 rounded-card text-left text-sm font-medium text-main hover:bg-subtle disabled:opacity-60">
          <LocateFixed size={16} className="text-accent shrink-0" />
          {locating ? 'Finding your city…' : locationPermission === 'denied' ? 'Location blocked' : 'Use my current location'}
        </button>
        {location.source !== 'NONE' && (
          <button type="button" onClick={() => { clearLocation(); onLocationChange?.({ city: '', state: '', country: '', source: 'NONE' }); setShowLocMenu(false); }} className="w-full flex items-center gap-2.5 min-h-10 px-2 rounded-card text-left text-xs font-medium text-sec hover:bg-subtle hover:text-main">
            <Map size={14} className="text-muted shrink-0" />Browse without a location
          </button>
        )}
      </div>
    </div>
  );

  return (
    // No z-index here: it would cap the location/date popovers below the shared dim Overlay (z-200).
    <div className="relative w-full min-w-0">
      {/* Not portaled: a portaled backdrop lives in a different stacking context than this menu,
          so its z-index can't be trusted to lose against the menu's z-[210]. Staying in the same
          local tree keeps the two comparable and the menu reliably clickable. */}
      {showLocMenu && (
        <button type="button" className="fixed inset-0 z-[200] bg-black/45 animate-fade-in" onClick={() => setShowLocMenu(false)} aria-label="Close location picker" />
      )}
      {/* Desktop: one pill, three segments, one action. Segments light up on hover/focus. */}
      <div
        className={`search-control hidden sm:flex flex-wrap gap-y-2 items-center w-full min-w-0 glass-surface border border-app rounded-card-lg shadow-xs
          transition-shadow duration-standard ease-out focus-within:shadow-hover hover:shadow-hover
          ${variant === 'hero' ? 'p-1.5' : 'p-1'}`}
      >
        <div className="search-input-shell flex-1 min-w-[10rem] flex items-center gap-2.5 pl-4 pr-3 h-11 rounded-card transition-colors duration-fast hover:bg-subtle focus-within:bg-subtle">
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
            onClick={toggleLocation}
            aria-haspopup="dialog"
            aria-expanded={showLocMenu}
            className="flex items-center gap-2 px-4 h-11 rounded-card text-sm font-medium text-main whitespace-nowrap transition-colors duration-fast hover:bg-subtle"
          >
            {location.source === 'BROWSER' ? <LocateFixed size={16} className="shrink-0 text-accent" /> : <MapPin size={16} className="shrink-0 text-accent" />}
            <span className="max-w-32 truncate">{displayLocation}</span>
            <ChevronDown size={14} className={`text-muted transition-transform duration-fast ${showLocMenu ? 'rotate-180' : ''}`} />
          </button>
          {showLocMenu && locationMenu}
        </div>

        <div className="w-36 shrink-0">
          <SearchRadiusSelect value={radius} onChange={changeRadius} />
        </div>
        <div className="min-w-0 shrink-0 ml-auto">
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
            <span className="text-xs text-sec min-w-0 max-w-40 text-right">
              <span className="block truncate">{displayLocation}</span>
              <span className="block">{radius === null ? 'Any distance' : `Within ${radius} miles`}</span>
            </span>
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
                onClick={toggleLocation}
                aria-haspopup="dialog"
                aria-expanded={showLocMenu}
                className="w-full flex items-center justify-between h-11 px-3 rounded-card bg-subtle text-sm font-medium text-main"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <MapPin size={15} className="text-accent" />
                  <span className="truncate">{displayLocation}</span>
                </span>
                <ChevronDown size={14} className={`text-muted transition-transform duration-fast ${showLocMenu ? 'rotate-180' : ''}`} />
              </button>
              {showLocMenu && locationMenu}
            </div>

            <SearchRadiusSelect value={radius} onChange={changeRadius} />

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
      <p className={`mt-2 text-xs ${variant === 'compact' && !mobileExpanded ? 'hidden sm:block' : ''} ${variant === 'hero' ? 'text-white/90' : 'text-sec'}`}>
        Dates are optional.{location.source === 'NONE' ? ' Choose a location to apply your radius, or search all locations.' : ' Distances are approximate; exact pickup addresses stay private.'}
      </p>
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
