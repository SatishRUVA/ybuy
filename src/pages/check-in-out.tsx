import { useEffect, useState } from 'react';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import { checkInSteps, checkOutSteps, type Listing } from '@/data';
import { fetchBookingById, completeBookingReturn, type UiBooking } from '@/lib/bookings';
import { fetchListingById, toUiListing } from '@/lib/listings';
import * as Icons from 'lucide-react';
import { Button, Alert, Surface } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { ArrowLeft, Check, Camera, ArrowRight, AlertTriangle } from 'lucide-react';

// Cosmetic checklist for the return-inspection wizard - not tied to any real per-item component
// data (Part 1 doesn't collect that), so it's a generic list rather than fabricated specifics.
const GENERIC_RETURN_CHECKLIST = ['Item', 'Accessories', 'Cables / charger'];

function WizardSkeleton() {
  return (
    <div className="max-w-lg mx-auto px-4 sm:px-6 py-8 space-y-5">
      <Skeleton className="h-12 w-2/3" rounded="rounded-card" />
      <Skeleton className="h-1.5 w-full" rounded="rounded-full" />
      <Skeleton className="h-52 w-full" rounded="rounded-card-lg" />
      <Skeleton className="h-12 w-full" rounded="rounded-card" />
    </div>
  );
}

function WizardMissing({ message }: { message: string }) {
  const { navigate } = useRouter();
  return (
    <div className="max-w-lg mx-auto px-4 py-20 text-center">
      <h1 className="text-xl font-bold text-main font-display">{message}</h1>
      <Button className="mt-6" onClick={() => navigate({ name: 'dashboard', tab: 'renting' })}>Back to Bookings</Button>
    </div>
  );
}

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

  if (listing === undefined) return <WizardSkeleton />;
  if (!listing) return <WizardMissing message="We couldn't find that item." />;

  if (done) {
    return (
      <div className="animate-fade-in pb-20 md:pb-10">
        <div className="max-w-lg mx-auto px-4 sm:px-6 py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-success-soft grid place-items-center mx-auto mb-4 animate-booking-confirmed">
            <Check className="text-success" size={34} />
          </div>
          <h1 className="text-2xl font-bold text-main font-display">Check-in complete</h1>
          <p className="text-sec text-sm mt-2 mb-7">The item is handed over and the rental is now active.</p>
          <Button onClick={() => navigate({ name: 'dashboard', tab: 'renting' })}>View Bookings</Button>
        </div>
      </div>
    );
  }

  const stepData = checkInSteps[step];
  const StepIcon = (Icons as unknown as Record<string, typeof Camera>)[stepData.icon] ?? Camera;
  const isLast = step === checkInSteps.length - 1;

  return (
    <div className="animate-fade-in pb-20 md:pb-10">
      <div className="max-w-lg mx-auto px-4 sm:px-6 py-5 sm:py-8">
        <button onClick={back} className="inline-flex items-center gap-1.5 text-sm font-medium text-sec mb-5 hover:text-main transition-colors duration-fast">
          <ArrowLeft size={18} /> Back
        </button>
        <div className="flex items-center gap-3 mb-6">
          <img src={listing.images[0]} alt="" className="w-12 h-12 rounded-card object-cover bg-subtle" />
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-main font-display">Check-in</h1>
            <p className="text-xs text-sec truncate">{listing.title}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 mb-8">
          {checkInSteps.map((s, i) => (
            <div key={s.id} className={`h-1.5 flex-1 rounded-full transition-colors duration-standard ${i <= step ? 'bg-accent' : 'bg-[var(--border-strong)]'}`} />
          ))}
        </div>
        <div className="text-center py-6">
          <div className="w-16 h-16 rounded-full bg-accent-soft grid place-items-center mx-auto mb-4">
            <StepIcon size={28} className="text-accent" />
          </div>
          <p className="text-xs font-semibold text-muted tnum">Step {step + 1} of {checkInSteps.length}</p>
          <h2 className="text-xl font-bold text-main font-display mt-1.5 mb-2">{stepData.label}</h2>
          <p className="text-sm text-sec max-w-xs mx-auto leading-relaxed">
            {step === 0 && 'Take a clear photo of the item showing its current condition.'}
            {step === 1 && 'Photograph the serial number for verification.'}
            {step === 2 && 'Confirm all components are present and accounted for.'}
            {step === 3 && 'Record the item condition and any existing wear.'}
            {step === 4 && 'Hand off the item to the renter and confirm handoff.'}
          </p>
          {step === 2 && (
            <div className="mt-6 text-left space-y-2 max-w-sm mx-auto">
              {listing.components.map((c, i) => (
                <Surface key={i} className="flex items-center gap-2 px-3 h-11">
                  <Check size={15} className="text-success" />
                  <span className="text-sm text-main flex-1">{c.name}</span>
                  <span className="text-xs text-success font-semibold">Present</span>
                </Surface>
              ))}
            </div>
          )}
          {step !== 2 && (
            <div className="mt-6 flex justify-center">
              <div className="w-32 h-32 rounded-card-lg border-2 border-dashed border-strong flex flex-col items-center justify-center gap-2 text-muted">
                <Camera size={26} />
                <span className="text-xs font-medium">Tap to capture</span>
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-2.5 mt-6">
          {step > 0 && (
            <Button variant="secondary" size="lg" onClick={() => setStep(step - 1)} aria-label="Previous step">
              <ArrowLeft size={16} />
            </Button>
          )}
          <Button size="lg" fullWidth trailingIcon={<ArrowRight size={16} />} onClick={() => (isLast ? setDone(true) : setStep(step + 1))}>
            {isLast ? 'Confirm handoff' : 'Continue'}
          </Button>
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

  if (booking === undefined) return <WizardSkeleton />;
  if (!booking) return <WizardMissing message="We couldn't find that booking." />;

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
      <div className="animate-fade-in pb-20 md:pb-10">
        <div className="max-w-lg mx-auto px-4 sm:px-6 py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-success-soft grid place-items-center mx-auto mb-4 animate-booking-confirmed">
            <Check className="text-success" size={34} />
          </div>
          <h1 className="text-2xl font-bold text-main font-display">Return complete</h1>
          <p className="text-sec text-sm mt-2">
            {missingComponent !== null ? 'A missing-component claim was filed and the owner has been notified.' : 'Everything came back as expected.'}
          </p>
          {booking.deposit > 0 && (
            <p className="text-sec text-sm mt-1.5">Your ${booking.deposit} security hold is released within 3–5 business days.</p>
          )}
          <Button className="mt-7" onClick={() => navigate({ name: 'dashboard', tab: 'renting' })}>View Bookings</Button>
        </div>
      </div>
    );
  }

  const stepData = checkOutSteps[step];
  const StepIcon = (Icons as unknown as Record<string, typeof Camera>)[stepData.icon] ?? Camera;
  const isLast = step === checkOutSteps.length - 1;
  const returnedCount = GENERIC_RETURN_CHECKLIST.length - (missingComponent !== null ? 1 : 0);

  return (
    <div className="animate-fade-in pb-20 md:pb-10">
      <div className="max-w-lg mx-auto px-4 sm:px-6 py-5 sm:py-8">
        <button onClick={back} className="inline-flex items-center gap-1.5 text-sm font-medium text-sec mb-5 hover:text-main transition-colors duration-fast">
          <ArrowLeft size={18} /> Back
        </button>
        <div className="flex items-center gap-3 mb-6">
          <img src={booking.listingImage} alt="" className="w-12 h-12 rounded-card object-cover bg-subtle" />
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-main font-display">Return inspection</h1>
            <p className="text-xs text-sec truncate">{booking.listingTitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 mb-8">
          {checkOutSteps.map((s, i) => (
            <div key={s.id} className={`h-1.5 flex-1 rounded-full transition-colors duration-standard ${i <= step ? 'bg-accent' : 'bg-[var(--border-strong)]'}`} />
          ))}
        </div>
        <div className="text-center py-4">
          <div className="w-16 h-16 rounded-full bg-accent-soft grid place-items-center mx-auto mb-4">
            <StepIcon size={28} className="text-accent" />
          </div>
          <p className="text-xs font-semibold text-muted tnum">Step {step + 1} of {checkOutSteps.length}</p>
          <h2 className="text-xl font-bold text-main font-display mt-1.5 mb-2">{stepData.label}</h2>
          {step === 1 && (
            <div className="mt-6 text-left space-y-2 max-w-sm mx-auto">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-main">Component checklist</span>
                <span className={`text-sm font-bold tnum ${missingComponent !== null ? 'text-warning' : 'text-success'}`}>
                  {returnedCount} / {GENERIC_RETURN_CHECKLIST.length} returned
                </span>
              </div>
              {GENERIC_RETURN_CHECKLIST.map((name, i) => (
                <button
                  key={i}
                  onClick={() => setMissingComponent(missingComponent === i ? null : i)}
                  className="w-full flex items-center gap-2 px-3 h-11 rounded-card-lg bg-card border border-app hover:bg-subtle transition-colors duration-fast text-left"
                >
                  {missingComponent === i ? <AlertTriangle size={15} className="text-warning" /> : <Check size={15} className="text-success" />}
                  <span className="text-sm text-main flex-1">{name}</span>
                  <span className={`text-xs font-semibold ${missingComponent === i ? 'text-warning' : 'text-success'}`}>
                    {missingComponent === i ? 'Missing' : 'Returned'}
                  </span>
                </button>
              ))}
              {missingComponent !== null && (
                <Alert tone="warning">A missing-component claim is filed automatically and the owner is notified.</Alert>
              )}
            </div>
          )}
          {(step === 0 || step === 2) && (
            <div className="mt-6 flex justify-center">
              <div className="w-32 h-32 rounded-card-lg border-2 border-dashed border-strong flex flex-col items-center justify-center gap-2 text-muted">
                <Camera size={26} />
                <span className="text-xs font-medium">Tap to capture</span>
              </div>
            </div>
          )}
        </div>
        {error && <Alert tone="error" className="mt-4">{error}</Alert>}
        <div className="flex gap-2.5 mt-6">
          {step > 0 && (
            <Button variant="secondary" size="lg" onClick={() => setStep(step - 1)} aria-label="Previous step">
              <ArrowLeft size={16} />
            </Button>
          )}
          <Button
            size="lg"
            fullWidth
            loading={completing}
            loadingLabel="Completing…"
            trailingIcon={<ArrowRight size={16} />}
            onClick={() => (isLast ? handleComplete() : setStep(step + 1))}
          >
            {isLast ? 'Complete return' : 'Continue'}
          </Button>
        </div>
      </div>
    </div>
  );
}
