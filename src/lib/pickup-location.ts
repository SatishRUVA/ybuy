import { loadGooglePlaces } from '@/lib/google-maps';
import { countryIsAllowed, fetchMarketplaceCountries } from '@/lib/marketplace-countries';

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
