import { useState } from 'react';
import { ListingAvailabilityPicker } from '../src/main-site/components/listing-availability-picker';
import { PickupLocation } from '../src/main-site/components/pickup-location';
import { LocationProvider } from '../src/location-context';
import type { PickupLocationValue } from '../src/lib/pickup-location';
import { useUtcDay } from '../src/lib/use-utc-day';
import '../src/main-site/index.css';

export function OwnerFlowHarness() {
  const utcDay = useUtcDay();
  const [dates, setDates] = useState({ start: '2026-10-26', end: '2026-11-25' });
  const [address, setAddress] = useState<PickupLocationValue>({
    formattedAddress: 'Existing saved pickup', streetAddress: '1 Original Street', city: 'Irving',
    state: 'TX', postalCode: '75039', country: 'US', latitude: 32.8, longitude: -96.9, placeId: 'original',
  });
  return <LocationProvider><main className="mx-auto max-w-3xl p-4 space-y-6">
    <output aria-label="Discovery day">{utcDay}</output>
    <ListingAvailabilityPicker {...dates} onChange={(start, end) => setDates({ start, end })} />
    <output aria-label="Stored availability">{JSON.stringify(dates)}</output>
    <PickupLocation value={address} onChange={setAddress} />
    <output aria-label="Stored pickup">{JSON.stringify(address)}</output>
  </main></LocationProvider>;
}
