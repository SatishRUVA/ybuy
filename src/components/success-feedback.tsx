import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowUpRight, Check, Plus, Settings2, Share2, X } from 'lucide-react';
import { useAuth } from '@/auth-context';
import { Button, IconButton, Surface } from '@/components/ui';
import type { UiBooking } from '@/lib/bookings';
import type { ConfirmedPayment } from '@/lib/payments';

// One shared burst: every success moment plays it on each mount, including reload.
function Confetti({ eventKey }: { eventKey: string }) {
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setVisible(!media.matches);
    const stop = () => { if (media.matches) setVisible(false); };
    media.addEventListener('change', stop);
    const timer = window.setTimeout(() => setVisible(false), 2800);
    return () => { window.clearTimeout(timer); media.removeEventListener('change', stop); };
  }, [eventKey, userId]);
  if (!visible) return null;
  return (
    <div aria-hidden="true" className="success-confetti listing-hero-confetti">
      {Array.from({ length: 64 }, (_, index) => {
        return <span key={index} style={{
          '--burst-x': `${(index % 2 ? -1 : 1) * (40 + (index * 31) % 300)}px`,
          '--burst-y': `${-80 - (index * 17) % 140}px`,
          '--fall': `${280 + (index * 13) % 100}px`,
          left: index % 2 ? '92%' : '8%', top: '36%',
          '--turn': `${index % 2 ? 180 + index * 11 : -180 - index * 9}deg`,
          '--particle-size': `${5 + index % 4}px`,
          animationDelay: `${(index % 8) * 35}ms`,
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
      {eventKey && level !== 'subtle' && <Confetti key={eventKey} eventKey={eventKey} />}
    </div>
  );
}

type Action = { label: string; onClick: () => void };
type SuccessFeedbackProps = {
  primary: Action;
  secondary?: Action;
  tertiary?: Action;
} & (
  | { kind: 'listing'; id: string; title: string; image?: string; onListAnother?: () => void }
  | { kind: 'booking'; booking: UiBooking; payment: ConfirmedPayment | null }
);

export function SuccessFeedback(props: SuccessFeedbackProps) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const booking = props.kind === 'booking' ? props.booking : null;
  const payment = props.kind === 'booking' ? props.payment : null;
  const eventKey = props.kind === 'listing' ? `listing:${props.id}` : `booking:${props.booking.id}`;
  useEffect(() => {
    if (props.kind === 'listing' || payment) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      heading.current?.focus({ preventScroll: true });
    }
  }, [props.kind, payment]);
  if (booking && booking.status !== 'confirmed') return null;
  const title = props.kind === 'listing' ? 'Your listing is live!' : payment ? 'Payment confirmed' : 'Booking confirmed';
  if (props.kind === 'listing') return (
    <Surface role="region" aria-labelledby={headingId} className="success-card listing-success-hero relative isolate overflow-hidden px-5 py-9 sm:px-12 sm:py-12">
      <Confetti eventKey={eventKey} />
      <div className="relative z-10 mx-auto max-w-xl text-center">
        <div aria-hidden="true" className="listing-achievement mx-auto grid h-14 w-14 place-items-center rounded-full bg-accent text-accent-text">
          <Check size={30} strokeWidth={2.5} />
        </div>
        <h2 ref={heading} tabIndex={-1} id={headingId} className="mt-7 text-3xl sm:text-5xl font-bold tracking-tight text-main leading-tight">Your listing is live!</h2>
        <p role="status" className="mx-auto mt-4 max-w-sm text-sm sm:text-base text-sec leading-relaxed">People nearby can find your item and request a rental.</p>
        <div className="mt-8">
          {props.image && <img src={props.image} alt={props.title} className="mx-auto h-44 w-56 sm:h-52 sm:w-64 rounded-card-lg object-cover bg-subtle" />}
          <p className="mx-auto mt-5 max-w-md text-lg sm:text-xl font-semibold text-main break-words leading-snug">{props.title}</p>
          <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-success-soft px-3 py-1 text-xs font-semibold text-success"><Check aria-hidden="true" size={13} />Published</span>
        </div>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <Button size="lg" trailingIcon={<ArrowUpRight aria-hidden="true" size={18} />} onClick={props.primary.onClick}>{props.primary.label}</Button>
          {props.secondary && <Button size="lg" variant="secondary" icon={<Settings2 aria-hidden="true" size={17} />} onClick={props.secondary.onClick}>{props.secondary.label}</Button>}
          {props.tertiary && <Button className="sm:col-span-2 sm:justify-self-center" variant="ghost" icon={<Share2 aria-hidden="true" size={17} />} onClick={props.tertiary.onClick}>{props.tertiary.label}</Button>}
        </div>
        {props.onListAnother && <div className="mt-6 border-t border-app pt-4">
          <Button size="sm" variant="ghost" icon={<Plus aria-hidden="true" size={16} />} onClick={props.onListAnother}>List another item</Button>
        </div>}
      </div>
    </Surface>
  );
  return (
    <Surface role="region" aria-labelledby={headingId} className={`success-card relative isolate overflow-hidden mb-6 ${payment ? 'listing-success-hero px-5 py-9 sm:px-12 sm:py-12' : 'p-6 sm:p-8'}`}>
      {payment && <Confetti eventKey={eventKey} />}
      <div className={`relative z-10 ${payment ? 'mx-auto max-w-xl text-center' : ''}`}>
        <div className={payment ? '' : 'flex items-start gap-4'}>
          {payment ? <div aria-hidden="true" className="listing-achievement mx-auto grid h-14 w-14 place-items-center rounded-full bg-accent text-accent-text">
            <Check size={30} strokeWidth={2.5} />
          </div> : <SuccessIndicator eventKey={eventKey} level="major" />}
          <div className="success-content min-w-0">
            <h2 ref={heading} tabIndex={-1} id={headingId} className={payment ? 'mt-7 text-3xl sm:text-5xl font-bold tracking-tight text-main leading-tight' : 'text-xl sm:text-2xl font-bold text-main'}>{title}</h2>
            <p role="status" className="mt-2 text-sm text-sec leading-relaxed">
              Your dates are confirmed. Arrange pickup with the owner when you are ready.
            </p>
          </div>
        </div>
        {booking && (
          <div className="success-content mt-5 rounded-card-lg border border-app bg-subtle p-4">
            <div className={payment ? '' : 'flex gap-3 items-center'}>
              <img src={booking.listingImage} alt="" className={payment ? 'mx-auto mb-5 h-44 w-56 sm:h-52 sm:w-64 rounded-card-lg object-cover bg-subtle' : 'h-16 w-16 rounded-card object-cover shrink-0'} />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-main break-words">{booking.listingTitle}</p>
                <p className="mt-1 text-sm text-sec">{formatDate(booking.startDate)} - {formatDate(booking.endDate)}</p>
                <p className="mt-1 text-xs text-sec">With {booking.counterpartName}</p>
              </div>
            </div>
            {booking.bookingReference && <p className="mt-4 border-t border-app pt-3 text-xs text-sec">Booking reference <span className="block mt-1 text-main">{booking.bookingReference}</span></p>}
          </div>
        )}
        {payment && (
          <div className="success-content mt-4 rounded-card-lg bg-success-soft p-4">
            <p className="text-sm text-main">Confirmed payment</p>
            <p className="mt-1 text-2xl font-bold text-main tnum">{new Intl.NumberFormat(undefined, { style: 'currency', currency: payment.currency }).format(payment.amount)}</p>
            <p className="mt-2 text-xs text-sec">Receipt delivery status is not available yet.</p>
          </div>
        )}
        <div className={payment ? 'mt-8 grid gap-3 sm:grid-cols-2' : 'mt-6 flex flex-col sm:flex-row gap-3'}>
          <Button size={payment ? 'lg' : 'md'} onClick={props.primary.onClick}>{props.primary.label}</Button>
          {props.secondary && <Button size={payment ? 'lg' : 'md'} variant="secondary" onClick={props.secondary.onClick}>{props.secondary.label}</Button>}
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
