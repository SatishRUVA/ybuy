import { loadGooglePlaces, type GooglePlace } from '@/lib/google-maps';
import { countryIsAllowed, fetchMarketplaceCountries, type MarketplaceCountry } from '@/lib/marketplace-countries';

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
  timeZone?: string;
  manualConfirmed?: boolean;
}

export function applyPickupLocality(
  current: PickupLocationValue,
  field: 'city' | 'state' | 'postalCode',
  place: Pick<GooglePlace, 'addressComponents'>,
  countries: MarketplaceCountry[],
): PickupLocationValue {
  const component = (type: string, short = false) => {
    const item = place.addressComponents?.find(part => part.types.includes(type));
    return (short ? item?.shortText : item?.longText)?.trim() ?? '';
  };
  const country = countries.find(item => countryIsAllowed(component('country', true), [item]));
  const city = component('locality') || component('postal_town') || component('sublocality_level_1');
  const state = component('administrative_area_level_1', true);
  const postalCode = component('postal_code');
  if (!country || !({ city, state, postalCode })[field]) {
    throw new Error('This suggestion does not contain the requested location details.');
  }
  return {
    ...current,
    city: city || current.city,
    state: state || current.state,
    postalCode: postalCode || current.postalCode,
    country: country.code,
    latitude: null,
    longitude: null,
    placeId: '',
    manualConfirmed: false,
  };
}

export function formatPickupAddress(value: PickupLocationValue): string {
  const address = value.formattedAddress.trim() || value.streetAddress.trim();
  if (value.placeId) return address;

  const enteredArea = (address.includes(',') ? address.split(',').slice(1).join(',') : address).toLocaleLowerCase();
  const missing = [value.city, value.state, value.postalCode].filter(part => {
    const text = part.trim().toLocaleLowerCase();
    if (!text) return false;
    const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return !new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u').test(enteredArea);
  });
  return [address, ...missing].filter(Boolean).join(', ');
}

interface GeocoderLibrary {
  Geocoder: new () => {
    geocode: (request: { location: { lat: number; lng: number } }) => Promise<{
      results: {
        formatted_address: string;
        place_id: string;
        address_components: { long_name: string; short_name: string; types: string[] }[];
      }[];
    }>;
  };
}

export async function currentPickupLocation(): Promise<PickupLocationValue> {
  if (!navigator.geolocation) throw new Error('Location is unavailable. Search and select your pickup address instead.');
  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 15000, maximumAge: 60000 });
  }).catch((error: GeolocationPositionError) => {
    throw new Error(error.code === 1
      ? 'Location permission denied. Allow location in your browser or search for your pickup address.'
      : 'Could not find your location. Search and select your pickup address instead.');
  });
  const { latitude, longitude } = position.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new Error('Your browser returned an invalid location. Search for your pickup address instead.');
  }
  await loadGooglePlaces();
  const importLibrary = window.google?.maps?.importLibrary;
  if (!importLibrary) throw new Error('Address lookup is unavailable. Search for your pickup address instead.');
  const [{ Geocoder }, countries] = await Promise.all([
    importLibrary('geocoding') as Promise<GeocoderLibrary>,
    fetchMarketplaceCountries(),
  ]);
  const { results } = await new Geocoder().geocode({ location: { lat: latitude, lng: longitude } });
  for (const result of results) {
    const part = (type: string, short = false) => {
      const component = result.address_components.find(value => value.types.includes(type));
      return component ? short ? component.short_name : component.long_name : '';
    };
    const city = part('locality') || part('postal_town') || part('sublocality_level_1');
    const country = part('country', true);
    if (!countryIsAllowed(country, countries)) continue;
    if (!result.formatted_address || !part('street_number') || !part('route') || !city || !part('postal_code')) continue;
    return {
      formattedAddress: result.formatted_address,
      streetAddress: `${part('street_number')} ${part('route')}`,
      city, state: part('administrative_area_level_1', true), postalCode: part('postal_code'), country,
      latitude, longitude, placeId: result.place_id,
    };
  }
  throw new Error('No complete pickup address was found in an enabled marketplace country. Search and select your address instead.');
}
