import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { cityForCoordinates, estimateCityFromIp, NO_LOCATION, type MarketplaceLocation } from '@/lib/geo';

const STORAGE_KEY = 'ybuy-marketplace-location';

function savedLocation(): MarketplaceLocation {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return NO_LOCATION;
    const value: unknown = JSON.parse(saved);
    if (!value || typeof value !== 'object') return NO_LOCATION;
    const location = value as Partial<MarketplaceLocation>;
    if (location.source !== 'USER_SELECTED' || typeof location.city !== 'string' || !location.city || typeof location.state !== 'string' || typeof location.country !== 'string') return NO_LOCATION;
    return { city: location.city, state: location.state, country: location.country, source: 'USER_SELECTED' };
  } catch {
    return NO_LOCATION;
  }
}

interface LocationContextValue {
  location: MarketplaceLocation;
  selectCity: (city: MarketplaceLocation) => void;
  requestBrowserLocation: () => Promise<void>;
  clearLocation: () => void;
}

const LocationContext = createContext<LocationContextValue | null>(null);

export function LocationProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(savedLocation);
  const requestId = useRef(0);
  const skipIp = useRef(false);

  useEffect(() => {
    if (location.source !== 'NONE' || skipIp.current) return;
    const controller = new AbortController();
    void estimateCityFromIp(controller.signal)
      .then((city) => { if (city && !skipIp.current) setLocation((current) => current.source === 'NONE' ? city : current); })
      .catch(() => {});
    return () => controller.abort();
  }, [location.source]);

  function selectCity(city: MarketplaceLocation) {
    requestId.current += 1;
    const selected: MarketplaceLocation = { city: city.city, state: city.state, country: city.country, source: 'USER_SELECTED' };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selected));
    setLocation(selected);
  }

  function clearLocation() {
    requestId.current += 1;
    skipIp.current = true;
    localStorage.removeItem(STORAGE_KEY);
    setLocation(NO_LOCATION);
  }

  async function requestBrowserLocation() {
    if (!navigator.geolocation) throw new Error('Location is unavailable. Enter a city instead.');
    const currentRequest = ++requestId.current;
    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000, maximumAge: 60000 });
    }).catch(() => { throw new Error('Could not use your location. Enter a city instead.'); });
    const city = await cityForCoordinates(position.coords.latitude, position.coords.longitude);
    if (!city) throw new Error('Could not identify your city. Enter it instead.');
    if (currentRequest !== requestId.current) return;
    localStorage.removeItem(STORAGE_KEY);
    setLocation(city);
  }

  return <LocationContext.Provider value={{ location, selectCity, requestBrowserLocation, clearLocation }}>{children}</LocationContext.Provider>;
}

export function useMarketplaceLocation() {
  const context = useContext(LocationContext);
  if (!context) throw new Error('useMarketplaceLocation must be used within LocationProvider');
  return context;
}