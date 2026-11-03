import { useEffect, useRef, useState } from 'react';
import { Check, LocateFixed, LockKeyhole, MapPin } from 'lucide-react';
import { useMarketplaceLocation } from '@/location-context';
import { fieldClass } from '@/components/form-classes';
import { loadGooglePlaces } from '@/lib/google-maps';
import { countryIsAllowed, fetchMarketplaceCountries, type MarketplaceCountry } from '@/lib/marketplace-countries';
import { currentPickupLocation, type PickupLocationValue } from '@/lib/pickup-location';
export type { PickupLocationValue } from '@/lib/pickup-location';

type AddressComponent = { longText?: string; shortText?: string; types: string[] };
type SelectedPlace = {
  id?: string;
  formattedAddress?: string;
  addressComponents?: AddressComponent[];
  location?: { lat: () => number; lng: () => number };
  fetchFields: (options: { fields: string[] }) => Promise<void>;
};
type PlacePredictionSelectEvent = Event & { placePrediction: { toPlace: () => SelectedPlace } };

function getComponent(place: SelectedPlace, type: string, short = false): string {
  const match = place.addressComponents?.find((item) => item.types.includes(type));
  return match ? (short ? match.shortText : match.longText) ?? '' : '';
}

export function PickupLocation({ value, onChange, showAreaMap = false }: { value: PickupLocationValue; onChange: (value: PickupLocationValue) => void; showAreaMap?: boolean }) {
  const { location } = useMarketplaceLocation();
  const autocompleteContainerRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [placesError, setPlacesError] = useState<string | null>(null);
  const [countries, setCountries] = useState<MarketplaceCountry[]>([]);
  const [pickupCountry, setPickupCountry] = useState(value.country || location.country);
  const searchCity = value.city || location.city;
  const searchState = value.city ? value.state : location.state;
  const searchCountry = value.country || location.country;
  const searchLatitude = value.latitude ?? location.latitude;
  const searchLongitude = value.longitude ?? location.longitude;
  const googleKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  useEffect(() => {
    if (!googleKey || !autocompleteContainerRef.current) return;
    let disposed = false;
    let element: HTMLElement | null = null;

    void Promise.all([loadGooglePlaces(), fetchMarketplaceCountries()])
      .then(([{ PlaceAutocompleteElement }, allowed]) => {
        if (disposed || !autocompleteContainerRef.current) return;
        setCountries(allowed);
        const country = allowed.find(item => countryIsAllowed(pickupCountry, [item])) ?? allowed[0];
        const autocomplete = new PlaceAutocompleteElement();
        element = autocomplete;
        const nearby = countryIsAllowed(searchCountry, [country]);
        element.setAttribute('placeholder', nearby && searchCity ? `Search pickup address in ${[searchCity, searchState].filter(Boolean).join(', ')}` : 'Search pickup address...');
        element.setAttribute('aria-label', 'Pickup Address');
        element.setAttribute('included-region-codes', country.code.toLowerCase());
        if (nearby && searchLatitude != null && searchLongitude != null) {
          autocomplete.locationBias = { center: { lat: searchLatitude, lng: searchLongitude }, radius: 25000 };
        }
        element.style.width = '100%';
        element.addEventListener('gmp-select', async (event) => {
          const prediction = (event as PlacePredictionSelectEvent).placePrediction;
          if (!prediction) return;
          const place = prediction.toPlace();
          try {
            await place.fetchFields({ fields: ['id', 'formattedAddress', 'addressComponents', 'location'] });
            if (disposed) return;
            if (!place.formattedAddress || !place.location) throw new Error('Choose a complete pickup address from the search results.');
            if (!countryIsAllowed(getComponent(place, 'country', true), [country])
              || !countryIsAllowed(getComponent(place, 'country', true), await fetchMarketplaceCountries())) {
              throw new Error('Choose a pickup address in an enabled marketplace country.');
            }
            if (disposed) return;
            const streetAddress = [getComponent(place, 'street_number'), getComponent(place, 'route')].filter(Boolean).join(' ');
            const city = getComponent(place, 'locality') || getComponent(place, 'postal_town') || getComponent(place, 'sublocality_level_1');
            if (!city) throw new Error('Choose a complete pickup address with a city from the search results.');
            onChangeRef.current({
              formattedAddress: place.formattedAddress,
              streetAddress,
              city,
              state: getComponent(place, 'administrative_area_level_1', true),
              postalCode: getComponent(place, 'postal_code'),
              country: getComponent(place, 'country', true),
              latitude: place.location.lat(),
              longitude: place.location.lng(),
              placeId: place.id ?? '',
            });
            setPlacesError(null);
          } catch (error) {
            if (!disposed) setPlacesError(error instanceof Error ? error.message : 'Could not select this pickup address. Please try again.');
          }
        });
        autocompleteContainerRef.current.replaceChildren(element);
      })
      .catch((error: unknown) => {
        if (!disposed) setPlacesError(error instanceof Error ? error.message : 'Google Places could not initialize.');
      });

    return () => {
      disposed = true;
      element?.remove();
    };
  }, [googleKey, pickupCountry, searchCity, searchState, searchCountry, searchLatitude, searchLongitude]);

  async function handleUseCurrentLocation() {
    setLocating(true);
    setLocationError(null);
    try {
      const address = await currentPickupLocation();
      setPickupCountry(address.country);
      onChangeRef.current(address);
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : 'Could not use your location.');
    } finally {
      setLocating(false);
    }
  }

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-base font-bold text-main font-display">Where renters pick up</h2>
        <p className="text-sm text-sec mt-1">Choose the address for handoff. We’ll get the city from that address automatically.</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-card-lg border border-app bg-subtle px-4 py-3">
        <p className="min-w-0 text-sm text-sec">Use your location to fill the pickup address, then check it before saving.</p>
        <button type="button" onClick={() => void handleUseCurrentLocation()} disabled={locating} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-card px-2 text-sm font-semibold text-accent hover:bg-accent-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60">
          <LocateFixed size={16} aria-hidden="true" />{locating ? 'Finding your address…' : 'Use my location'}
        </button>
        {locationError && <p role="status" className="text-xs text-error mt-1">{locationError}</p>}
      </div>

      <div>
        <label htmlFor="pickup-address" className="block text-sm font-semibold text-main mb-1.5">Pickup address</label>
        <p className="mb-2 text-xs leading-relaxed text-sec">Search and select a complete address. The selected address fills in the approximate city renters see.</p>
        {countries.length > 1 && <label className="block text-sm font-semibold text-main mb-2">Pickup country
          <select className={fieldClass('mt-1')} value={countries.find(country => countryIsAllowed(pickupCountry, [country]))?.code ?? countries[0].code}
            onChange={event => {
              setPickupCountry(event.target.value);
              onChangeRef.current({ ...value, country: '', city: '', state: '', formattedAddress: '', streetAddress: '', postalCode: '', latitude: null, longitude: null, placeId: '' });
            }}>
            {countries.map(country => <option key={country.code} value={country.code}>{country.name}</option>)}
          </select>
        </label>}
        {googleKey ? <div ref={autocompleteContainerRef} id="pickup-address" tabIndex={-1} aria-label="Pickup Address" className="min-h-11 rounded-card border border-app bg-card" /> : <p className="text-xs text-muted">Pickup address search is unavailable. Please contact support or try again later.</p>}
        {placesError && <p role="status" className="text-xs text-error mt-1.5">{placesError}</p>}
      </div>

      {value.formattedAddress && <div className="flex min-w-0 items-start gap-3 rounded-card-lg border border-accent/30 bg-accent-soft p-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-card text-accent"><Check size={18} aria-hidden="true" /></span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-accent">Pickup address selected</p>
          <p className="mt-1 break-words text-sm font-semibold text-main">{value.formattedAddress}</p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-sec"><MapPin size={13} aria-hidden="true" />Approximate renter location: {[value.city, value.state].filter(Boolean).join(', ')}</p>
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
          <p className="text-xs leading-relaxed text-sec mt-1">Renters see only the approximate city before booking. The exact address is shared after a booking is confirmed.</p>
        </div>
      </div>
    </section>
  );
}
