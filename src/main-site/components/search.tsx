import { useState, useRef, useEffect } from 'react';
import { Search, MapPin, ChevronDown, Check, LocateFixed } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useTheme } from '@/theme-context';
import { Palette, Moon, Check as CheckIcon } from 'lucide-react';
import { findCities, haversineMiles, locationLabel, todayIso, type MarketplaceLocation } from '@/lib/geo';
import { useMarketplaceLocation } from '@/location-context';
import { DateRangePicker } from '@/main-site/components/date-range-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/main-site/components/shadcn/select';
import { SEARCH_RADII, parseSearchRadius, savedSearchState, saveSearchState, type SearchRadius } from '@/lib/search-state';

export interface SearchParams {
  keyword: string;
  location: MarketplaceLocation;
  startDate: string;
  endDate: string;
  radius: SearchRadius;
}

export function SearchRadiusSelect({ value, onChange, label = 'Search radius', disabled = false }: {
  value: SearchRadius; onChange: (value: SearchRadius) => void; label?: string; disabled?: boolean;
}) {
  return (
    <div className="search-radius-wrap relative min-w-0">
      <MapPin size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-accent" />
      <Select value={value === null ? 'any' : String(value)} disabled={disabled} onValueChange={(next) => onChange(parseSearchRadius(next))}>
        <SelectTrigger aria-label={`${label}: ${value === null ? 'any distance' : `within ${value} miles`}`}
          title={disabled ? 'Choose a location before setting a distance' : label}
          className="search-radius-select h-11 pl-9 pr-3 text-sm font-semibold">
          <SelectValue>{value === null ? 'Any distance' : `${value} mi`}</SelectValue>
        </SelectTrigger>
        <SelectContent align="start" className="search-radius-content min-w-[11rem]">
          {SEARCH_RADII.map((miles) => <SelectItem key={miles} value={String(miles)} className="min-h-11">Within {miles} miles</SelectItem>)}
          <SelectItem value="any" className="min-h-11">Any distance</SelectItem>
        </SelectContent>
      </Select>
    </div>
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
  const { location, selectCity, requestBrowserLocation, resolveInitialLocation } = useMarketplaceLocation();
  const [what, setWhat] = useState(defaultValue);
  const [cityQuery, setCityQuery] = useState('');
  const [cities, setCities] = useState<MarketplaceLocation[]>([]);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [searchingCities, setSearchingCities] = useState(false);
  const [locating, setLocating] = useState(false);
  const [initialLocationStatus, setInitialLocationStatus] = useState<'idle' | 'locating' | 'manual'>('idle');
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
  const reduceMotion = useReducedMotion();
  const desktopLocRef = useRef<HTMLDivElement>(null);
  const mobileLocRef = useRef<HTMLDivElement>(null);
  const locationTriggerRef = useRef<HTMLButtonElement | null>(null);
  const locationMenuWasOpen = useRef(false);

  useEffect(() => {
    if (variant !== 'hero' || location.source !== 'NONE') return;
    let active = true;
    setInitialLocationStatus('locating');
    void resolveInitialLocation().then((resolved) => {
      if (active) setInitialLocationStatus(resolved ? 'idle' : 'manual');
    }).catch(() => {
      if (active) setInitialLocationStatus('manual');
    });
    return () => { active = false; };
  }, [variant, location.source, resolveInitialLocation]);

  useEffect(() => { setWhat(defaultValue); }, [defaultValue]);
  useEffect(() => {
    const today = todayIso();
    const safeStart = initialStartDate && initialStartDate >= today ? initialStartDate : '';
    const safeEnd = safeStart && initialEndDate && initialEndDate > safeStart ? initialEndDate : '';
    setStartDate(safeStart);
    setEndDate(safeEnd);
  }, [initialStartDate, initialEndDate]);
  useEffect(() => {
    if (variant === 'hero') saveSearchState({ ...savedSearchState(), q: what, start: startDate, end: endDate, radius });
  }, [variant, what, startDate, endDate, radius]);

  useEffect(() => {
    if (showLocMenu) {
      const container = window.matchMedia('(min-width: 640px)').matches ? desktopLocRef.current : mobileLocRef.current;
      container?.querySelector('input')?.focus();
    } else if (locationMenuWasOpen.current) {
      locationTriggerRef.current?.focus();
    }
    locationMenuWasOpen.current = showLocMenu;
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
    setLocationError(null);
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
    if (location.source === 'NONE') {
      setLocationError('Choose a city or ZIP code, or enable location access, to search nearby.');
      setShowLocMenu(true);
      return;
    }
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

  async function chooseCity(city: MarketplaceLocation) {
    try {
      await selectCity(city);
      onLocationChange?.(city);
      setLocationError(null);
      setCityQuery('');
      setShowLocMenu(false);
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : 'Could not select this city.');
    }
  }

  const displayLocation = location.source === 'IP' ? `Near ${locationLabel(location)}` : location.city ? locationLabel(location) : initialLocationStatus === 'locating' ? 'Finding nearby…' : 'Choose your area';

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
    <motion.div role="dialog" aria-modal="true" aria-label="Choose location"
      initial={reduceMotion ? false : { opacity: 0, y: 7, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
      onKeyDown={(event) => {
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
              className={`w-full flex items-center justify-between gap-2 min-h-11 px-2 rounded-card text-left text-sm transition-colors duration-fast ${
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
        {!searchingCities && cityQuery.trim().length >= 2 && cities.length === 0 && !locationError && <p role="status" className="px-2 py-2 text-xs text-sec">No matching location. Try another search.</p>}
        {locationError && <p role="status" className="px-2 py-2 text-xs text-error">{locationError}</p>}
      </div>
      <div className="mt-1 pt-2 border-t border-app">
        <button type="button" onClick={() => void chooseBrowserLocation()} disabled={locating || locationPermission === 'denied'} className="w-full flex items-center gap-2.5 min-h-11 px-2 rounded-card text-left text-sm font-medium text-main hover:bg-subtle disabled:opacity-60">
          <LocateFixed size={16} className="text-accent shrink-0" />
          {locating ? 'Finding your location…' : locationPermission === 'denied' ? 'Location blocked in browser settings' : 'Use current location'}
        </button>
      </div>
    </motion.div>
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
        className={`search-control hidden sm:grid items-center w-full min-w-0 glass-surface border border-app rounded-card-lg shadow-xs
          transition-shadow duration-standard ease-out focus-within:shadow-hover hover:shadow-hover
          ${variant === 'hero' ? 'p-1.5' : 'p-1'}`}
      >
        <div className="search-input-shell search-field-keyword flex min-w-0 items-center gap-2.5 pl-4 pr-3 h-12 rounded-card transition-colors duration-fast hover:bg-subtle focus-within:bg-subtle">
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

        <span className="search-field-divider w-px h-7 bg-[var(--border)] shrink-0" aria-hidden="true" />

        <div ref={desktopLocRef} className="search-field-location relative min-w-0">
          <button
            onClick={toggleLocation}
            aria-haspopup="dialog"
            aria-expanded={showLocMenu}
            className="flex w-full min-w-0 items-center gap-2 px-3 h-12 rounded-card text-sm font-medium text-main transition-colors duration-fast hover:bg-subtle"
          >
            {location.source === 'BROWSER' ? <LocateFixed size={16} className="shrink-0 text-accent" /> : <MapPin size={16} className="shrink-0 text-accent" />}
            <span className="min-w-0 flex-1 truncate text-left">{displayLocation}</span>
            <ChevronDown size={14} className={`text-muted transition-transform duration-fast ${showLocMenu ? 'rotate-180' : ''}`} />
          </button>
          {showLocMenu && locationMenu}
        </div>

        <div className="search-field-radius min-w-0">
          <SearchRadiusSelect value={radius} onChange={changeRadius} disabled={location.source === 'NONE' || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)} />
        </div>
        <div className="search-field-dates min-w-0">
          <DateRangePicker startDate={startDate} endDate={endDate} onChange={(s, e) => { setStartDate(s); setEndDate(e); }} presentation="search" />
        </div>

        <button
          onClick={runSearch}
          disabled={location.source === 'NONE'}
          title={location.source === 'NONE' ? 'Choose a location before searching' : undefined}
          className="search-field-submit inline-flex items-center justify-center gap-2 h-12 px-5 rounded-card bg-accent text-accent-text font-semibold text-sm hover:bg-accent-hover active:scale-[0.98] transition-all duration-fast disabled:cursor-not-allowed disabled:opacity-55"
        >
          <Search size={16} />
          <span>Search</span>
        </button>
      </div>

      {/* Mobile: compact summary that expands into the full form. */}
      <div className="sm:hidden">
        <AnimatePresence initial={false} mode="wait">
        {!mobileExpanded ? (
          <motion.div key="search-summary" initial={reduceMotion ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? undefined : { opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
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
          </button></motion.div>
        ) : (
          <motion.div key="search-expanded" initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.99 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduceMotion ? undefined : { opacity: 0, y: -5 }} transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }} className="rounded-card-xl glass-surface border border-app shadow-card p-3.5 space-y-3">
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
                  {location.source === 'BROWSER' ? <LocateFixed size={15} className="text-accent" /> : <MapPin size={15} className="text-accent" />}
                  <span className="truncate">{displayLocation}</span>
                </span>
                <ChevronDown size={14} className={`text-muted transition-transform duration-fast ${showLocMenu ? 'rotate-180' : ''}`} />
              </button>
              {showLocMenu && locationMenu}
            </div>

            <SearchRadiusSelect value={radius} onChange={changeRadius} disabled={location.source === 'NONE' || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)} />

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
              disabled={location.source === 'NONE'}
              title={location.source === 'NONE' ? 'Choose a location before searching' : undefined}
              className="w-full h-12 rounded-card bg-accent text-accent-text font-semibold text-sm active:scale-[0.99] transition-transform duration-fast flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-55"
            >
              <Search size={16} />
              Search
            </button>
          </motion.div>
        )}
        </AnimatePresence>
      </div>
      <p role={initialLocationStatus === 'locating' ? 'status' : undefined} className={`mt-2 text-xs ${variant === 'compact' && !mobileExpanded ? 'hidden sm:block' : ''} ${variant === 'hero' ? 'text-white/90' : 'text-sec'}`}>
        {initialLocationStatus === 'locating' && location.source === 'NONE'
          ? 'Finding your area… You can still search while we check.'
          : location.source === 'IP'
            ? `Approximate area: ${locationLabel(location)}. Choose a city to refine your distance.`
            : location.source === 'NONE'
              ? 'We couldn’t determine your location. Choose a city or ZIP code before searching nearby.'
              : 'Dates are optional. Distances are approximate; exact pickup addresses stay private.'}
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
