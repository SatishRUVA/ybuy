import { useEffect, useState } from 'react';
import { LockKeyhole, MapPin } from 'lucide-react';
import { fetchBookingDeliveryAddress } from '@/lib/bookings';
import type { DeliveryAddress } from '@/lib/delivery-checkout';
import { Alert, Button } from '@/main-site/components/ui';

export function BookingDeliveryAddress({ bookingId }: { bookingId: string }) {
  const [address, setAddress] = useState<DeliveryAddress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setAddress(null);
    setError(null);
    fetchBookingDeliveryAddress(bookingId).then(value => {
      if (active) setAddress(value);
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'Could not load the delivery address.');
    });
    return () => { active = false; };
  }, [bookingId, retry]);

  if (error) return <Alert tone="error" title="Delivery address unavailable">{error}
    <Button variant="secondary" size="sm" className="mt-2" onClick={() => setRetry(value => value + 1)}>Retry</Button>
  </Alert>;
  if (!address) return <p role="status" className="text-sm text-sec">Loading delivery address…</p>;
  return <section aria-label="Private delivery address" className="rounded-card-lg border border-app bg-accent-soft p-4">
    <h3 className="flex items-center gap-2 text-sm font-semibold text-main"><MapPin size={16} aria-hidden="true" />Delivery address</h3>
    <p className="mt-2 whitespace-pre-line break-words text-sm text-main">
      {[address.address_line1, address.address_line2, `${address.city}, ${address.state} ${address.postal_code}`].filter(Boolean).join('\n')}
    </p>
    <p className="mt-2 flex items-center gap-1.5 text-xs text-sec"><LockKeyhole size={13} aria-hidden="true" />Private to the booking participants.</p>
  </section>;
}
