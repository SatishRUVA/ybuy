import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { cityForCoordinates, estimateCityFromIp, NO_LOCATION, type MarketplaceLocation } from '@/lib/geo';
import { requireMarketplaceCountry } from '@/lib/marketplace-countries';
import { Alert } from '@/components/ui';

const STORAGE_KEY = 'ybuy-marketplace-location';

async function browserCityOrCoordinates(latitude: number, longitude: number): Promise<MarketplaceLocation> {
  const city = await cityForCoordinates(latitude, longitude);
  if (!city) throw new Error('Could not verify your country. Choose a city instead.');
  return city;
}

function selectedLocation(city: MarketplaceLocation): MarketplaceLocation {
  const validCoordinates = typeof city.latitude === 'number' && typeof city.longitude === 'number'
    && Number.isFinite(city.latitude) && Number.isFinite(city.longitude)
    && Math.abs(city.latitude) <= 90 && Math.abs(city.longitude) <= 180;
  return { city: city.city, state: city.state, country: city.country, source: 'USER_SELECTED',
    ...(typeof city.postalCode === 'string' ? { postalCode: city.postalCode } : {}),
    ...(validCoordinates ? { latitude: city.latitude, longitude: city.longitude } : {}) };
}

function savedLocation(): MarketplaceLocation {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return NO_LOCATION;
    const value: unknown = JSON.parse(saved);
    if (!value || typeof value !== 'object') return NO_LOCATION;
    const location = value as Partial<MarketplaceLocation>;
    if (location.source !== 'USER_SELECTED' || typeof location.city !== 'string' || !location.city || typeof location.state !== 'string' || typeof location.country !== 'string') return NO_LOCATION;
    return selectedLocation({ ...location, city: location.city, state: location.state, country: location.country, source: 'USER_SELECTED' });
  } catch {
    return NO_LOCATION;
  }
}

interface LocationContextValue {
  location: MarketplaceLocation;
  selectCity: (city: MarketplaceLocation) => Promise<void>;
  requestBrowserLocation: () => Promise<MarketplaceLocation | undefined>;
  resolveInitialLocation: () => Promise<MarketplaceLocation | undefined>;
  clearLocation: () => void;
}

const LocationContext = createContext<LocationContextValue | null>(null);

export function LocationProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(NO_LOCATION);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const requestId = useRef(0);
  const initialResolution = useRef<Promise<MarketplaceLocation | undefined> | null>(null);

  useEffect(() => {
    let active = true;
    const saved = savedLocation();
    const currentRequest = requestId.current;
    if (saved.source !== 'NONE') {
      void requireMarketplaceCountry(saved.country).then(() => {
        if (active && currentRequest === requestId.current) setLocation(saved);
      }).catch((error: unknown) => {
        if (!active || currentRequest !== requestId.current) return;
        localStorage.removeItem(STORAGE_KEY);
        setPolicyError(error instanceof Error ? error.message : 'Could not verify the saved location.');
      });
    }
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const validate = () => {
      if (location.source === 'NONE') return;
      const currentRequest = requestId.current;
      void requireMarketplaceCountry(location.country).catch((error: unknown) => {
        if (currentRequest !== requestId.current) return;
        requestId.current += 1;
        localStorage.removeItem(STORAGE_KEY);
        setLocation(NO_LOCATION);
        setPolicyError(error instanceof Error ? error.message : 'Could not verify the selected location.');
      });
    };
    window.addEventListener('focus', validate);
    return () => window.removeEventListener('focus', validate);
  }, [location]);

  async function selectCity(city: MarketplaceLocation) {
    const currentRequest = ++requestId.current;
    await requireMarketplaceCountry(city.country);
    if (currentRequest !== requestId.current) return;
    const selected = selectedLocation(city);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selected));
    setLocation(selected);
    setPolicyError(null);
  }

  function clearLocation() {
    requestId.current += 1;
    localStorage.removeItem(STORAGE_KEY);
    setLocation(NO_LOCATION);
    setPolicyError(null);
  }

  async function requestBrowserLocation() {
    if (!navigator.geolocation) throw new Error('Location is unavailable. Enter a city instead.');
    const currentRequest = ++requestId.current;
    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000, maximumAge: 60000 });
    }).catch((error: GeolocationPositionError) => {
      throw new Error(error.code === 1
        ? 'Location permission denied. Enter a city instead.'
        : 'Could not use your location. Enter a city instead.');
    });
    const city = await browserCityOrCoordinates(position.coords.latitude, position.coords.longitude);
    if (currentRequest !== requestId.current) return;
    localStorage.removeItem(STORAGE_KEY);
    setLocation(city);
    setPolicyError(null);
    return city;
  }

  function resolveInitialLocation() {
    if (location.source !== 'NONE') return Promise.resolve(location);
    if (initialResolution.current) return initialResolution.current;

    const currentRequest = ++requestId.current;
    initialResolution.current = (async () => {
      try {
        const permission = navigator.permissions
          ? await navigator.permissions.query({ name: 'geolocation' }).catch(() => undefined)
          : undefined;
        if (permission?.state === 'denied') throw new Error('Location permission denied.');
        if (!navigator.geolocation) throw new Error('Location is unavailable.');
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000, maximumAge: 60000 });
        });
        const city = await browserCityOrCoordinates(position.coords.latitude, position.coords.longitude);
        if (currentRequest !== requestId.current) return;
        localStorage.removeItem(STORAGE_KEY);
        setLocation(city);
        return city;
      } catch {
        if (currentRequest !== requestId.current) return;
        const estimated = await estimateCityFromIp().catch(() => null);
        if (!estimated || currentRequest !== requestId.current) return;
        setLocation(estimated);
        return estimated;
      }
    })();

    return initialResolution.current;
  }

  return <LocationContext.Provider value={{ location, selectCity, requestBrowserLocation, resolveInitialLocation, clearLocation }}>
    {policyError && <Alert tone="error" title="Location unavailable">{policyError}</Alert>}
    {children}
  </LocationContext.Provider>;
}

export function useMarketplaceLocation() {
  const context = useContext(LocationContext);
  if (!context) throw new Error('useMarketplaceLocation must be used within LocationProvider');
  return context;
}
