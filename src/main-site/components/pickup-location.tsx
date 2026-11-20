import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, LockKeyhole, MapPin } from 'lucide-react';
import { useMarketplaceLocation } from '@/location-context';
import { findCities } from '@/lib/geo';
import { listingInputClass as fieldClass } from '@/main-site/components/listing-ui-classes';
import { loadGooglePlaces, type GooglePlacePrediction, type GooglePlacesLibrary } from '@/lib/google-maps';
import { countryIsAllowed, fetchMarketplaceCountries, type MarketplaceCountry } from '@/lib/marketplace-countries';
import { pickupTimeZone } from '@/lib/pickup-timezone';
import type { PickupLocationValue } from '@/lib/pickup-location';
export type { PickupLocationValue } from '@/lib/pickup-location';

type GeocoderLibrary = {
  Geocoder: new () => {
    geocode: (request: { address: string }) => Promise<{
      results: {
        formatted_address: string;
        place_id: string;
        address_components: { long_name: string; short_name: string; types: string[] }[];
        geometry: { location: { lat: () => number; lng: () => number } };
      }[];
    }>;
  };
};

function getComponent(place: { addressComponents?: { longText?: string; shortText?: string; types: string[] }[] }, type: string, short = false): string {
  const match = place.addressComponents?.find((item) => item.types.includes(type));
  return match ? (short ? match.shortText : match.longText) ?? '' : '';
}

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

const intlWithTimeZones = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] };
const TIME_ZONES = intlWithTimeZones.supportedValuesOf?.('timeZone') ?? [browserTimeZone(), 'UTC'];

export function PickupLocation({
  value, onChange, showAreaMap = false, error,
}: {
  value: PickupLocationValue;
  onChange: (value: PickupLocationValue) => void;
  showAreaMap?: boolean;
  error?: string | null;
}) {
  const { location } = useMarketplaceLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  const geocodeRequest = useRef(0);
  const [input, setInput] = useState(value.formattedAddress);
  const [places, setPlaces] = useState<GooglePlacesLibrary | null>(null);
  const [suggestions, setSuggestions] = useState<GooglePlacePrediction[]>([]);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [countries, setCountries] = useState<MarketplaceCountry[]>([]);
  const [pickupCountry, setPickupCountry] = useState(value.country || location.country);
  const [countryError, setCountryError] = useState<string | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const googleKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const manualEntry = !value.placeId;
  const countryCode = countries.find(country => countryIsAllowed(pickupCountry, [country]))?.code;
  const manualReady = Boolean(input.trim() && value.city.trim() && value.state.trim()
    && value.postalCode.trim() && (countryCode || countryIsAllowed(value.country, countries))
    && value.timeZone && value.manualConfirmed);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { valueRef.current = value; }, [value]);

  useEffect(() => {
    let disposed = false;
    void fetchMarketplaceCountries().then(allowed => {
      if (disposed) return;
      setCountries(allowed);
      setCountryError(null);
      setPickupCountry(current => current || location.country || allowed[0]?.code || '');
    }).catch((loadError: unknown) => {
      if (!disposed) setCountryError(loadError instanceof Error ? loadError.message : 'Marketplace countries could not be loaded.');
    });
    if (googleKey) {
      void loadGooglePlaces().then(library => {
        if (!disposed) setPlaces(library);
      }).catch(() => {
        if (!disposed) setPlaces(null);
      });
    }
    return () => { disposed = true; };
  }, [googleKey, location.country]);

  useEffect(() => {
    setInput(value.formattedAddress);
    setPickupCountry(value.country || location.country);
  }, [value.formattedAddress, value.country, location.country]);

  useEffect(() => {
    const query = input.trim();
    if (!places || query.length < 3) {
      setSuggestions([]);
      setActiveSuggestion(-1);
      return;
    }
    let active = true;
    const timeout = window.setTimeout(() => {
      const request = {
        input: query,
        ...(countryCode ? { includedRegionCodes: [countryCode.toLowerCase()] } : {}),
      };
      void places.AutocompleteSuggestion.fetchAutocompleteSuggestions(request).then(result => {
        if (!active) return;
        setSuggestions(result.suggestions.flatMap(suggestion => suggestion.placePrediction ? [suggestion.placePrediction] : []));
        setActiveSuggestion(-1);
      }).catch(() => {
        if (active) {
          setSuggestions([]);
          setActiveSuggestion(-1);
        }
      });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [input, places, countryCode]);

  useEffect(() => {
    if (!manualEntry || !value.city.trim() || value.latitude !== null || value.longitude !== null) return;
    const query = [value.postalCode, value.city, value.state].filter(Boolean).join(', ');
    const timeout = window.setTimeout(() => {
      void findCities(query).then(results => {
        const match = results.find(result => result.latitude != null && result.longitude != null
          && result.city.toLowerCase() === value.city.trim().toLowerCase()
          && (!value.country || countryIsAllowed(result.country, [{ code: value.country, name: value.country }])));
        if (!match || valueRef.current.city !== value.city || valueRef.current.state !== value.state) return;
        const next: PickupLocationValue = {
          ...valueRef.current,
          latitude: match.latitude!,
          longitude: match.longitude!,
          timeZone: pickupTimeZone(match.latitude!, match.longitude!),
          manualConfirmed: false,
        };
        onChangeRef.current(next);
      }).catch(() => {
        // Geocoding is optional; the address and owner-confirmed locality remain usable.
      });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [manualEntry, value.city, value.state, value.postalCode, value.country, value.latitude, value.longitude]);

  function updateManualField(field: 'city' | 'state' | 'postalCode', fieldValue: string) {
    const next: PickupLocationValue = {
      ...value,
      [field]: fieldValue,
      streetAddress: input.trim(),
      formattedAddress: input.trim(),
      country: countryCode ?? pickupCountry,
      latitude: null,
      longitude: null,
      timeZone: value.timeZone || browserTimeZone(),
      manualConfirmed: false,
      placeId: '',
    };
    onChangeRef.current(next);
    setAddressError(null);
  }

  function updateAddressText(text: string) {
    setInput(text);
    setAddressError(null);
    geocodeRequest.current += 1;
    onChangeRef.current({
      formattedAddress: text,
      streetAddress: text.trim(),
      city: '',
      state: '',
      postalCode: '',
      country: countryCode ?? pickupCountry,
      latitude: null,
      longitude: null,
      timeZone: browserTimeZone(),
      placeId: '',
      manualConfirmed: false,
    });
  }

  async function geocodeManualAddress() {
    const query = input.trim();
    if (!query || !googleKey || !window.google?.maps?.importLibrary) return;
    const requestId = ++geocodeRequest.current;
    setResolving(true);
    try {
      const { Geocoder } = await window.google.maps.importLibrary('geocoding') as GeocoderLibrary;
      const { results } = await new Geocoder().geocode({ address: query });
      if (requestId !== geocodeRequest.current || inputRef.current?.value.trim() !== query) return;
      const result = results.find(item => {
        const part = (type: string) => item.address_components.find(component => component.types.includes(type))?.long_name ?? '';
        return Boolean(item.formatted_address && part('street_number') && part('route')
          && (part('locality') || part('postal_town') || part('sublocality_level_1'))
          && part('administrative_area_level_1') && part('postal_code') && part('country'));
      });
      if (!result) return;
      const part = (type: string, short = false) => {
        const component = result.address_components.find(item => item.types.includes(type));
        return component ? short ? component.short_name : component.long_name : '';
      };
      const city = part('locality') || part('postal_town') || part('sublocality_level_1');
      const matchedCountry = countries.find(country => countryIsAllowed(part('country', true), [country]));
      if (!matchedCountry) return;
      const latitude = result.geometry.location.lat();
      const longitude = result.geometry.location.lng();
      onChangeRef.current({
        formattedAddress: result.formatted_address,
        streetAddress: `${part('street_number')} ${part('route')}`.trim(),
        city,
        state: part('administrative_area_level_1', true),
        postalCode: part('postal_code'),
        country: matchedCountry.code,
        latitude,
        longitude,
        timeZone: pickupTimeZone(latitude, longitude),
        placeId: '',
        manualConfirmed: false,
      });
      setInput(result.formatted_address);
      setPickupCountry(matchedCountry.code);
    } catch {
      // Google geocoding is progressive enhancement; manual confirmation is the fallback.
    } finally {
      if (requestId === geocodeRequest.current) setResolving(false);
    }
  }

  async function chooseSuggestion(prediction: GooglePlacePrediction) {
    const text = String(prediction.text ?? '');
    setInput(text);
    setSuggestions([]);
    setAddressError(null);
    setResolving(true);
    try {
      const place = prediction.toPlace();
      await place.fetchFields({ fields: ['id', 'formattedAddress', 'addressComponents', 'location'] });
      const formattedAddress = place.formattedAddress?.trim() ?? '';
      const streetAddress = [getComponent(place, 'street_number'), getComponent(place, 'route')].filter(Boolean).join(' ');
      const city = getComponent(place, 'locality') || getComponent(place, 'postal_town') || getComponent(place, 'sublocality_level_1');
      const matchedCountry = countries.find(country => countryIsAllowed(getComponent(place, 'country', true), [country]));
      const latitude = place.location?.lat();
      const longitude = place.location?.lng();
      if (!matchedCountry || !formattedAddress || !streetAddress || !city || !getComponent(place, 'administrative_area_level_1')
        || !getComponent(place, 'postal_code') || latitude == null || longitude == null
        || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        setAddressError('Choose a complete street address with a city, state and ZIP code, or enter those details manually.');
        return;
      }
      setPickupCountry(matchedCountry.code);
      setInput(formattedAddress);
      onChangeRef.current({
        formattedAddress,
        streetAddress,
        city,
        state: getComponent(place, 'administrative_area_level_1', true),
        postalCode: getComponent(place, 'postal_code'),
        country: matchedCountry.code,
        latitude,
        longitude,
        timeZone: pickupTimeZone(latitude, longitude),
        placeId: place.id ?? '',
        manualConfirmed: false,
      });
    } catch {
      updateAddressText(text);
    } finally {
      setResolving(false);
    }
  }

  function handleAddressKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' && suggestions.length) {
      event.preventDefault();
      setActiveSuggestion(current => (current + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp' && suggestions.length) {
      event.preventDefault();
      setActiveSuggestion(current => (current <= 0 ? suggestions.length - 1 : current - 1));
    } else if (event.key === 'Enter' && activeSuggestion >= 0) {
      event.preventDefault();
      void chooseSuggestion(suggestions[activeSuggestion]);
    } else if (event.key === 'Escape') {
      setSuggestions([]);
      setActiveSuggestion(-1);
    }
  }

  function confirmManualAddress(confirmed: boolean) {
    onChangeRef.current({
      ...value,
      formattedAddress: input.trim(),
      streetAddress: input.trim(),
      country: countryCode ?? pickupCountry,
      timeZone: value.timeZone || browserTimeZone(),
      manualConfirmed: confirmed,
    });
  }

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-base font-bold text-main font-display">Where will renters pick up the item?</h2>
        <p className="text-sm text-sec mt-1">Enter the pickup address. We&apos;ll use it to determine the approximate location renters see.</p>
      </div>

      <div>
        <label htmlFor="pickup-address" className="block text-sm font-semibold text-main mb-1.5">Pickup address</label>
        <p className="mb-2 text-xs leading-relaxed text-sec">Select an address suggestion or enter the complete address manually.</p>
        {countries.length > 1 && <label className="block text-sm font-semibold text-main mb-2">Pickup country
          <select className={fieldClass('mt-1')} value={countryCode ?? pickupCountry}
            onChange={event => {
              const nextCountry = event.target.value;
              setPickupCountry(nextCountry);
              setAddressError(null);
              onChangeRef.current({
                ...value, country: nextCountry, latitude: null, longitude: null, placeId: '', manualConfirmed: false,
              });
            }}>
            {countries.map(country => <option key={country.code} value={country.code}>{country.name}</option>)}
          </select>
        </label>}
        {countryError && !pickupCountry && <p role="status" className="mb-2 text-xs text-error">{countryError}</p>}
        <div className="relative">
          <input
            ref={inputRef}
            id="pickup-address"
            autoComplete="street-address"
            type="text"
            value={input}
            onChange={event => updateAddressText(event.target.value)}
            onBlur={() => { window.setTimeout(() => setSuggestions([]), 120); void geocodeManualAddress(); }}
            onKeyDown={handleAddressKeyDown}
            placeholder="Enter street address, city, ZIP code"
            className={fieldClass(error ? 'border-error' : '')}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={suggestions.length > 0}
            aria-controls="pickup-address-suggestions"
            aria-activedescendant={activeSuggestion >= 0 ? `pickup-address-suggestion-${activeSuggestion}` : undefined}
            aria-invalid={Boolean(error || addressError)}
            aria-describedby={error ? 'listing-pickup-error' : addressError ? 'pickup-address-error' : undefined}
          />
          {suggestions.length > 0 && <ul id="pickup-address-suggestions" role="listbox" aria-label="Address suggestions"
            className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-card border border-app bg-card p-1 shadow-lg">
            {suggestions.map((suggestion, index) => {
              const label = String(suggestion.text ?? '');
              return <li key={`${label}-${index}`} role="presentation">
                <button
                  id={`pickup-address-suggestion-${index}`}
                  type="button"
                  role="option"
                  aria-selected={activeSuggestion === index}
                  className={`min-h-11 w-full rounded-card px-3 py-2 text-left text-sm text-main hover:bg-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${activeSuggestion === index ? 'bg-subtle' : ''}`}
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => void chooseSuggestion(suggestion)}
                >{label}</button>
              </li>;
            })}
          </ul>}
        </div>
        {resolving && <p role="status" className="mt-1.5 text-xs text-sec">Checking this address…</p>}
        {addressError && <p id="pickup-address-error" role="alert" className="mt-1.5 text-sm text-error">{addressError}</p>}
      </div>

      {manualEntry && <fieldset className="space-y-3 rounded-card-lg border border-app bg-subtle p-4">
        <legend className="px-1 text-sm font-semibold text-main">Confirm the approximate location</legend>
        <p className="text-xs leading-relaxed text-sec">We couldn&apos;t fill these details from a suggestion. Confirm the city, state and ZIP code renters will see.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm font-medium text-main">City
            <input autoComplete="address-level2" required value={value.city} onChange={event => updateManualField('city', event.target.value)}
              className={fieldClass('mt-1')} placeholder="City" />
          </label>
          <label className="text-sm font-medium text-main">State
            <input autoComplete="address-level1" required value={value.state} onChange={event => updateManualField('state', event.target.value)}
              className={fieldClass('mt-1')} placeholder="State" />
          </label>
          <label className="text-sm font-medium text-main">ZIP code
            <input autoComplete="postal-code" required value={value.postalCode} onChange={event => updateManualField('postalCode', event.target.value)}
              className={fieldClass('mt-1')} placeholder="ZIP code" />
          </label>
        </div>
        {countries.length > 1 && <p className="text-xs text-sec">Pickup country: {countries.find(country => country.code === countryCode)?.name ?? pickupCountry}</p>}
        {value.latitude === null && value.longitude === null && <label className="block text-sm font-medium text-main">
          Pickup time zone
          <select className={fieldClass('mt-1')} value={value.timeZone || browserTimeZone()}
            onChange={event => onChangeRef.current({ ...value, timeZone: event.target.value, manualConfirmed: false })}>
            {[...new Set([value.timeZone || browserTimeZone(), browserTimeZone(), ...TIME_ZONES])]
              .map(zone => <option key={zone} value={zone}>{zone}</option>)}
          </select>
          <span className="mt-1 block text-xs font-normal text-sec">No location coordinates are available, so this time zone is used for pickup scheduling.</span>
        </label>}
        <label className="flex items-start gap-2 text-sm text-main">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--accent)]" checked={Boolean(value.manualConfirmed)}
            disabled={!input.trim() || !value.city.trim() || !value.state.trim() || !value.postalCode.trim() || !value.country
              || !value.timeZone || (value.latitude === null && value.longitude !== null) || (value.latitude !== null && value.longitude === null)}
            onChange={event => confirmManualAddress(event.target.checked)} />
          <span>I confirm this city, state, ZIP code and pickup time zone are correct.</span>
        </label>
        {manualReady && <p role="status" className="flex items-center gap-2 text-xs text-sec">
          <Check size={15} aria-hidden="true" className="text-accent" />Manual address confirmed
        </p>}
      </fieldset>}

      {value.formattedAddress && <div className="flex min-w-0 items-start gap-3 rounded-card-lg border border-accent/30 bg-accent-soft p-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-card text-accent"><Check size={18} aria-hidden="true" /></span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-accent">Pickup address</p>
          <p className="mt-1 break-words text-sm font-semibold text-main">{value.formattedAddress}</p>
          {value.city && <p className="mt-1 flex items-center gap-1.5 text-xs text-sec"><MapPin size={13} aria-hidden="true" />Approximate renter location: {[value.city, value.state].filter(Boolean).join(', ')}</p>}
        </div>
      </div>}
      {showAreaMap && value.city && <figure className="overflow-hidden rounded-card border border-app">
        <iframe title="Approximate pickup area" loading="lazy" referrerPolicy="no-referrer"
          src={`https://maps.google.com/maps?q=${encodeURIComponent([value.city, value.state, value.country].filter(Boolean).join(', '))}&z=11&output=embed`}
          className="h-44 w-full border-0" />
        <figcaption className="bg-subtle p-3 text-center text-xs text-sec">This map shows the city only, not your exact pickup address.</figcaption>
      </figure>}
      <div className="flex items-start gap-3 rounded-card-lg border border-app bg-card p-4">
        <LockKeyhole aria-hidden="true" size={18} className="shrink-0 text-accent mt-0.5" />
        <div><p className="text-sm font-semibold text-main">Your exact address stays private</p>
          <p className="text-xs leading-relaxed text-sec mt-1">Renters see your approximate city before booking. Your exact pickup address is shared only after booking confirmation.</p>
        </div>
      </div>
    </section>
  );
}
