import { useEffect, useRef, useState } from 'react';
import { LocateFixed, MapPin } from 'lucide-react';
import { useMarketplaceLocation } from '@/location-context';
import { fieldClass } from '@/components/form-classes';
import { loadGooglePlaces } from '@/lib/google-maps';

export interface PickupLocationValue {
  formattedAddress: string;
  streetAddress: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  placeId: string;
}

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

export function PickupLocation({ value, onChange, onConfirm }: { value: PickupLocationValue; onChange: (value: PickupLocationValue) => void; onConfirm: () => void }) {
  const { location, requestBrowserLocation } = useMarketplaceLocation();
  const autocompleteContainerRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [placesError, setPlacesError] = useState<string | null>(null);
  const googleKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  useEffect(() => {
    if (!googleKey || !autocompleteContainerRef.current) return;
    let disposed = false;
    let element: HTMLElement | null = null;

    void loadGooglePlaces()
      .then(({ PlaceAutocompleteElement }) => {
        if (disposed || !autocompleteContainerRef.current) return;
        element = new PlaceAutocompleteElement();
        element.setAttribute('placeholder', 'Search street address...');
        element.setAttribute('included-region-codes', 'us');
        element.style.width = '100%';
        element.addEventListener('gmp-select', async (event) => {
          const prediction = (event as PlacePredictionSelectEvent).placePrediction;
          if (!prediction) return;
          const place = prediction.toPlace();
          await place.fetchFields({ fields: ['id', 'formattedAddress', 'addressComponents', 'location'] });
          if (!place.formattedAddress || !place.location) return;

          const streetAddress = [getComponent(place, 'street_number'), getComponent(place, 'route')].filter(Boolean).join(' ');
          onChangeRef.current({
            formattedAddress: place.formattedAddress,
            streetAddress,
            city: getComponent(place, 'locality') || getComponent(place, 'postal_town') || getComponent(place, 'sublocality_level_1'),
            state: getComponent(place, 'administrative_area_level_1', true),
            postalCode: getComponent(place, 'postal_code'),
            country: getComponent(place, 'country', true),
            latitude: place.location.lat(),
            longitude: place.location.lng(),
            placeId: place.id ?? '',
          });
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
  }, [googleKey]);

  useEffect(() => {
    if (location.source !== 'BROWSER' || !location.city) return;
    const next = { ...value, city: location.city, state: location.state, latitude: location.latitude ?? value.latitude, longitude: location.longitude ?? value.longitude };
    if (next.city !== value.city || next.state !== value.state || next.latitude !== value.latitude || next.longitude !== value.longitude) onChangeRef.current(next);
  }, [location, value]);

  async function handleUseCurrentLocation() {
    setLocating(true);
    setLocationError(null);
    try {
      await requestBrowserLocation();
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : 'Could not use your location.');
    } finally {
      setLocating(false);
    }
  }

  const canConfirm = Boolean(value.formattedAddress && value.city && value.latitude !== null && value.longitude !== null);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-main font-display">Pickup Location</h2>
        <p className="text-sm text-sec mt-1">Your exact address stays private and is used only for rental pickup.</p>
      </div>

      <div>
        <label htmlFor="pickup-city" className="block text-sm font-semibold text-main mb-1.5">City</label>
        <div className="relative">
          <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input id="pickup-city" value={value.city} onChange={(event) => onChange({ ...value, city: event.target.value })} placeholder="Irving, TX" className={fieldClass('pl-9')} />
        </div>
        <button type="button" onClick={() => void handleUseCurrentLocation()} disabled={locating} className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-accent hover:underline disabled:opacity-60">
          <LocateFixed size={15} />{locating ? 'Finding your city…' : 'Use my current location'}
        </button>
        {locationError && <p role="status" className="text-xs text-error mt-1">{locationError}</p>}
      </div>

      <div>
        <label htmlFor="pickup-address" className="block text-sm font-semibold text-main mb-1.5">Pickup Address</label>
        {googleKey ? <div ref={autocompleteContainerRef} id="pickup-address" className="min-h-11 rounded-card border border-app bg-card" /> : <p className="text-xs text-muted">Set VITE_GOOGLE_MAPS_API_KEY to enable address selection.</p>}
        {placesError && <p role="status" className="text-xs text-error mt-1.5">{placesError}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="pickup-state" className="block text-sm font-semibold text-main mb-1.5">State</label>
          <input id="pickup-state" value={value.state} readOnly placeholder="State" className={fieldClass('bg-subtle')} />
        </div>
        <div>
          <label htmlFor="pickup-postal-code" className="block text-sm font-semibold text-main mb-1.5">ZIP code</label>
          <input id="pickup-postal-code" value={value.postalCode} readOnly placeholder="ZIP code" className={fieldClass('bg-subtle')} />
        </div>
      </div>

      <button id="pickup-confirm" type="button" onClick={onConfirm} disabled={!canConfirm} className="h-11 px-5 rounded-card bg-accent text-accent-text text-sm font-semibold hover:bg-accent-hover disabled:opacity-50">Confirm Location</button>
    </section>
  );
}
