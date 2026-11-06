import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '@/auth-context';
import { useRouter } from '@/router';
import { fetchBookingById, startBookingReturn, type UiBooking } from '@/lib/bookings';
import {
  acknowledgeBookingInspection,
  beginBookingReturnInspection,
  fetchBookingHandoff,
  getBookingHandoffOtp,
  regenerateBookingHandoffOtp,
  saveBookingInspection,
  startBookingHandoff,
  startBookingPickup,
  uploadBookingInspectionPhoto,
  verifyBookingHandoffOtp,
  type BookingHandoff,
  type HandoffKind,
  type HandoffInspection,
} from '@/lib/booking-handoff';
import { createCase, uploadCaseEvidence } from '@/lib/operations';
import { submitBookingDepositClaim } from '@/lib/security-deposit';
import { BookingPickup } from '@/main-site/components/booking-pickup';
import { DepositAuthorizationStatus } from '@/main-site/components/deposit-authorization-status';
import { BookingPrecheckin } from '@/main-site/components/booking-precheckin';
import { RentalSettlement } from '@/main-site/components/rental-settlement';
import { Alert, Badge, Button, SectionHeader, Surface } from '@/main-site/components/ui';
import { ArrowLeft, ArrowRight, CalendarDays, Check, CheckCircle2, Clock3, Handshake, ShieldCheck, Star, UserRound } from 'lucide-react';

type Props = { bookingId: string; kind: HandoffKind };

function dateLabel(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short', month: 'long', day: 'numeric', year: 'numeric',
  });
}

function dateTimeLabel(date: string | null) {
  return date ? new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null;
}

function WorkflowProgress({ kind, status, bookingStatus, arrived, done }: {
  kind: HandoffKind;
  status: BookingHandoff['status'];
  bookingStatus: UiBooking['status'];
  arrived: boolean;
  done: boolean;
}) {
  const steps = ['Booking confirmed', 'Pickup handoff', 'Rental active', 'Return handoff', 'Review & complete'];
  const active = status === 'returned' || bookingStatus === 'completed' || (kind === 'return' && done) ? 4
    : ['return_initiated', 'return_inspection', 'return_otp_pending'].includes(status ?? '')
      || (kind === 'return' && status === null && bookingStatus === 'return_pending') ? 3
      : status === 'rental_active' || (status === null && ['active', 'return_pending'].includes(bookingStatus))
        || (kind === 'pickup' && done) ? 2
        : ['pickup_ready', 'pickup_checkin_started', 'pickup_inspection', 'pickup_otp_pending'].includes(status ?? '') || arrived ? 1
          : 0;
  return (
    <ol aria-label="Rental progress" className="mb-5 grid grid-cols-2 gap-y-5 rounded-card-lg border border-app bg-card px-3 py-5 sm:grid-cols-5 sm:px-5">
      {steps.map((label, index) => {
        const complete = index < active;
        const current = index === active;
        return (
          <li key={label} aria-current={current ? 'step' : undefined}
            className="relative isolate flex min-w-0 flex-col items-center gap-2 text-center">
            {index < steps.length - 1 && <span aria-hidden="true" className="absolute left-1/2 right-[-50%] top-4 z-0 hidden h-0.5 bg-border sm:block" />}
            <span className={`relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 ${
              complete ? 'border-success bg-success text-white'
                : current ? 'border-accent bg-accent text-accent-text'
                  : 'border-border bg-card text-sec'
            }`}>
              {complete ? <Check size={15} aria-hidden="true" /> : index + 1}
            </span>
            <span className={`relative z-10 max-w-28 bg-card px-1 text-xs leading-tight ${current ? 'font-semibold text-main' : complete ? 'font-medium text-main' : 'text-sec'}`}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function InspectionRecord({ inspection, photos, title }: {
  inspection: HandoffInspection | null;
  photos: NonNullable<BookingHandoff['pickup']>['photos'];
  title: string;
}) {
  if (!inspection) return null;
  return (
    <section className="space-y-3">
      <h3 className="font-semibold text-main">{title}</h3>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-xs font-semibold text-sec">Appearance and condition</dt><dd className="mt-1 whitespace-pre-wrap text-main">{inspection.appearance_condition}</dd></div>
        <div><dt className="text-xs font-semibold text-sec">Scratches or damage</dt><dd className="mt-1 whitespace-pre-wrap text-main">{inspection.existing_damage}</dd></div>
        <div><dt className="text-xs font-semibold text-sec">Accessories</dt><dd className="mt-1 text-main">{inspection.included_accessories.join(', ') || 'None listed'}</dd></div>
        <div><dt className="text-xs font-semibold text-sec">Functional condition</dt><dd className="mt-1 whitespace-pre-wrap text-main">{inspection.functional_condition}</dd></div>
        {inspection.serial_number && <div><dt className="text-xs font-semibold text-sec">Serial number</dt><dd className="mt-1 text-main">{inspection.serial_number}</dd></div>}
      </dl>
      {photos.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {photos.map((photo, index) => photo.signedUrl && (
            <a key={photo.id} href={photo.signedUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-card border border-app focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
              <img src={photo.signedUrl} alt={`${title} photo ${index + 1}`} className="aspect-square w-full object-cover" />
            </a>
          ))}
        </div>
      )}
      <p className="text-xs text-sec">Recorded {dateTimeLabel(inspection.submitted_at)}</p>
    </section>
  );
}

export function BookingHandoff({ bookingId, kind }: Props) {
  const { user } = useAuth();
  const { back, navigate } = useRouter();
  const [booking, setBooking] = useState<UiBooking | null>(null);
  const [handoff, setHandoff] = useState<BookingHandoff | null>(null);
  const [precheckinReady, setPrecheckinReady] = useState(false);
  const [returnReady, setReturnReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const photoInput = useRef<HTMLInputElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [appearance, setAppearance] = useState('');
  const [damage, setDamage] = useState('');
  const [accessories, setAccessories] = useState('');
  const [functional, setFunctional] = useState('');
  const [serial, setSerial] = useState('');
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [otp, setOtp] = useState<{ code: string; expires_at: string; generation: number } | null>(null);
  const [otpLoadError, setOtpLoadError] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [now, setNow] = useState(Date.now());
  const [issueKind, setIssueKind] = useState<'support' | 'dispute'>('support');
  const [issueCategory, setIssueCategory] = useState('pickup_return');
  const [issueSubject, setIssueSubject] = useState('');
  const [issueDescription, setIssueDescription] = useState('');
  const [issueEvidence, setIssueEvidence] = useState<File | null>(null);
  const [issueCaseId, setIssueCaseId] = useState<string | null>(null);
  const [claimSubject, setClaimSubject] = useState('Damage found at return');
  const [claimDescription, setClaimDescription] = useState('');
  const [claimAmount, setClaimAmount] = useState('');
  const [claimEvidence, setClaimEvidence] = useState<File | null>(null);
  const [claimCaseId, setClaimCaseId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!user) return;
    setLoading(true);
    setLoadError(null);
    Promise.all([fetchBookingById(bookingId, user.id), fetchBookingHandoff(bookingId)])
      .then(([row, state]) => {
        if (!active) return;
        if (!row) throw new Error('This booking is unavailable or you do not have access.');
        setBooking(row);
        setHandoff(state);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setLoadError(reason instanceof Error ? reason.message : 'Could not load the handoff.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [bookingId, user, refreshKey]);

  const inspectionDetail = handoff?.[kind] ?? null;
  const inspection = inspectionDetail?.inspection ?? null;
  const photos = inspectionDetail?.photos ?? [];
  useEffect(() => {
    if (!inspection) return;
    setAppearance(inspection.appearance_condition);
    setDamage(inspection.existing_damage);
    setAccessories(inspection.included_accessories.join('\n'));
    setFunctional(inspection.functional_condition);
    setSerial(inspection.serial_number);
  }, [inspection]);

  useEffect(() => {
    let active = true;
    if (!handoff || handoff.is_owner || handoff.status !== (kind === 'pickup' ? 'pickup_otp_pending' : 'return_otp_pending')) {
      setOtp(null);
      setOtpLoadError(null);
      return;
    }
    setOtpLoadError(null);
    getBookingHandoffOtp(bookingId, kind).then((value) => {
      if (active) setOtp(value);
    }).catch((reason: unknown) => {
      if (!active) return;
      setOtp(null);
      setOtpLoadError(reason instanceof Error ? reason.message : 'Could not load the verification code.');
    });
    return () => { active = false; };
  }, [bookingId, kind, handoff, refreshKey]);

  useEffect(() => {
    if (!otp) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [otp]);

  async function perform(action: string, operation: () => Promise<void>) {
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      await operation();
      setRefreshKey((key) => key + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That action could not be completed. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveInspection(event: FormEvent) {
    event.preventDefault();
    if (!inspection && photoFiles.length < 2) {
      setError('Add at least two condition photos before saving the inspection.');
      return;
    }
    await perform('save-inspection', async () => {
      const saved = await saveBookingInspection({
        bookingId,
        kind,
        appearanceCondition: appearance,
        existingDamage: damage,
        includedAccessories: accessories.split('\n').map((item) => item.trim()).filter(Boolean),
        functionalCondition: functional,
        serialNumber: serial,
      });
      const pendingPhotos = [...photoFiles];
      while (pendingPhotos.length) {
        const next = pendingPhotos[0];
        await uploadBookingInspectionPhoto(bookingId, kind, saved.id, next);
        pendingPhotos.shift();
        setPhotoFiles([...pendingPhotos]);
      }
      if (photoInput.current) photoInput.current.value = '';
      setNotice('Inspection and evidence saved. Review it together, then each participant can acknowledge it.');
    });
  }

  async function handleAcknowledge() {
    await perform('acknowledge', async () => {
      await acknowledgeBookingInspection(bookingId, kind);
      setNotice('Your inspection acknowledgment was recorded.');
    });
  }

  async function handleOtpVerify(event: FormEvent) {
    event.preventDefault();
    await perform('verify-otp', async () => {
      const result = await verifyBookingHandoffOtp(bookingId, kind, otpCode);
      if (!result.verified) {
        const remaining = result.attempts_remaining;
        throw new Error(`${result.error ?? 'The code could not be verified.'}${remaining !== undefined ? ` ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.` : ''}`);
      }
      setOtpCode('');
      setNotice(kind === 'pickup' ? 'Pickup verified. The rental is now active.' : 'Return verified. The settlement workflow has started.');
    });
  }

  async function handleRegenerate() {
    setBusy('regenerate');
    setError(null);
    setOtpLoadError(null);
    try {
      setOtp(await regenerateBookingHandoffOtp(bookingId, kind));
    } catch (reason) {
      setOtpLoadError(reason instanceof Error ? reason.message : 'Could not request a new verification code.');
    } finally {
      setBusy(null);
    }
  }

  async function handleIssue(event: FormEvent) {
    event.preventDefault();
    if (!user) return;
    await perform('issue', async () => {
      const form = new FormData();
      form.set('booking_id', bookingId);
      form.set('category', issueCategory);
      form.set('subject', issueSubject);
      form.set('description', issueDescription);
      const caseId = issueCaseId ?? (await createCase(issueKind, form, false)).id;
      setIssueCaseId(caseId);
      if (issueEvidence) await uploadCaseEvidence(caseId, issueEvidence);
      setIssueCaseId(null);
      setIssueSubject('');
      setIssueDescription('');
      setIssueEvidence(null);
      setNotice('Your case was submitted to YBuy Support for review.');
    });
  }

  async function handleDepositClaim(event: FormEvent) {
    event.preventDefault();
    if (!booking?.isOwner || !claimEvidence) return;
    await perform('claim', async () => {
      const caseId = claimCaseId ?? await submitBookingDepositClaim({
        bookingId,
        subject: claimSubject,
        description: claimDescription,
        requestedAmount: Number(claimAmount),
      });
      setClaimCaseId(caseId);
      await uploadCaseEvidence(caseId, claimEvidence);
      setClaimCaseId(null);
      setClaimDescription('');
      setClaimAmount('');
      setClaimEvidence(null);
      setNotice('Damage claim submitted. No deposit will be captured automatically while it is disputed.');
    });
  }

  if (loading) {
    return <div className="mx-auto max-w-3xl px-4 py-12 text-sm text-sec" role="status">Loading booking handoff…</div>;
  }
  if (loadError || !booking || !handoff) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <Alert tone="error" title="We couldn't load this handoff">{loadError ?? 'Booking information is unavailable.'}</Alert>
        <Button className="mt-4" variant="secondary" onClick={() => setRefreshKey((key) => key + 1)}>Try again</Button>
      </div>
    );
  }

  const done = kind === 'pickup'
    ? Boolean(handoff.actual_pickup_at) || (handoff.status === null && ['active', 'return_pending', 'completed'].includes(booking.status))
    : handoff.status === 'returned' || booking.status === 'completed';
  const waitingForOtp = handoff.status === (kind === 'pickup' ? 'pickup_otp_pending' : 'return_otp_pending');
  const otherInspection = kind === 'return' ? handoff.pickup : null;
  const acceptedTime = kind === 'pickup' ? handoff.actual_pickup_at : handoff.actual_return_at;
  const dueDate = dateLabel(handoff.end_date);
  const otpSeconds = otp ? Math.max(0, Math.ceil((new Date(otp.expires_at).getTime() - now) / 1000)) : 0;
  const ownerCanInspect = handoff.is_owner && (kind === 'pickup'
    ? handoff.status === 'pickup_checkin_started' || handoff.status === 'pickup_inspection'
    : handoff.status === 'return_inspection');
  const userAcknowledged = inspection && (handoff.is_owner
    ? inspection.owner_acknowledged_at
    : inspection.renter_acknowledged_at);
  const inspectionLocked = Boolean(inspection?.owner_acknowledged_at || inspection?.renter_acknowledged_at);
  const ownerName = handoff.is_owner ? 'You' : booking.counterpartName;
  const renterName = handoff.is_owner ? booking.counterpartName : 'You';
  const rentalStatus = booking.status === 'completed' ? 'Rental complete'
    : booking.status === 'active' || booking.status === 'return_pending' ? 'Active rental'
      : done ? (kind === 'pickup' ? 'Active rental' : 'Returned')
        : 'Confirmed rental';
  const signoff = [
    { role: 'Owner', acknowledged: inspection?.owner_acknowledged_at },
    { role: 'Renter', acknowledged: inspection?.renter_acknowledged_at },
  ];

  return (
    <main className="animate-fade-in pb-20 md:pb-10">
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8">
        <button onClick={back} className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-sec hover:text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
          <ArrowLeft size={17} /> Back
        </button>
        <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-main font-display sm:text-3xl">{handoff.is_owner ? 'Owner flow' : 'Renter flow'}</h1>
            <p className="mt-1 text-sm text-sec">
              You’re {handoff.is_owner ? 'lending' : 'renting'} · {kind === 'pickup' ? 'Pickup handoff' : 'Return handoff'} · Confirm the item condition together.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {booking.bookingReference && <span className="text-sm font-semibold text-sec">Booking #{booking.bookingReference}</span>}
            <Badge tone={done ? 'success' : 'accent'} icon={<span className="h-2 w-2 rounded-full bg-current" aria-hidden="true" />}>{rentalStatus}</Badge>
          </div>
        </header>

        <Surface className="mb-4 overflow-hidden p-0">
          <div className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
            <img src={booking.listingImage} alt="" className="h-16 w-16 shrink-0 rounded-card-lg bg-subtle object-cover sm:h-20 sm:w-20" />
            <div className="min-w-0 flex-1 basis-56">
              <h2 className="text-lg font-bold text-main font-display sm:text-xl">{booking.listingTitle}</h2>
              <p className="mt-0.5 text-sm text-sec">{booking.deliveryMode === 'delivery' ? 'Delivery rental' : 'Pickup rental'} · {booking.counterpartName}</p>
            </div>
            <div className="hidden items-center gap-2 rounded-full bg-subtle px-3 py-2 text-sm font-medium text-sec sm:flex">
              <Handshake size={17} aria-hidden="true" /> {kind === 'pickup' ? 'Pickup handoff' : 'Return handoff'}
            </div>
          </div>
          <dl className="grid grid-cols-2 border-t border-app bg-subtle/50 sm:grid-cols-4">
            <div className="border-b border-app px-4 py-3 sm:border-b-0 sm:border-r">
              <dt className="flex items-center gap-1.5 text-xs font-medium text-sec"><CalendarDays size={14} aria-hidden="true" />Rental period</dt>
              <dd className="mt-1 text-sm font-semibold text-main">{dateLabel(booking.startDate)} – {dateLabel(booking.endDate)}</dd>
            </div>
            <div className="border-b border-app px-4 py-3 sm:border-b-0 sm:border-r">
              <dt className="flex items-center gap-1.5 text-xs font-medium text-sec"><UserRound size={14} aria-hidden="true" />Owner</dt>
              <dd className="mt-1 truncate text-sm font-semibold text-main">{ownerName}</dd>
            </div>
            <div className="px-4 py-3 sm:border-r sm:border-app">
              <dt className="flex items-center gap-1.5 text-xs font-medium text-sec"><UserRound size={14} aria-hidden="true" />Renter</dt>
              <dd className="mt-1 truncate text-sm font-semibold text-main">{renterName}</dd>
            </div>
            <div className="px-4 py-3">
              <dt className="text-xs font-medium text-sec">Item exchange</dt>
              <dd className="mt-1 text-sm font-semibold text-main">{booking.deliveryMode === 'delivery' ? 'Delivery' : 'In-person pickup'}</dd>
            </div>
          </dl>
        </Surface>

        <WorkflowProgress kind={kind} status={handoff.status} bookingStatus={booking.status}
          arrived={Boolean(handoff.pickup_arrived_at)} done={done} />

        {kind === 'pickup' && booking.paymentFirst && !done && <BookingPrecheckin booking={booking} onReady={setPrecheckinReady} />}
        {kind === 'return' && !done && ['active', 'return_pending'].includes(booking.status) && <BookingPrecheckin booking={booking} kind="return" onReady={setReturnReady} />}
        {kind === 'pickup' && <div className="mb-4"><BookingPickup key={String(precheckinReady)} bookingId={bookingId} status={booking.status} paymentFirst={booking.paymentFirst} /></div>}
        {booking.deposit > 0 && !(kind === 'pickup' && booking.paymentFirst && !done) && <div className="mb-4"><DepositAuthorizationStatus bookingId={bookingId} deposit={booking.deposit}
          collectionModel={booking.depositCollectionModel} isOwner={booking.isOwner} paymentFirst={booking.paymentFirst} /></div>}
        {kind === 'return' && !done && !handoff.pickup && (
          <Alert className="mb-4" tone="warning" title="No pickup-condition record is available">
            This rental began before photo-backed pickup inspections were available. Record the current condition and photos carefully; both parties must still acknowledge the return inspection and verify the return code.
          </Alert>
        )}

        {done ? (
          <>
          <Surface className="mb-5 p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-success-soft text-success"><ShieldCheck size={21} /></span>
              <div>
                <h2 className="text-lg font-bold text-main">
                  {kind === 'pickup' ? (handoff.actual_pickup_at ? 'Pickup verified' : 'Rental active') : (handoff.actual_return_at ? 'Return verified' : 'Return complete')}
                </h2>
                <p className="mt-1 text-sm text-sec">
                  {handoff.actual_pickup_at || handoff.actual_return_at
                    ? `${kind === 'pickup' ? 'Rental started' : 'Return completed'} ${dateTimeLabel(acceptedTime)}.`
                    : `This booking reached ${kind === 'pickup' ? 'active' : 'completed'} before in-app handoff verification was available.`}
                </p>
                {kind === 'pickup' && <p className="mt-2 text-sm text-sec">Expected return: <strong className="font-semibold text-main">{dueDate}</strong></p>}
                {kind === 'return' && <p className="mt-2 text-sm text-sec">Security deposit settlement is shown below. Open disputes prevent automatic settlement.</p>}
              </div>
            </div>
            {kind === 'return' && <div className="mt-5"><RentalSettlement bookingId={bookingId} isOwner={booking.isOwner} autoProcess /></div>}
            <Button className="mt-5" variant="secondary" onClick={() => navigate({ name: 'dashboard', tab: booking.isOwner ? 'lending' : 'renting' })}>View bookings</Button>
          </Surface>
          {kind === 'return' && (handoff.pickup?.inspection || handoff.return?.inspection) && (
            <Surface className="mb-5 p-4 sm:p-6">
              <SectionHeader as="h2" title="Item condition record" subtitle="Review the saved handoff notes and private booking photos." className="mb-4" />
              <div className="grid gap-6 md:grid-cols-2">
                {handoff.pickup?.inspection && <InspectionRecord inspection={handoff.pickup.inspection} photos={handoff.pickup.photos} title="Pickup condition" />}
                {handoff.return?.inspection && <InspectionRecord inspection={handoff.return.inspection} photos={handoff.return.photos} title="Return condition" />}
              </div>
            </Surface>
          )}
          {kind === 'return' && (
            <Surface className="mb-5 flex flex-wrap items-center justify-between gap-4 p-4 sm:p-6">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-subtle text-main"><Star size={19} aria-hidden="true" /></span>
                <div>
                  <h2 className="font-semibold text-main">Review &amp; rating</h2>
                  <p className="mt-1 text-sm text-sec">Share feedback with {booking.counterpartName} from your completed bookings.</p>
                </div>
              </div>
              <Button variant="secondary" icon={<Star size={15} aria-hidden="true" />}
                trailingIcon={<ArrowRight size={15} aria-hidden="true" />}
                onClick={() => navigate({ name: 'dashboard', tab: booking.isOwner ? 'lending' : 'renting' })}>
                Open My Rentals
              </Button>
            </Surface>
          )}
          </>
        ) : (
          <>
            <div className="mb-5 grid items-start gap-5 lg:grid-cols-2">
            <Surface className="p-4 sm:p-6">
              <SectionHeader as="h2" title={kind === 'pickup' ? 'Pickup handoff' : 'Return handoff'} subtitle={
                kind === 'pickup'
                  ? 'The owner records the item condition and photos. Review the evidence before acknowledging.'
                  : 'Compare the item with its pickup record, verify accessories, and record its current condition.'
              } className="mb-4" />

              {kind === 'pickup' && handoff.status === null && booking.status === 'confirmed' && !handoff.is_owner && (
                <Button disabled={booking.paymentFirst && !precheckinReady} loading={busy === 'arrive'} onClick={() => void perform('arrive', async () => {
                  await startBookingPickup(bookingId);
                  setNotice('Arrival sent. The owner has been notified and can start the handoff.');
                })}>{booking.deliveryMode === 'delivery' ? 'Ready for delivery' : "I'm Here – Start Pickup"}</Button>
              )}
              {kind === 'pickup' && handoff.status === 'pickup_ready' && handoff.is_owner && (
                <div>
                  <Alert tone="info" title="The renter is here">Start the handoff to open the condition checklist.</Alert>
                  <Button className="mt-3" disabled={booking.paymentFirst && !precheckinReady} loading={busy === 'start-handoff'} onClick={() => void perform('start-handoff', async () => {
                    await startBookingHandoff(bookingId);
                    setNotice('Handoff started. Document the item condition and upload photos.');
                  })}>Start Handoff</Button>
                </div>
              )}
              {kind === 'pickup' && handoff.status === 'pickup_checkin_started' && handoff.is_owner && (
                <Alert tone="info">Document the item's condition and upload at least two photos to continue.</Alert>
              )}
              {kind === 'pickup' && handoff.status === 'pickup_ready' && !handoff.is_owner && (
                <Alert tone="info">Arrival sent. Waiting for the owner to start the handoff.</Alert>
              )}
              {kind === 'return' && (handoff.status === 'rental_active' || (handoff.status === null && booking.status === 'active')) && !handoff.is_owner && (
                <Button disabled={!returnReady} loading={busy === 'start-return'} onClick={() => void perform('start-return', async () => {
                  await startBookingReturn(bookingId);
                  setNotice('Return started. The owner has been notified.');
                })}>Start Return</Button>
              )}
              {kind === 'return' && (handoff.status === 'rental_active' || (handoff.status === null && booking.status === 'active')) && !handoff.is_owner && !returnReady && (
                <Alert tone="info">Schedule and get owner approval for the return window before starting return.</Alert>
              )}
              {kind === 'return' && (handoff.status === 'rental_active' || (handoff.status === null && booking.status === 'active')) && handoff.is_owner && (
                <Alert tone="info">The renter has not started the return yet. You will be notified when they do.</Alert>
              )}
              {kind === 'return' && handoff.status === 'return_initiated' && handoff.is_owner && (
                <div>
                  <Alert tone="info" title="The renter started a return">Begin the inspection when the item is available.</Alert>
                  <Button className="mt-3" loading={busy === 'begin-return'} onClick={() => void perform('begin-return', async () => {
                    await beginBookingReturnInspection(bookingId);
                    setNotice('Return inspection opened. Compare the item with its pickup record.');
                  })}>Begin Return Inspection</Button>
                </div>
              )}
              {kind === 'return' && handoff.status === 'return_initiated' && !handoff.is_owner && (
                <Alert tone="info">Return started. Waiting for the owner to begin the inspection.</Alert>
              )}
              {kind === 'return' && handoff.status === 'return_inspection' && !handoff.is_owner && !inspection && (
                <Alert tone="info">The owner is documenting the return condition. You can review it here once it is saved.</Alert>
              )}

              {otherInspection && (
                <div className="mb-6 rounded-card-lg bg-subtle p-4">
                  <InspectionRecord inspection={otherInspection.inspection} photos={otherInspection.photos} title="Pickup condition reference" />
                </div>
              )}

              {ownerCanInspect && !inspectionLocked && (
                <form onSubmit={(event) => void handleSaveInspection(event)} className="mt-5 space-y-4">
                  <label className="block text-sm font-semibold text-main">
                    Item appearance and condition
                    <textarea required minLength={10} maxLength={2000} rows={3} value={appearance} onChange={(event) => setAppearance(event.target.value)}
                      className="mt-1.5 w-full rounded-card border border-app bg-card px-3 py-2.5 text-sm font-normal text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" />
                  </label>
                  <label className="block text-sm font-semibold text-main">
                    Existing scratches or damage
                    <textarea required minLength={1} maxLength={2000} rows={3} value={damage} onChange={(event) => setDamage(event.target.value)}
                      className="mt-1.5 w-full rounded-card border border-app bg-card px-3 py-2.5 text-sm font-normal text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" />
                    <span className="mt-1 block text-xs font-normal text-sec">Describe existing wear clearly; enter “None observed” when applicable.</span>
                  </label>
                  <label className="block text-sm font-semibold text-main">
                    Included accessories <span className="font-normal text-sec">(one per line)</span>
                    <textarea maxLength={3600} rows={3} value={accessories} onChange={(event) => setAccessories(event.target.value)}
                      className="mt-1.5 w-full rounded-card border border-app bg-card px-3 py-2.5 text-sm font-normal text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" />
                  </label>
                  <label className="block text-sm font-semibold text-main">
                    Functional condition
                    <textarea required minLength={3} maxLength={1000} rows={2} value={functional} onChange={(event) => setFunctional(event.target.value)}
                      className="mt-1.5 w-full rounded-card border border-app bg-card px-3 py-2.5 text-sm font-normal text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" />
                    <span className="mt-1 block text-xs font-normal text-sec">Describe the test performed or enter “Not applicable.”</span>
                  </label>
                  <label className="block text-sm font-semibold text-main">
                    Serial number <span className="font-normal text-sec">(if appropriate)</span>
                    <input maxLength={120} value={serial} onChange={(event) => setSerial(event.target.value)}
                      className="mt-1.5 h-11 w-full rounded-card border border-app bg-card px-3 text-sm font-normal text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" />
                  </label>
                  <label className="block text-sm font-semibold text-main">
                    Condition photos <span className="font-normal text-sec">(at least two; JPEG, PNG or WebP, up to 10 MB each)</span>
                    <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" multiple
                      onChange={(event) => setPhotoFiles(Array.from(event.target.files ?? []).slice(0, Math.max(0, 12 - photos.length)))}
                      className="mt-1.5 block w-full text-sm font-normal text-sec file:mr-3 file:rounded-card file:border file:border-app file:bg-subtle file:px-3 file:py-2 file:text-sm file:font-semibold file:text-main" />
                    <span className="mt-1 block text-xs font-normal text-sec">Stored privately and shared only with booking participants.</span>
                  </label>
                  {photoFiles.length > 0 && <p className="text-xs text-sec">{photoFiles.length} photo{photoFiles.length === 1 ? '' : 's'} selected</p>}
                  <Button type="submit" loading={busy === 'save-inspection'}>
                    {inspection ? 'Save inspection and photos' : 'Save inspection and photos'}
                  </Button>
                </form>
              )}

              {inspection && (
                <div className="mt-5 space-y-4">
                  <InspectionRecord inspection={inspection} photos={photos} title={kind === 'pickup' ? 'Pickup inspection record' : 'Return inspection record'} />
                  <div className="flex flex-wrap gap-2 text-xs text-sec">
                    <Badge tone={inspection.owner_acknowledged_at ? 'success' : 'neutral'}>Owner {inspection.owner_acknowledged_at ? 'acknowledged' : 'review pending'}</Badge>
                    <Badge tone={inspection.renter_acknowledged_at ? 'success' : 'neutral'}>Renter {inspection.renter_acknowledged_at ? 'acknowledged' : 'review pending'}</Badge>
                  </div>
                  {!userAcknowledged && photos.length >= 2 && (
                    <Button loading={busy === 'acknowledge'} onClick={() => void handleAcknowledge()}>
                      I reviewed and acknowledge this condition
                    </Button>
                  )}
                  {inspectionLocked && !userAcknowledged && <Alert tone="info">The inspection is locked because the other participant already acknowledged it. Review the saved condition, then record your acknowledgment.</Alert>}
                  {userAcknowledged && <p className="text-sm text-success">Your acknowledgment is recorded.</p>}
                </div>
              )}
            </Surface>

            <Surface className="p-4 sm:p-6">
                <SectionHeader as="h2" title={kind === 'pickup' ? 'Pickup verification' : 'Return verification'}
                  subtitle={waitingForOtp
                    ? 'Both participants acknowledged the inspection. The code is shared privately with the renter.'
                    : 'Complete the inspection and sign-off together before verifying the handoff.'}
                  className="mb-4" />
                {waitingForOtp ? !handoff.is_owner ? (
                  <div className="rounded-card-lg bg-accent-soft p-4 text-center">
                    <p className="text-sm font-semibold text-accent">Your private handoff code</p>
                    {otp && otpSeconds > 0 ? (
                      <>
                        <p aria-label="Six-digit handoff code" className="my-2 font-display text-4xl font-bold tracking-[0.2em] text-main tnum">{otp.code}</p>
                        <p className="flex items-center justify-center gap-1.5 text-xs text-sec"><Clock3 size={14} /> Expires in {otpSeconds > 0 ? `${Math.floor(otpSeconds / 60)}:${String(otpSeconds % 60).padStart(2, '0')}` : 'less than a minute'}</p>
                        <Button className="mt-2" size="sm" variant="ghost" onClick={() => setRefreshKey((key) => key + 1)}>Refresh code status</Button>
                      </>
                    ) : (
                      <div className="mt-2 space-y-2">
                        <p className="text-sm text-sec">{otpLoadError ?? 'Loading your code…'}</p>
                        {otpLoadError && <Button size="sm" variant="ghost" onClick={() => setRefreshKey((key) => key + 1)}>Try loading again</Button>}
                      </div>
                    )}
                    {(!otp || otpSeconds === 0) && <Button className="mt-3" size="sm" variant="secondary" loading={busy === 'regenerate'} onClick={() => void handleRegenerate()}>Request a new code</Button>}
                  </div>
                ) : (
                  <form onSubmit={(event) => void handleOtpVerify(event)} className="space-y-3">
                    <label className="block text-sm font-semibold text-main">
                      Enter the renter’s six-digit code
                      <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={otpCode}
                        onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                        className="mt-1.5 h-12 w-full rounded-card border border-app bg-card px-3 text-center font-display text-xl font-bold tracking-[0.25em] text-main tnum focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" />
                    </label>
                    <p className="text-xs text-sec">The code expires after five minutes. Incorrect entries are limited.</p>
                    <Button type="submit" disabled={otpCode.length !== 6} loading={busy === 'verify-otp'}>Verify and {kind === 'pickup' ? 'start rental' : 'complete return'}</Button>
                  </form>
                ) : (
                  <div className="space-y-4">
                    <div className="grid gap-2 sm:grid-cols-2" aria-label="Handoff sign-off">
                      {signoff.map(({ role, acknowledged }) => (
                        <div key={role} className="flex items-center gap-2 rounded-card border border-app bg-subtle/50 p-3">
                          <CheckCircle2 size={18} className={acknowledged ? 'text-success' : 'text-sec'} aria-hidden="true" />
                          <span className="text-sm font-medium text-main">{role}</span>
                          <span className="ml-auto text-xs text-sec">{acknowledged ? 'Confirmed' : 'Pending'}</span>
                        </div>
                      ))}
                    </div>
                    <Alert tone="info" title={inspection ? 'Waiting for both acknowledgments' : 'Inspection comes first'}>
                      {inspection
                        ? 'Both people should review the saved condition and photos. A private one-time code becomes available when both have acknowledged.'
                        : 'Once the owner saves the condition record and both people acknowledge it, the renter receives a private six-digit code here.'}
                    </Alert>
                  </div>
                )}
            </Surface>
            </div>

            {kind === 'pickup' && handoff.status === 'rental_active' && (
              <Surface className="mb-5 p-4 sm:p-6">
                <h2 className="font-semibold text-main">Rental details</h2>
                <p className="mt-2 text-sm text-sec">
                  {handoff.actual_pickup_at
                    ? `Pickup verified ${dateTimeLabel(handoff.actual_pickup_at)}.`
                    : 'This rental was active before in-app pickup verification was available.'}
                  {' '}Expected return: <strong className="text-main">{dueDate}</strong>.
                </p>
                <Button className="mt-4" onClick={() => navigate({ name: 'check-out', id: bookingId })}>View return details</Button>
              </Surface>
            )}

            {kind === 'return' && handoff.status === 'return_initiated' && (
              <Surface className="mb-5 p-4 sm:p-6">
                <h2 className="font-semibold text-main">Return timing</h2>
                <p className="mt-2 text-sm text-sec">
                  {handoff.return_initiated_at
                    ? `Return started ${dateTimeLabel(handoff.return_initiated_at)}.`
                    : 'This return was already in progress before handoff tracking was available.'}
                  {' '}Expected back: {dueDate}.
                </p>
              </Surface>
            )}
          </>
        )}

        {error && <Alert tone="error" title="Action not completed" className="mb-4">{error}</Alert>}
        {notice && <Alert tone="success" className="mb-4">{notice}</Alert>}

        {handoff.cases.length > 0 && (
          <Surface className="mb-5 p-4 sm:p-6">
            <h2 className="font-semibold text-main">Case and dispute history</h2>
            <ul className="mt-3 divide-y divide-[var(--border)]">
              {handoff.cases.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div><p className="text-sm font-medium text-main">{item.subject}</p><p className="text-xs text-sec">{item.kind} · {item.status} · {dateTimeLabel(item.created_at)}</p></div>
                  <Button size="sm" variant="ghost" onClick={() => navigate({ name: 'support', id: item.id })}>View case</Button>
                </li>
              ))}
            </ul>
          </Surface>
        )}

        {!done && (
          <details className="mb-5 rounded-card-lg border border-app bg-card p-4 sm:p-5">
            <summary className="cursor-pointer font-semibold text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">Report a no-show, issue, or dispute</summary>
            <p className="mt-2 text-sm text-sec">Use this if either participant is unavailable, the inspection is disputed, or you need support with an early or overdue return. Verification is still required; an issue report cannot mark an item picked up or returned.</p>
            <form onSubmit={(event) => void handleIssue(event)} className="mt-4 space-y-3">
              <label className="block text-sm font-semibold text-main">Case type
                <select value={issueKind} onChange={(event) => {
                  const value = event.target.value as 'support' | 'dispute';
                  setIssueKind(value);
                  setIssueCategory(value === 'support' ? 'pickup_return' : 'damaged');
                }} className="mt-1.5 h-11 w-full rounded-card border border-app bg-card px-3 text-sm font-normal text-main">
                  <option value="support">Support request / no-show</option><option value="dispute">Condition or return dispute</option>
                </select>
              </label>
              <label className="block text-sm font-semibold text-main">Issue
                <select value={issueCategory} onChange={(event) => setIssueCategory(event.target.value)} className="mt-1.5 h-11 w-full rounded-card border border-app bg-card px-3 text-sm font-normal text-main">
                  {(issueKind === 'support'
                    ? [['pickup_return', 'Pickup or return / participant unavailable'], ['booking', 'Booking'], ['other', 'Other']]
                    : [['damaged', 'New damage'], ['missing', 'Missing accessory or item'], ['malfunction', 'Functional damage'], ['late_return', 'Late return'], ['incorrect', 'Inspection record is incorrect'], ['other', 'Other']]
                  ).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="block text-sm font-semibold text-main">Subject
                <input required minLength={3} maxLength={160} value={issueSubject} onChange={(event) => setIssueSubject(event.target.value)}
                  className="mt-1.5 h-11 w-full rounded-card border border-app bg-card px-3 text-sm font-normal text-main" />
              </label>
              <label className="block text-sm font-semibold text-main">Details and reason
                <textarea required minLength={10} maxLength={2000} rows={3} value={issueDescription} onChange={(event) => setIssueDescription(event.target.value)}
                  className="mt-1.5 w-full rounded-card border border-app bg-card px-3 py-2 text-sm font-normal text-main" />
              </label>
              <label className="block text-sm font-semibold text-main">Evidence {issueKind === 'dispute' ? '(required)' : '(optional)'}
                <input type="file" required={issueKind === 'dispute'} accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setIssueEvidence(event.target.files?.[0] ?? null)}
                  className="mt-1.5 block w-full text-sm font-normal text-sec" />
                <span className="mt-1 block text-xs font-normal text-sec">Private image or PDF, up to 10 MB.</span>
              </label>
              <Button size="sm" type="submit" loading={busy === 'issue'}>{issueCaseId ? 'Retry evidence upload' : 'Send to YBuy Support'}</Button>
            </form>
          </details>
        )}

        {kind === 'return' && !done && booking.isOwner && booking.depositCollectionModel === 'authorization' && booking.deposit > 0 && (
          <details className="mb-5 rounded-card-lg border border-app bg-card p-4 sm:p-5">
            <summary className="cursor-pointer font-semibold text-main">Submit a damage claim</summary>
            <p className="mt-2 text-sm text-sec">Describe newly discovered damage, missing accessories, or functional issues and attach evidence. A staff decision is required; the deposit is never automatically captured while a claim is disputed.</p>
            <form onSubmit={(event) => void handleDepositClaim(event)} className="mt-4 space-y-3">
              <label className="block text-sm font-semibold text-main">Claim subject
                <input required minLength={3} maxLength={160} value={claimSubject} onChange={(event) => setClaimSubject(event.target.value)} className="mt-1.5 h-11 w-full rounded-card border border-app bg-card px-3 text-sm font-normal text-main" />
              </label>
              <label className="block text-sm font-semibold text-main">Reason and evidence details
                <textarea required minLength={10} maxLength={2000} rows={3} value={claimDescription} onChange={(event) => setClaimDescription(event.target.value)} className="mt-1.5 w-full rounded-card border border-app bg-card px-3 py-2 text-sm font-normal text-main" />
              </label>
              <label className="block text-sm font-semibold text-main">Requested deduction (USD)
                <input required type="number" min="0.01" max={booking.deposit} step="0.01" value={claimAmount} onChange={(event) => setClaimAmount(event.target.value)} className="mt-1.5 h-11 w-full rounded-card border border-app bg-card px-3 text-sm font-normal text-main" />
              </label>
              <label className="block text-sm font-semibold text-main">Evidence photo or document
                <input required type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setClaimEvidence(event.target.files?.[0] ?? null)} className="mt-1.5 block w-full text-sm font-normal text-sec" />
              </label>
              <Button size="sm" type="submit" loading={busy === 'claim'} disabled={!claimEvidence}>{claimCaseId ? 'Retry evidence upload' : 'Submit claim for review'}</Button>
            </form>
          </details>
        )}

        {done && booking.deposit > 0 && <DepositAuthorizationStatus bookingId={bookingId} deposit={booking.deposit}
          collectionModel={booking.depositCollectionModel} isOwner={booking.isOwner} paymentFirst={booking.paymentFirst} />}
        {handoff.events.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-2 text-sm font-semibold text-main">Handoff history</h2>
            <ul className="space-y-2">
              {handoff.events.slice().reverse().map((event) => (
                <li key={event.id} className="flex items-center gap-2 text-xs text-sec">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                  <span className="flex-1">{event.event_type.replace(/_/g, ' ')}</span>
                  <time dateTime={event.created_at}>{dateTimeLabel(event.created_at)}</time>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="sr-only" aria-live="polite">{busy ? 'Saving changes' : ''}</div>
      </div>
    </main>
  );
}
