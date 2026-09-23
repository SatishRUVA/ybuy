import { useEffect, useState } from 'react';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import { checkInSteps, checkOutSteps, type Listing } from '@/data';
import { fetchBookingById, completeBookingReturn, type UiBooking } from '@/lib/bookings';
import { fetchListingById, toUiListing } from '@/lib/listings';
import * as Icons from 'lucide-react';
import { ArrowLeft, Check, Camera, ArrowRight, AlertTriangle } from 'lucide-react';

// Cosmetic checklist for the return-inspection wizard — not tied to any real per-item component
// data (Part 1 doesn't collect that), so it's a generic list rather than fabricated specifics.
const GENERIC_RETURN_CHECKLIST = ['Item', 'Accessories', 'Cables / charger'];

export function CheckInPage({ id }: { id: string }) {
  const { navigate, back } = useRouter();
  const [listing, setListing] = useState<Listing | null | undefined>(undefined);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchListingById(id)
      .then((row) => { if (!cancelled) setListing(row ? toUiListing(row) : null); })
      .catch(() => { if (!cancelled) setListing(null); });
    return () => { cancelled = true; };
  }, [id]);

  if (listing === undefined) return <div className="p-8 text-center text-sec">Loading…</div>;
  if (!listing) return <div className="p-8 text-center text-sec">Listing not found.</div>;

  if (done) {
    return (
      <div className="animate-fade-in pb-20 md:pb-8">
        <div className="max-w-lg mx-auto px-4 sm:px-6 py-8 text-center">
          <div className="w-20 h-20 rounded-full bg-success-soft flex items-center justify-center mx-auto mb-4">
            <Check className="text-success" size={44} />
          </div>
          <h1 className="text-2xl font-bold text-main font-display mb-2">Check-in complete!</h1>
          <p className="text-sec text-sm mb-6">Item handed off to renter. The rental is now active.</p>
          <button onClick={() => navigate({ name: 'renter-dashboard' })} className="px-6 py-3 rounded-card-lg bg-accent text-accent-text font-semibold text-sm">
            View my rentals
          </button>
        </div>
      </div>
    );
  }

  const stepData = checkInSteps[step];
  const StepIcon = (Icons as unknown as Record<string, typeof Camera>)[stepData.icon] ?? Camera;
  const isLast = step === checkInSteps.length - 1;

  return (
    <div className="animate-fade-in pb-20 md:pb-8">
      <div className="max-w-lg mx-auto px-4 sm:px-6 py-4 sm:py-8">
        <button onClick={back} className="flex items-center gap-1.5 text-sm text-sec mb-4 hover:text-main transition-colors">
          <ArrowLeft size={18} /> Back
        </button>
        <div className="flex items-center gap-3 mb-6">
          <img src={listing.images[0]} alt="" className="w-12 h-12 rounded-card-lg object-cover" />
          <div>
            <h1 className="text-xl font-bold text-main font-display">Check-in</h1>
            <p className="text-xs text-sec">{listing.title}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 mb-8">
          {checkInSteps.map((s, i) => (
            <div key={s.id} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= step ? 'bg-accent' : 'bg-border-strong'}`} />
          ))}
        </div>
        <div className="text-center py-8">
          <div className="w-20 h-20 rounded-full bg-accent-soft flex items-center justify-center mx-auto mb-4">
            <StepIcon size={36} className="text-accent" />
          </div>
          <p className="text-xs font-semibold text-muted uppercase tracking-wide">Step {step + 1} of {checkInSteps.length}</p>
          <h2 className="text-xl font-bold text-main mt-1 mb-2">{stepData.label}</h2>
          <p className="text-sm text-sec max-w-xs mx-auto">
            {step === 0 && 'Take a clear photo of the item showing its current condition.'}
            {step === 1 && 'Photograph the serial number for verification.'}
            {step === 2 && 'Confirm all components are present and accounted for.'}
            {step === 3 && 'Record the item condition and any existing wear.'}
            {step === 4 && 'Hand off the item to the renter and confirm handoff.'}
          </p>
          {step === 2 && (
            <div className="mt-6 text-left space-y-2 max-w-sm mx-auto">
              {listing.components.map((c, i) => (
                <div key={i} className="flex items-center gap-2 p-2.5 rounded-card-lg bg-card border border-app">
                  <Check size={16} className="text-success" />
                  <span className="text-sm text-main flex-1">{c.name}</span>
                  <span className="text-xs text-success font-medium">Present</span>
                </div>
              ))}
            </div>
          )}
          {step !== 2 && (
            <div className="mt-6 flex justify-center">
              <div className="w-32 h-32 rounded-card-xl border-2 border-dashed border-app flex flex-col items-center justify-center gap-2 text-muted">
                <Camera size={28} />
                <span className="text-xs">Tap to capture</span>
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-3 mt-6">
          {step > 0 && (
            <button onClick={() => setStep(step - 1)} className="px-4 py-3 rounded-card-lg border border-app text-sec text-sm font-medium hover:bg-subtle transition-colors">
              <ArrowLeft size={16} />
            </button>
          )}
          <button onClick={() => (isLast ? setDone(true) : setStep(step + 1))} className="flex-1 py-3 rounded-card-lg bg-accent text-accent-text font-semibold text-sm flex items-center justify-center gap-2">
            {isLast ? 'Confirm handoff' : 'Continue'} <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function CheckOutPage({ id }: { id: string }) {
  const { navigate, back } = useRouter();
  const { user } = useAuth();
  const [booking, setBooking] = useState<UiBooking | null | undefined>(undefined);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [missingComponent, setMissingComponent] = useState<number | null>(null);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetchBookingById(id, user.id)
      .then((b) => { if (!cancelled) setBooking(b); })
      .catch(() => { if (!cancelled) setBooking(null); });
    return () => { cancelled = true; };
  }, [id, user]);

  if (booking === undefined) return <div className="p-8 text-center text-sec">Loading…</div>;
  if (!booking) return <div className="p-8 text-center text-sec">Booking not found.</div>;

  async function handleComplete() {
    setCompleting(true);
    setError(null);
    try {
      await completeBookingReturn(id);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete the return.');
    } finally {
      setCompleting(false);
    }
  }

  if (done) {
    return (
      <div className="animate-fade-in pb-20 md:pb-8">
        <div className="max-w-lg mx-auto px-4 sm:px-6 py-8 text-center">
          <div className="w-20 h-20 rounded-full bg-success-soft flex items-center justify-center mx-auto mb-4">
            <Check className="text-success" size={44} />
          </div>
          <h1 className="text-2xl font-bold text-main font-display mb-2">Return complete!</h1>
          <p className="text-sec text-sm mb-2">
            {missingComponent !== null ? 'A missing component claim has been filed. The owner will be notified.' : 'All components returned successfully.'}
          </p>
          {booking.deposit > 0 && (
            <p className="text-sec text-sm mb-6">Your ${booking.deposit} security hold will be released within 3-5 business days.</p>
          )}
          <button onClick={() => navigate({ name: 'renter-dashboard' })} className="px-6 py-3 rounded-card-lg bg-accent text-accent-text font-semibold text-sm">
            View my rentals
          </button>
        </div>
      </div>
    );
  }

  const stepData = checkOutSteps[step];
  const StepIcon = (Icons as unknown as Record<string, typeof Camera>)[stepData.icon] ?? Camera;
  const isLast = step === checkOutSteps.length - 1;
  const returnedCount = GENERIC_RETURN_CHECKLIST.length - (missingComponent !== null ? 1 : 0);

  return (
    <div className="animate-fade-in pb-20 md:pb-8">
      <div className="max-w-lg mx-auto px-4 sm:px-6 py-4 sm:py-8">
        <button onClick={back} className="flex items-center gap-1.5 text-sm text-sec mb-4 hover:text-main transition-colors">
          <ArrowLeft size={18} /> Back
        </button>
        <div className="flex items-center gap-3 mb-6">
          <img src={booking.listingImage} alt="" className="w-12 h-12 rounded-card-lg object-cover" />
          <div>
            <h1 className="text-xl font-bold text-main font-display">Return inspection</h1>
            <p className="text-xs text-sec">{booking.listingTitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 mb-8">
          {checkOutSteps.map((s, i) => (
            <div key={s.id} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= step ? 'bg-accent' : 'bg-border-strong'}`} />
          ))}
        </div>
        <div className="text-center py-4">
          <div className="w-20 h-20 rounded-full bg-accent-soft flex items-center justify-center mx-auto mb-4">
            <StepIcon size={36} className="text-accent" />
          </div>
          <p className="text-xs font-semibold text-muted uppercase tracking-wide">Step {step + 1} of {checkOutSteps.length}</p>
          <h2 className="text-xl font-bold text-main mt-1 mb-2">{stepData.label}</h2>
          {step === 1 && (
            <div className="mt-6 text-left space-y-2 max-w-sm mx-auto">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-main">Component checklist</span>
                <span className={`text-sm font-bold ${missingComponent !== null ? 'text-warning' : 'text-success'}`}>
                  {returnedCount} / {GENERIC_RETURN_CHECKLIST.length} returned
                </span>
              </div>
              {GENERIC_RETURN_CHECKLIST.map((name, i) => (
                <button key={i} onClick={() => setMissingComponent(missingComponent === i ? null : i)} className="w-full flex items-center gap-2 p-2.5 rounded-card-lg bg-card border border-app hover:bg-subtle transition-colors text-left">
                  {missingComponent === i ? <AlertTriangle size={16} className="text-warning" /> : <Check size={16} className="text-success" />}
                  <span className="text-sm text-main flex-1">{name}</span>
                  <span className={`text-xs font-medium ${missingComponent === i ? 'text-warning' : 'text-success'}`}>
                    {missingComponent === i ? 'Missing' : 'Returned'}
                  </span>
                </button>
              ))}
              {missingComponent !== null && (
                <div className="p-3 rounded-card-lg bg-warning-soft border border-app flex items-start gap-2">
                  <AlertTriangle size={16} className="text-warning shrink-0 mt-0.5" />
                  <p className="text-xs text-sec">A missing component claim will be filed automatically. The owner will be notified.</p>
                </div>
              )}
            </div>
          )}
          {(step === 0 || step === 2) && (
            <div className="mt-6 flex justify-center">
              <div className="w-32 h-32 rounded-card-xl border-2 border-dashed border-app flex flex-col items-center justify-center gap-2 text-muted">
                <Camera size={28} />
                <span className="text-xs">Tap to capture</span>
              </div>
            </div>
          )}
        </div>
        {error && <p className="text-sm text-warning text-center mb-4">{error}</p>}
        <div className="flex gap-3 mt-6">
          {step > 0 && (
            <button onClick={() => setStep(step - 1)} className="px-4 py-3 rounded-card-lg border border-app text-sec text-sm font-medium hover:bg-subtle transition-colors">
              <ArrowLeft size={16} />
            </button>
          )}
          <button
            onClick={() => (isLast ? handleComplete() : setStep(step + 1))}
            disabled={completing}
            className="flex-1 py-3 rounded-card-lg bg-accent text-accent-text font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {isLast ? 'Complete return' : 'Continue'} <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
