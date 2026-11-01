import { useEffect, useState } from 'react';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import { checkInSteps, checkOutSteps } from '@/data';
import { fetchBookingById, completeBookingReturn, markBookingActive, type UiBooking } from '@/lib/bookings';
import { fetchListingById, toUiListing } from '@/lib/listings';
import * as Icons from 'lucide-react';
import { Button, Alert } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { SuccessIndicator } from '@/components/success-feedback';
import { RentalSettlement } from '@/components/rental-settlement';
import { BookingPickup } from '@/components/booking-pickup';
import { ListingPhoto } from '@/components/listing-card';
import { ArrowLeft, Check, Camera, ArrowRight, AlertTriangle } from 'lucide-react';
import { WorkspaceHeader, WorkflowSteps } from '@/components/account-workspace';

// Cosmetic checklist for the return-inspection wizard - not tied to any real per-item component
// data (Part 1 doesn't collect that), so it's a generic list rather than fabricated specifics.
const GENERIC_RETURN_CHECKLIST = ['Item', 'Accessories', 'Cables / charger'];

function WizardSkeleton() {
  return (
    <div className="p1-work-page p1-account space-y-5" aria-busy="true" aria-label="Loading rental workflow">
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
    <div className="p1-work-page p1-account"><div className="p1-empty">
      <h1 className="text-xl font-bold text-main font-display">{message}</h1>
      <Button className="mt-6" onClick={() => navigate({ name: 'dashboard', tab: 'renting' })}>Back to Bookings</Button>
    </div></div>
  );
}

export function CheckInPage({ id }: { id: string }) {
  const { navigate, back } = useRouter();
  const { user } = useAuth();
  const [booking, setBooking] = useState<UiBooking | null | undefined>(undefined);
  const [listing, setListing] = useState<ReturnType<typeof toUiListing> | null>(null);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!user) return;
    setDone(false);
    setCelebrate(false);
    setBooking(undefined);
    setListing(null);
    setLoadError(null);
    fetchBookingById(id, user.id)
      .then(async (row) => {
        if (cancelled) return;
        if (!row) {
          setBooking(null);
          return;
        }
        if (row.status === 'active') {
          setBooking(row);
          setDone(true);
          return;
        }
        if (row.status !== 'confirmed') {
          setBooking(null);
          return;
        }
        const listingRow = await fetchListingById(row.listingId);
        if (cancelled) return;
        setBooking(row);
        setListing(listingRow ? toUiListing(listingRow) : null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setBooking(null);
        setLoadError(err instanceof Error ? err.message : 'Could not load this booking.');
      });
    return () => { cancelled = true; };
  }, [id, user, loadAttempt]);

  if (booking === undefined) return <WizardSkeleton />;
  if (loadError) {
    return (
      <div className="p1-work-page p1-account">
        <Alert tone="error" title="We couldn't load this check-in">
          <p>{loadError}</p>
          <Button size="sm" variant="secondary" className="mt-3" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Try again</Button>
        </Alert>
      </div>
    );
  }
  if (!booking) return <WizardMissing message="This booking isn't ready for check-in." />;

  const bookingId = booking.id;
  async function handleConfirmHandoff() {
    if (!user || completing) return;
    setCompleting(true);
    setError(null);
    try {
      const updated = await markBookingActive(bookingId);
      if (updated.status !== 'active') throw new Error('The booking status could not be confirmed.');
      setBooking((current) => current ? { ...current, status: 'active' } : current);
      setCelebrate(true);
      setDone(true);
    } catch (err) {
      try {
        const latest = await fetchBookingById(bookingId, user.id);
        if (latest?.status === 'active') {
          setBooking(latest);
          setCelebrate(true);
          setDone(true);
          return;
        }
      } catch {
        setError('We could not verify whether the handoff was saved. Retry to check the booking status.');
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not confirm handoff. Please retry.');
    } finally {
      setCompleting(false);
    }
  }

  if (done) {
    return (
      <div className="p1-work-page p1-account">
        <div className="p1-confirmation">
          <div className="flex justify-center mb-5">
            <SuccessIndicator eventKey={celebrate ? `handoff:${booking.id}` : undefined} level="standard" />
          </div>
          <div className="success-content">
            <h1 className="text-2xl font-bold text-main font-display">Check-in complete</h1>
            <p className="text-sec text-sm mt-2 mb-2">The booking is marked active.</p>
            <p className="text-sec text-sm mb-7">This version does not save checklist answers or photos.</p>
          </div>
          <Button onClick={() => navigate({ name: 'dashboard', tab: 'renting' })}>View Bookings</Button>
        </div>
      </div>
    );
  }

  if (!listing) return <WizardMissing message="This booking isn't ready for check-in." />;

  const stepData = checkInSteps[step];
  const StepIcon = (Icons as unknown as Record<string, typeof Camera>)[stepData.icon] ?? Camera;
  const isLast = step === checkInSteps.length - 1;

  return (
    <div className="p1-work-page p1-account">
      <div>
        <button onClick={back} className="p1-back">
          <ArrowLeft size={18} /> Back
        </button>
        <WorkspaceHeader title="A good rental starts here." description="Review the gear together, agree on its condition, then confirm the handoff." />
        <WorkflowSteps labels={checkInSteps.map(s => s.label)} current={step} />
        <div className="account-detail-layout"><div className="p1-panel account-handoff-stage">
        <div className="mb-4"><BookingPickup bookingId={booking.id} status={booking.status} /></div>
        <Alert tone="warning" className="mb-4">
          Photo capture and evidence storage are not available. This checklist is not saved; only the booking status is updated when you confirm handoff.
        </Alert>
        <div className="account-handoff-step">
          <div className="account-step-icon">
            <StepIcon size={28} className="text-accent" />
          </div>
          <p className="text-xs font-semibold text-muted tnum">Step {step + 1} of {checkInSteps.length}</p>
          <h2 className="text-xl font-bold text-main font-display mt-1.5 mb-2">{stepData.label}</h2>
          <p className="text-sm text-sec max-w-xs mx-auto leading-relaxed">
            {step === 0 && "Photo capture is unavailable. Review the item's current condition with the other participant."}
            {step === 1 && 'A serial-number photo cannot be captured or saved in this version.'}
            {step === 2 && 'Confirm all components are present and accounted for.'}
            {step === 3 && 'Condition photos cannot be captured or saved in this version. Review any existing wear together.'}
            {step === 4 && 'Hand off the item to the renter and confirm handoff.'}
          </p>
          {step === 2 && <Alert tone="info" className="mt-6 text-left">Component checklists are not saved in this version. Confirm the item directly with the other participant.</Alert>}
        </div>
        {error && <Alert tone="error" className="mt-4">{error}</Alert>}
        <div className="p1-actions account-handoff-actions">
          {step > 0 && (
            <Button variant="secondary" size="lg" onClick={() => setStep(step - 1)} aria-label="Previous step">
              <ArrowLeft size={16} />
            </Button>
          )}
          <Button size="lg" fullWidth loading={completing} loadingLabel="Confirming handoff…" trailingIcon={<ArrowRight size={16} />} onClick={() => (isLast ? void handleConfirmHandoff() : setStep(step + 1))}>
            {isLast ? 'Confirm handoff' : 'Continue'}
          </Button>
        </div>
        </div><aside className="p1-panel account-context" aria-label="Pickup booking">
          <div className="account-context-photo"><ListingPhoto src={listing.images[0]} alt="" /></div>
          <h2 className="text-main font-semibold">{listing.title}</h2>
          <p className="text-sm text-sec mt-2">From {booking.counterpartName}</p>
          <p className="text-sm text-sec mt-2">Handoff confirmation updates this booking to active. No condition evidence is stored by this checklist.</p>
          <Button variant="secondary" className="mt-4" onClick={() => navigate({ name: 'support' })}>Get help with this rental</Button>
        </aside></div>
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
  const [celebrate, setCelebrate] = useState(false);
  const [missingComponent, setMissingComponent] = useState<number | null>(null);
  const [completing, setCompleting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!user) return;
    setDone(false);
    setCelebrate(false);
    setBooking(undefined);
    setLoadError(null);
    fetchBookingById(id, user.id)
      .then((row) => {
        if (cancelled) return;
        if (row?.status === 'completed') {
          setBooking(row);
          setDone(true);
        } else if (row?.status === 'return_pending') {
          setBooking(row);
        } else {
          setBooking(null);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setBooking(null);
        setLoadError(err instanceof Error ? err.message : 'Could not load this return.');
      });
    return () => { cancelled = true; };
  }, [id, user, loadAttempt]);

  if (booking === undefined) return <WizardSkeleton />;
  if (loadError) {
    return (
      <div className="p1-work-page p1-account">
        <Alert tone="error" title="We couldn't load this return">
          <p>{loadError}</p>
          <Button size="sm" variant="secondary" className="mt-3" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Try again</Button>
        </Alert>
      </div>
    );
  }
  if (!booking) return <WizardMissing message="This booking isn't ready for return confirmation." />;

  async function handleComplete() {
    if (!user || completing) return;
    setCompleting(true);
    setError(null);
    try {
      const updated = await completeBookingReturn(id);
      if (updated.status !== 'completed') throw new Error('The return status could not be confirmed.');
      setCelebrate(true);
      setDone(true);
    } catch (err) {
      try {
        const latest = await fetchBookingById(id, user.id);
        if (latest?.status === 'completed') {
          setBooking(latest);
          setCelebrate(true);
          setDone(true);
          return;
        }
      } catch {
        setError('We could not verify whether the return was saved. Retry to check the booking status.');
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not complete the return. Please retry.');
    } finally {
      setCompleting(false);
    }
  }

  if (done) {
    return (
      <div className="p1-work-page p1-account">
        <div className="p1-confirmation">
          <div className="flex justify-center mb-5">
            <SuccessIndicator eventKey={celebrate ? `completed:${booking.id}` : undefined} level="standard" />
          </div>
          <div className="success-content">
            <h1 className="text-2xl font-bold text-main font-display">Return complete</h1>
            <p className="text-sec text-sm mt-2">
              {missingComponent !== null
                ? 'The return was marked complete, but this checklist is not saved and no claim or notification was created.'
                : 'The return was marked complete.'}
            </p>
            {booking.deposit > 0 && (
              <p className="text-sec text-sm mt-1.5">The ${booking.deposit} charged deposit is eligible for refund when no unresolved dispute exists. See the verified status below.</p>
            )}
          </div>
          <RentalSettlement bookingId={booking.id} isOwner={booking.isOwner} autoProcess />
          <Button className="mt-7" onClick={() => navigate({ name: 'dashboard', tab: booking.isOwner ? 'lending' : 'renting' })}>View Bookings</Button>
        </div>
      </div>
    );
  }

  const stepData = checkOutSteps[step];
  const StepIcon = (Icons as unknown as Record<string, typeof Camera>)[stepData.icon] ?? Camera;
  const isLast = step === checkOutSteps.length - 1;
  const returnedCount = GENERIC_RETURN_CHECKLIST.length - (missingComponent !== null ? 1 : 0);

  return (
    <div className="p1-work-page p1-account">
      <div>
        <button onClick={back} className="p1-back">
          <ArrowLeft size={18} /> Back
        </button>
        <WorkspaceHeader title="Finish the rental, thoughtfully." description="Review the returned item and its accessories before marking the return complete." />
        <WorkflowSteps labels={checkOutSteps.map(s => s.label)} current={step} />
        <div className="account-detail-layout"><div className="p1-panel account-handoff-stage">
        <div className="account-handoff-step">
          <div className="account-step-icon">
            <StepIcon size={28} className="text-accent" />
          </div>
          <p className="text-xs font-semibold text-muted tnum">Step {step + 1} of {checkOutSteps.length}</p>
          <h2 className="text-xl font-bold text-main font-display mt-1.5 mb-2">{stepData.label}</h2>
          {(step === 0 || step === 2) && (
            <Alert tone="warning" className="mt-4 text-left">
              Photo capture and evidence storage are not available. No photo will be captured or saved.
            </Alert>
          )}
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
                  type="button"
                  aria-pressed={missingComponent !== i}
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
                <Alert tone="warning">This checklist is for your reference only. It does not file a claim or notify the owner.</Alert>
              )}
            </div>
          )}
        </div>
        {error && <Alert tone="error" className="mt-4">{error}</Alert>}
        <div className="p1-actions account-handoff-actions">
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
        </div><aside className="p1-panel account-context" aria-label="Return booking">
          <div className="account-context-photo"><ListingPhoto src={booking.listingImage} alt="" /></div>
          <h2 className="font-semibold text-main">{booking.listingTitle}</h2>
          <p className="text-sm text-sec mt-2">{booking.deposit > 0 ? `$${booking.deposit} deposit charged. Refund status is verified after return.` : 'No security deposit on this booking.'}</p>
          <p className="text-sm text-sec mt-3">This checklist does not file a claim. Use the real disputes flow if something is wrong.</p>
          <Button variant="secondary" className="mt-4" onClick={() => navigate({ name: 'claims' })}>Disputes & claims</Button>
        </aside></div>
      </div>
    </div>
  );
}
