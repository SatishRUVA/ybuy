import { useState, useRef, useEffect } from 'react';
import { Search, MapPin, ChevronDown, Check, LocateFixed } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useTheme } from '@/theme-context';
import { Palette, Moon, Check as CheckIcon } from 'lucide-react';
import { findCities, haversineMiles, locationLabel, todayIso, type MarketplaceLocation } from '@/lib/geo';
import { useMarketplaceLocation } from '@/location-context';
import { DateRangePicker } from '@/components/date-range-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/shadcn/select';
import { SEARCH_RADII, parseSearchRadius, savedSearchState, saveSearchState, type SearchRadius } from '@/lib/search-state';
import { Button } from '@/components/ui';

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
  const locationTriggerRef = useRef<HTMLButtonElement | null>(null);

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
      desktopLocRef.current?.querySelector('input')?.focus();
    } else {
      locationTriggerRef.current?.focus();
    }
  }, [showLocMenu, variant]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      const target = e.target as Node;
      const inDesktopMenu = desktopLocRef.current?.contains(target) ?? false;
      if (!inDesktopMenu) setShowLocMenu(false);
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

  return <div className="relative w-full min-w-0">
    {variant === 'compact' && !mobileExpanded && <button type="button" onClick={() => setMobileExpanded(true)} className="p1-search-summary sm:hidden">
      <Search size={18} aria-hidden="true" /><span>{what || 'Search rentals'} {displayLocation} {radius === null ? 'Any distance' : `Within ${radius} miles`}</span><ChevronDown size={16} aria-hidden="true" />
    </button>}
    {showLocMenu && <button type="button" className="fixed inset-0 z-[200] bg-black/45" onClick={() => setShowLocMenu(false)} aria-label="Close location picker" />}
    <form className={`p1-search-bar ${variant === 'compact' ? 'p1-search-compact' : ''} ${!mobileExpanded ? 'p1-search-collapsed' : ''}`} onSubmit={event => { event.preventDefault(); runSearch(); }}>
      <label className="p1-search-keyword"><Search size={21} aria-hidden="true" /><span><small>What do you need?</small>
        <input aria-label="Search for items to rent" value={what} onChange={event => setWhat(event.target.value)} placeholder="Camera, tent, tools..." />
      </span></label>
      <div ref={desktopLocRef} className="p1-search-location relative">
        <button type="button" onClick={toggleLocation} className="p1-search-location-trigger" aria-label={displayLocation} aria-haspopup="dialog" aria-expanded={showLocMenu}>
          <MapPin size={20} aria-hidden="true" /><span><small>Where?</small><strong>{displayLocation}</strong></span><ChevronDown size={14} aria-hidden="true" />
        </button>
        {showLocMenu && locationMenu}
      </div>
      <DateRangePicker startDate={startDate} endDate={endDate} onChange={(start, end) => { setStartDate(start); setEndDate(end); }} presentation="search" />
      <Button type="submit" disabled={location.source === 'NONE'} title={location.source === 'NONE' ? 'Choose a location before searching' : undefined}>
        <Search size={18} aria-hidden="true" />Search
      </Button>
    </form>
    <div className={`p1-search-extras ${!mobileExpanded ? 'p1-search-collapsed' : ''}`}>
      <div className="p1-inline-select">Search radius <SearchRadiusSelect value={radius} onChange={changeRadius} disabled={location.source === 'NONE' || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)} /></div>
    </div>
    <p role="status" className={`text-xs text-sec mt-2 ${!mobileExpanded ? 'p1-search-collapsed' : ''}`}>
      {initialLocationStatus === 'locating' && location.source === 'NONE' ? 'Finding your area…'
        : location.source === 'NONE' ? 'Choose a city or ZIP code before searching nearby.'
          : location.source === 'IP' ? `Approximate area: ${locationLabel(location)}. Choose a city to refine your distance.`
            : 'Dates are optional. Distances are approximate; exact pickup addresses stay private.'}
    </p>
  </div>;

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
