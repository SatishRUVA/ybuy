import { useEffect, useState } from 'react';
import { LockKeyhole, MapPin } from 'lucide-react';
import { useAuth } from '@/auth-context';
import { fetchBookingPickup, type BookingPickup as Pickup, type BookingStatus } from '@/lib/bookings';
import { Alert, Button } from '@/main-site/components/ui';
import { Skeleton } from '@/main-site/components/skeleton';
import { fetchBookingPrecheckin } from '@/lib/booking-precheckin';

export function BookingPickup({ bookingId, status, paymentFirst = false }: { bookingId: string; status: BookingStatus; paymentFirst?: boolean }) {
  const { user } = useAuth();
  const eligible = ['confirmed', 'active', 'return_pending'].includes(status);
  const key = `${user?.id}:${bookingId}:${status}`;
  const [result, setResult] = useState<{ key: string; pickup?: Pickup; error?: string; locked?: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!user || !eligible) return;
    let active = true;
    setResult(null);
    (async () => {
      const precheckin = paymentFirst && status === 'confirmed' ? await fetchBookingPrecheckin(bookingId) : null;
      if (precheckin && !(precheckin.deposit_ready && precheckin.can_authorize)) {
        if (active) setResult({ key, locked: true });
        return null;
      }
      return fetchBookingPickup(bookingId);
    })()
      .then((pickup) => { if (active && pickup) setResult({ key, pickup }); })
      .catch((error: unknown) => {
        if (active) setResult({ key, error: error instanceof Error ? error.message : 'Could not load the pickup address.' });
      });
    return () => { active = false; };
  }, [bookingId, eligible, key, user, attempt, paymentFirst, status]);

  if (!user || !eligible) return null;
  if (!result || result.key !== key) return <div role="status" aria-label="Loading pickup address"><Skeleton className="h-20 w-full" /></div>;
  if (result.locked) return <Alert tone="info" title="Complete check-in first">The private handoff address opens after the separate security hold is ready within 24 hours before the approved slot.
    <Button variant="secondary" size="sm" className="mt-2" onClick={() => setAttempt(value => value + 1)}>Check handoff readiness</Button>
  </Alert>;
  if (result.error) return <Alert tone="error" title="Pickup address unavailable">{result.error}
    <Button variant="secondary" size="sm" className="mt-2" onClick={() => setAttempt((value) => value + 1)}>Retry pickup address</Button>
  </Alert>;
  return <section aria-label="Private pickup address" className="rounded-card-lg border border-app bg-accent-soft p-4">
    <h3 className="flex items-center gap-2 text-sm font-semibold text-main"><MapPin size={16} aria-hidden="true" />Pickup address</h3>
    <p className="mt-2 whitespace-pre-line break-words text-sm text-main">{result.pickup?.address}</p>
    <p className="mt-2 flex items-center gap-1.5 text-xs text-sec"><LockKeyhole size={13} aria-hidden="true" />Private to this confirmed booking.</p>
  </section>;
}
