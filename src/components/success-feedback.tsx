import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, X } from 'lucide-react';
import { useAuth } from '@/auth-context';
import { Button, IconButton, Surface } from '@/components/ui';
import type { UiBooking } from '@/lib/bookings';
import type { ConfirmedPayment } from '@/lib/payments';

const seen = new Set<string>();
let storageWarningShown = false;

function claim(key: string): boolean {
  if (seen.has(key)) return false;
  seen.add(key);
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, '1');
  } catch (error) {
    if (!storageWarningShown) {
      console.warn('Success feedback storage is unavailable; deduplication lasts until this page is closed.', error);
      storageWarningShown = true;
    }
  }
  return true;
}

function Confetti({ eventKey, major }: { eventKey: string; major: boolean }) {
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);
  const claimed = useRef<string | null>(null);
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const key = `ybuy-success:${userId}:${eventKey}`;
    // Keep this mount's claim through StrictMode's effect cleanup/setup replay.
    if (claimed.current !== key) claimed.current = claim(key) ? key : null;
    setVisible(claimed.current === key && !media.matches);
    const stop = () => { if (media.matches) setVisible(false); };
    media.addEventListener('change', stop);
    const timer = window.setTimeout(() => setVisible(false), 1500);
    return () => { window.clearTimeout(timer); media.removeEventListener('change', stop); };
  }, [eventKey, userId]);
  if (!visible) return null;
  return (
    <div aria-hidden="true" className="success-confetti">
      {Array.from({ length: major ? 24 : 14 }, (_, index) => {
        const angle = (index * 137.5) * Math.PI / 180;
        const distance = 30 + (index * 17) % (major ? 18 : 12);
        return <span key={index} style={{
          '--burst-x': `${Math.cos(angle) * distance * 0.65}px`,
          '--burst-y': `${-8 + Math.sin(angle) * distance * 0.6}px`,
          '--fall': `${28 + (index * 13) % 24}px`,
          '--turn': `${index % 2 ? 180 + index * 11 : -180 - index * 9}deg`,
          '--particle-size': `${4 + index % 4}px`,
          animationDelay: `${(index % 4) * 35}ms`,
          borderRadius: index % 3 === 0 ? '50%' : '1px',
          '--particle-color': ['var(--accent)', 'var(--success)', 'var(--accent-soft)', 'var(--success-soft)', 'var(--star)'][index % 5],
        } as CSSProperties}><i /></span>;
      })}
    </div>
  );
}

export function SuccessIndicator({ eventKey, level = 'subtle' }: {
  eventKey?: string;
  level?: 'subtle' | 'standard' | 'major';
}) {
  return (
    <div aria-hidden="true" className={`success-indicator relative grid h-12 w-12 shrink-0 place-items-center ${level === 'subtle' ? 'success-indicator-subtle' : ''}`}>
      <span className="success-halo absolute inset-0 rounded-full bg-success-soft" />
      <span className="success-check relative grid h-full w-full place-items-center rounded-full bg-success-soft text-success">
        <Check size={26} strokeWidth={2.5} className="success-checkmark" />
      </span>
      {eventKey && level !== 'subtle' && <Confetti key={eventKey} eventKey={eventKey} major={level === 'major'} />}
    </div>
  );
}

type Action = { label: string; onClick: () => void };
type SuccessFeedbackProps = {
  primary: Action;
  secondary?: Action;
  tertiary?: Action;
} & (
  | { kind: 'listing'; id: string; title: string; image?: string }
  | { kind: 'booking'; booking: UiBooking; payment: ConfirmedPayment | null }
);

export function SuccessFeedback(props: SuccessFeedbackProps) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const booking = props.kind === 'booking' ? props.booking : null;
  const payment = props.kind === 'booking' ? props.payment : null;
  const eventKey = props.kind === 'listing' ? `listing:${props.id}` : `booking:${props.booking.id}`;
  useEffect(() => {
    if (props.kind === 'listing') heading.current?.focus({ preventScroll: true });
  }, [props.kind]);
  if (booking && booking.status !== 'confirmed') return null;
  const title = props.kind === 'listing' ? 'Your listing is live!' : payment ? 'Payment confirmed' : 'Booking confirmed';
  return (
    <Surface role="region" aria-labelledby={headingId} className="success-card relative overflow-hidden p-6 sm:p-8 mb-6">
      <div className="relative">
        <div className="flex items-start gap-4">
          <SuccessIndicator eventKey={eventKey} level={props.kind === 'listing' ? 'standard' : 'major'} />
          <div className="success-content min-w-0">
            <h2 ref={heading} tabIndex={-1} id={headingId} className="text-xl sm:text-2xl font-bold text-main">{title}</h2>
            <p role="status" className="mt-2 text-sm text-sec leading-relaxed">
              <span className="sr-only">{title}. </span>
              {props.kind === 'listing' ? 'People nearby can find your item and request a rental.' : 'Your dates are confirmed. Arrange pickup with the owner when you are ready.'}
            </p>
          </div>
        </div>
        {props.kind === 'listing' && (
          <div className="success-content mt-5 flex items-center gap-3">
            {props.image && <img src={props.image} alt="" className="w-16 h-16 rounded-card object-cover bg-subtle shrink-0" />}
            <p className="text-base font-semibold text-main break-words">{props.title}</p>
          </div>
        )}
        {booking && (
          <div className="success-content mt-5 rounded-card-lg border border-app bg-subtle p-4">
            <div className="flex gap-3 items-center">
              <img src={booking.listingImage} alt="" className="h-16 w-16 rounded-card object-cover shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-main break-words">{booking.listingTitle}</p>
                <p className="mt-1 text-sm text-sec">{formatDate(booking.startDate)} - {formatDate(booking.endDate)}</p>
                <p className="mt-1 text-xs text-sec">With {booking.counterpartName}</p>
              </div>
            </div>
            <p className="mt-4 border-t border-app pt-3 text-xs text-sec">Booking reference <span className="block mt-1 text-main break-all">{booking.id}</span></p>
          </div>
        )}
        {payment && (
          <div className="success-content mt-4 rounded-card-lg bg-success-soft p-4">
            <p className="text-sm text-main">Confirmed payment</p>
            <p className="mt-1 text-2xl font-bold text-main tnum">{new Intl.NumberFormat(undefined, { style: 'currency', currency: payment.currency }).format(payment.amount)}</p>
            <p className="mt-2 text-xs text-sec">Receipt delivery status is not available yet.</p>
          </div>
        )}
        <div className="mt-6 flex flex-col sm:flex-row gap-3">
          <Button onClick={props.primary.onClick}>{props.primary.label}</Button>
          {props.secondary && <Button variant="secondary" onClick={props.secondary.onClick}>{props.secondary.label}</Button>}
          {props.tertiary && <Button variant="ghost" onClick={props.tertiary.onClick}>{props.tertiary.label}</Button>}
        </div>
      </div>
    </Surface>
  );
}

export function SuccessNotice({ children, onDismiss, eventKey }: { children: ReactNode; onDismiss: () => void; eventKey?: string }) {
  return (
    <div className="success-notice relative flex items-center gap-3 overflow-hidden rounded-card-lg bg-success-soft p-3 mb-4">
      <SuccessIndicator eventKey={eventKey} level={eventKey ? 'standard' : 'subtle'} />
      <p role="status" className="text-sm text-main flex-1">{children}</p>
      <IconButton variant="ghost" label="Dismiss notification" onClick={onDismiss}><X aria-hidden="true" size={18} /></IconButton>
    </div>
  );
}

function formatDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
