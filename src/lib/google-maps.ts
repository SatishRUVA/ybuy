export interface GoogleAddressComponent {
  longText?: string;
  shortText?: string;
  types: string[];
}

export interface GooglePlace {
  id?: string;
  formattedAddress?: string;
  addressComponents?: GoogleAddressComponent[];
  location?: { lat: () => number; lng: () => number };
  fetchFields: (options: { fields: string[] }) => Promise<void>;
}

export interface GooglePlacePrediction {
  text?: string | { toString(): string };
  toPlace: () => GooglePlace;
}

export interface GooglePlacesLibrary {
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions: (request: {
      input: string;
      includedRegionCodes?: string[];
      includedPrimaryTypes?: string[];
    }) => Promise<{ suggestions: { placePrediction?: GooglePlacePrediction }[] }>;
  };
}

type GoogleMapsRuntime = {
  importLibrary?: (name: string) => Promise<unknown>;
  [key: string]: unknown;
};

declare global {
  interface Window {
    google?: {
      maps?: GoogleMapsRuntime;
    };
  }
}

const GOOGLE_SCRIPT_ID = 'ybuy-google-places';
const GOOGLE_READY_CALLBACK = '__ybuyGoogleMapsReady';
let placesPromise: Promise<GooglePlacesLibrary> | null = null;

export function loadGooglePlaces(): Promise<GooglePlacesLibrary> {
  if (placesPromise) return placesPromise;

  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!key) return Promise.reject(new Error('Google Places is not configured.'));

  placesPromise = new Promise<GooglePlacesLibrary>((resolve, reject) => {
    const finish = () => {
      const importLibrary = window.google?.maps?.importLibrary;
      if (!importLibrary) {
        reject(new Error('Google Places could not initialize.'));
        return;
      }
      void importLibrary('places').then((library) => resolve(library as GooglePlacesLibrary)).catch(reject);
    };

    const maps = window.google?.maps ?? {};
    if (!window.google) window.google = { maps };
    else window.google.maps = maps;

    const existing = document.getElementById(GOOGLE_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      if (window.google?.maps?.importLibrary) finish();
      else reject(new Error('Google Maps is already loading. Refresh and try again.'));
      return;
    }

    maps[GOOGLE_READY_CALLBACK] = finish;
    const script = document.createElement('script');
    script.id = GOOGLE_SCRIPT_ID;
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&libraries=places&callback=google.maps.${GOOGLE_READY_CALLBACK}`;
    script.addEventListener('error', () => reject(new Error('Google Places could not be loaded.')), { once: true });
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    placesPromise = null;
    if (!window.google?.maps?.importLibrary) document.getElementById(GOOGLE_SCRIPT_ID)?.remove();
    throw error;
  });

  return placesPromise;
}
