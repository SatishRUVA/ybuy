import { useState, useRef, useEffect } from 'react';
import { Search, MapPin, ChevronDown, Check, LocateFixed } from 'lucide-react';
import { useTheme } from '@/theme-context';
import { Palette, Moon, Check as CheckIcon } from 'lucide-react';
import { CITY_CENTERS, todayIso, addDaysIso } from '@/lib/geo';
import { DateRangePicker } from '@/components/date-range-picker';

export interface SearchParams {
  keyword: string;
  /** null = "Near me" (resolve via browser geolocation); undefined = no location filter applied yet. */
  coords: { lat: number; lng: number } | null | undefined;
  locationLabel: string;
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

export function SearchBar({ onSearch, variant = 'hero', defaultValue = '' }: { onSearch?: (params: SearchParams) => void; variant?: 'hero' | 'compact'; defaultValue?: string }) {
  const [what, setWhat] = useState(defaultValue);
  const [location, setLocation] = useState('Near me');
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const today = todayIso();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(addDaysIso(today, 1));
  const [showLocMenu, setShowLocMenu] = useState(false);
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

  function runSearch() {
    const coords = location === 'Near me' ? null : CITY_CENTERS[location];
    onSearch?.({ keyword: what, coords, locationLabel: location, startDate, endDate });
  }

  const locations: { label: string; value: string }[] = [
    { label: 'Nearby', value: 'Near me' },
    ...Object.keys(CITY_CENTERS).map((city) => ({ label: city, value: city })),
  ];
  const locationLabel = location === 'Near me' ? 'Nearby' : location;

  return (
    <div className="relative z-[80] w-full min-w-0 space-y-3">
      <div className={`hidden sm:flex items-center gap-2 w-full min-w-0 ${variant === 'hero' ? 'p-2' : 'p-1.5'} rounded-card-xl bg-card border border-app shadow-card hover:shadow-hover focus-within:ring-2 focus-within:ring-accent/40 transition-shadow`}>
        <div className="flex-1 flex items-center gap-2 px-3">
          <Search size={18} className="text-sec shrink-0" />
          <label htmlFor="search-what" className="sr-only">Search for items to rent</label>
          <input
            id="search-what"
            name="search-what"
            value={what}
            onChange={(e) => setWhat(e.target.value)}
            placeholder={PLACEHOLDER_EXAMPLES[placeholderIndex]}
            aria-label="Search for items to rent"
            className="flex-1 bg-transparent outline-none text-sm text-main placeholder:text-muted min-w-0 transition-opacity"
            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
          />
        </div>
        <div className="w-px h-8 border-l border-app" />
        <div ref={desktopLocRef} className="relative min-w-0">
          <button
            onClick={() => setShowLocMenu(!showLocMenu)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-main hover:text-main transition-colors whitespace-nowrap"
          >
            {location === 'Near me' ? <LocateFixed size={16} className="shrink-0 text-accent" /> : <MapPin size={16} className="shrink-0 text-accent" />}
            <span className="max-w-32 truncate">{locationLabel}</span>
            <ChevronDown size={14} className="text-muted" />
          </button>
          {showLocMenu && (
            <div className="absolute top-full mt-2 left-0 z-[100] w-52 bg-card border border-app rounded-card-lg shadow-hover py-1.5 animate-modal">
              {locations.map((loc) => (
                <button
                  key={loc.value}
                  onClick={() => { setLocation(loc.value); setShowLocMenu(false); }}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm text-sec hover:bg-subtle transition-colors"
                >
                  {loc.label}
                  {loc.value === location && <Check size={14} className="text-accent" />}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="hidden lg:block w-px h-8 border-l border-app" />
        <div className="hidden lg:block">
          <DateRangePicker startDate={startDate} endDate={endDate} onChange={(s, e) => { setStartDate(s); setEndDate(e); }} />
        </div>
        <button
          onClick={runSearch}
          className="bg-accent text-accent-text px-6 py-2.5 rounded-card-lg font-semibold text-sm hover:opacity-90 active:scale-[0.98] transition-all flex items-center gap-2 shrink-0"
        >
          <Search size={16} />
          <span>Search</span>
        </button>
      </div>

      <div className="sm:hidden rounded-card-xl bg-card border border-app shadow-card p-4 space-y-3">
        <div className="flex items-center gap-2 border-b border-app pb-2.5">
          <Search size={16} className="text-muted shrink-0" />
          <input
            value={what}
            onChange={(e) => setWhat(e.target.value)}
            placeholder={PLACEHOLDER_EXAMPLES[placeholderIndex]}
            aria-label="What do you need?"
            className="w-full bg-transparent outline-none text-sm text-main placeholder:text-muted"
            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
          />
        </div>

        <div ref={mobileLocRef} className="relative border-b border-app pb-2.5">
          <button
            onClick={() => setShowLocMenu(!showLocMenu)}
            className="w-full flex items-center justify-between text-sm text-main"
          >
            <span className="flex items-center gap-2">
              <MapPin size={15} className="text-accent" />
              {locationLabel}
            </span>
            <ChevronDown size={14} className="text-muted" />
          </button>
          {showLocMenu && (
            <div className="absolute top-full mt-2 left-0 right-0 z-[100] bg-card border border-app rounded-card-lg shadow-hover py-1.5 animate-modal">
              {locations.map((loc) => (
                <button
                  key={loc.value}
                  onClick={() => { setLocation(loc.value); setShowLocMenu(false); }}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm text-sec hover:bg-subtle transition-colors"
                >
                  {loc.label}
                  {loc.value === location && <Check size={14} className="text-accent" />}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="border-b border-app pb-2.5">
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onChange={(s, e) => { setStartDate(s); setEndDate(e); }}
            mode="range"
          />
        </div>

        <button
          onClick={runSearch}
          className="w-full bg-accent text-accent-text py-2.5 rounded-card-lg font-semibold text-sm hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
        >
          <Search size={16} />
          <span>Search nearby</span>
        </button>
        <p className="text-xs text-sec text-center">You can change dates and location anytime.</p>
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
