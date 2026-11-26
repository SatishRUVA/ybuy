import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '@/auth-context';
import { useRouter } from '@/router';
import { PageBackButton } from '@/main-site/components/page-back-button';
import { fetchBookingById, type UiBooking } from '@/lib/bookings';
import type { BookingPrecheckin as PrecheckinState } from '@/lib/booking-precheckin';
import {
  beginBookingHandoff,
  fetchBookingHandoff,
  getBookingHandoffOtp,
  regenerateBookingHandoffOtp,
  saveBookingInspectionDraft,
  publishBookingInspection,
  reviewBookingInspection,
  reportBookingReturnReceipt,
  uploadBookingInspectionPhoto,
  verifyBookingHandoffOtp,
  type BookingHandoff,
  type HandoffKind,
  type HandoffInspection,
  type WorkflowBookingHandoff,
  type HandoffWorkflow,
  type PendingInspectionPhoto,
} from '@/lib/booking-handoff';
import { createCase, uploadCaseEvidence } from '@/lib/operations';
import { submitBookingDepositClaim } from '@/lib/security-deposit';
import { BookingPickup } from '@/main-site/components/booking-pickup';
import { BookingDeliveryAddress } from '@/main-site/components/booking-delivery-address';
import { DepositAuthorizationStatus } from '@/main-site/components/deposit-authorization-status';
import { BookingPrecheckin } from '@/main-site/components/booking-precheckin';
import { RentalSettlement } from '@/main-site/components/rental-settlement';
import { Alert, Badge, Button, SectionHeader, Surface } from '@/main-site/components/ui';
import { ArrowRight, CalendarDays, Check, Clock3, Handshake, ShieldCheck, Star, UserRound } from 'lucide-react';

type Props = { bookingId: string; kind: HandoffKind };

function dateLabel(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short', month: 'long', day: 'numeric', year: 'numeric',
  });
}

function dateTimeLabel(date: string | null) {
  return date ? new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null;
}

function WorkflowProgress({ workflow }: { workflow: HandoffWorkflow }) {
  const steps = ['Arrange', 'Record condition', 'Confirm exchange'];
  const active = workflow.stage === 'arrange' ? 0
    : ['inspection', 'review'].includes(workflow.stage) ? 1
      : ['active', 'returned'].includes(workflow.stage) ? 3 : 2;
  return (
    <ol aria-label="Exchange progress" className="mb-5 grid grid-cols-3 gap-y-5 rounded-card-lg border border-app bg-card px-3 py-5 sm:px-5">
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

function arrangementGuidance(booking: UiBooking, kind: HandoffKind, workflow: HandoffWorkflow, schedule: PrecheckinState | null) {
  const slot = kind === 'pickup' ? schedule?.pickup_slot : schedule?.return_slot;
  const proposal = kind === 'pickup' ? schedule?.pickup_proposal : schedule?.return_proposal;
  if (!workflow.payment_ready) return {
    title: booking.isOwner ? 'Waiting for rental payment' : 'Rental payment needs confirmation',
    description: 'Check the payment status in booking details before continuing. If you already paid, do not pay again.',
  };
  if (!schedule) return {
    title: `Checking ${kind} requirements`,
    description: 'Checking the agreed time before showing your next step.',
  };
  const serverNow = Date.parse(schedule.server_now);
  if (proposal?.status === 'proposed' && (slot?.status !== 'approved' || Date.parse(slot.ends_at) <= serverNow)) return {
    title: proposal.proposed_by_is_owner !== booking.isOwner ? `Approve the proposed ${kind} time` : `Waiting for ${booking.counterpartName} to approve the time`,
    description: proposal.proposed_by_is_owner !== booking.isOwner
      ? 'Review the proposed time below, then approve it or decline it so another time can be proposed.'
      : 'Your proposal is sent. The other participant must approve it before the exchange can start.',
  };
  if (slot?.status !== 'approved') return {
    title: `Choose a ${kind} time`,
    description: `Select a time in the schedule below and send a proposal to ${booking.counterpartName}. Either participant can propose; the other approves.`,
  };
  if (Date.parse(slot.ends_at) <= serverNow) return {
    title: `The approved ${kind} time has passed`,
    description: 'Propose a different time below and have the other participant approve it. Contact support if no available times remain.',
  };
  if (kind === 'pickup' && !workflow.deposit_ready) return {
    title: booking.isOwner ? 'Waiting for the renter’s security hold' : 'Complete your security deposit step',
    description: booking.isOwner
      ? `${booking.counterpartName} needs to complete the separate deposit step below. Do not hand over the item until the hold is ready.`
      : 'Review Security deposit below. This is a separate temporary card hold, not another rental payment.',
  };
  const opensAtTime = Date.parse(slot.starts_at) - (kind === 'pickup' ? 2 * 60 * 60 * 1000 : 0);
  if (!workflow.scheduling_ready && opensAtTime > serverNow) {
    const opensAt = new Date(opensAtTime).toLocaleString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      timeZone: slot.time_zone, timeZoneName: 'short',
    });
    return {
      title: `${kind === 'pickup' ? 'Pickup' : 'Return'} opens ${opensAt}`,
      description: booking.isOwner
        ? `No action is needed yet. Meet ${booking.counterpartName} during the agreed window. When you are together, choose ${kind === 'pickup' ? 'Begin pickup' : 'Begin return inspection'} to record the condition and at least two photos.`
        : `No action is needed yet. Meet ${booking.counterpartName} during the agreed window. The owner records the condition first; you then review the photos and share your code when ready to exchange the item.`,
    };
  }
  if (kind === 'return' && !booking.isOwner && workflow.allowed_actions.includes('start_return')) return {
    title: 'Begin return when you are together',
    description: 'Choose Begin return below. The owner then records the returned condition for your review. Your return code confirms physical receipt only.',
  };
  return {
    title: booking.isOwner ? `Start ${kind} when you are together` : `Waiting for ${booking.counterpartName} to start ${kind}`,
    description: booking.isOwner
      ? `Choose ${kind === 'pickup' ? 'Begin pickup' : 'Begin return inspection'} below. Record the condition and at least two photos, then publish the inspection for ${booking.counterpartName} to review.`
      : `${booking.counterpartName} records and publishes the item condition first. The photos will appear here automatically for your review. Do not share a code until you are ready for the exchange.`,
  };
}

function InspectionRecord({ inspection, photos, title, onPhotoStatus }: {
  inspection: HandoffInspection | null;
  photos: NonNullable<BookingHandoff['pickup']>['photos'];
  title: string;
  onPhotoStatus?: (url: string, loaded: boolean) => void;
}) {
  const [failedPhotos, setFailedPhotos] = useState<Set<string>>(() => new Set());
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
          {photos.map((photo, index) => photo.signedUrl && !failedPhotos.has(photo.signedUrl) ? (
            <a key={photo.id} href={photo.signedUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-card border border-app focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
              <img src={photo.signedUrl} alt={`${title} photo ${index + 1}`} className="aspect-square w-full object-cover"
                onLoad={event => onPhotoStatus?.(event.currentTarget.src, true)}
                onError={event => {
                  const url = event.currentTarget.src;
                  setFailedPhotos(current => new Set(current).add(url));
                  onPhotoStatus?.(url, false);
                }} />
            </a>
          ) : <Alert key={photo.id} tone="error">{photo.loadError ?? 'Evidence photo is unavailable. Refresh the handoff before agreeing.'}</Alert>)}
        </div>
      )}
      <p className="text-xs text-sec">Recorded {dateTimeLabel(inspection.submitted_at)}</p>
    </section>
  );
}

export function BookingHandoff({ bookingId, kind }: Props) {
  const { user } = useAuth();
  const { navigate } = useRouter();
  const [booking, setBooking] = useState<UiBooking | null>(null);
  const [handoff, setHandoff] = useState<WorkflowBookingHandoff | null>(null);
  const [precheckinReady, setPrecheckinReady] = useState(false);
  const [schedule, setSchedule] = useState<PrecheckinState | null>(null);
  const [loading, setLoading] = useState(true);
  const photoInput = useRef<HTMLInputElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [appearance, setAppearance] = useState('');
  const [damage, setDamage] = useState('');
  const [accessories, setAccessories] = useState('');
  const [functional, setFunctional] = useState('');
  const [serial, setSerial] = useState('');
  const [photoFiles, setPhotoFiles] = useState<PendingInspectionPhoto[]>([]);
  const [loadedPhotos, setLoadedPhotos] = useState<Set<string>>(() => new Set());
  const [reviewDecision, setReviewDecision] = useState<'request_correction' | 'dispute' | null>(null);
  const [reviewReason, setReviewReason] = useState('');
  const [receiptReason, setReceiptReason] = useState('');
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
  const inspectionVersion = useRef<string | null>(null);
  const draftDirty = useRef(false);
  const draftBaseVersion = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    let refreshing = false;
    if (!user) return;
    const userId = user.id;
    setLoading(true);
    setLoadError(null);
    async function refresh(initial = false) {
      if (refreshing) return;
      refreshing = true;
      try {
        const [row, state] = await Promise.all([fetchBookingById(bookingId, userId), fetchBookingHandoff(bookingId, kind)]);
        if (!active) return;
        if (!row) throw new Error('This booking is unavailable or you do not have access.');
        setBooking(row);
        setHandoff(state);
        setRefreshError(null);
        setLoadError(null);
      } catch (reason) {
        if (!active) return;
        const message = reason instanceof Error ? reason.message : 'Could not load the handoff.';
        if (initial) setLoadError(message);
        else setRefreshError(message);
      } finally {
        refreshing = false;
        if (active && initial) setLoading(false);
      }
    }
    void refresh(true);
    const timer = window.setInterval(() => void refresh(), 10000);
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [bookingId, kind, user, refreshKey]);

  const inspectionDetail = handoff?.[kind] ?? null;
  const inspection = inspectionDetail?.inspection ?? null;
  const photos = inspectionDetail?.photos ?? [];
  useEffect(() => {
    if (!inspection || draftDirty.current) return;
    const version = `${bookingId}:${kind}:${inspection.id}:${inspection.revision}:${inspection.submitted_at}`;
    if (inspectionVersion.current === version) return;
    inspectionVersion.current = version;
    draftBaseVersion.current = handoff?.workflow.version ?? null;
    setAppearance(inspection.appearance_condition);
    setDamage(inspection.existing_damage);
    setAccessories(inspection.included_accessories.join('\n'));
    setFunctional(inspection.functional_condition);
    setSerial(inspection.serial_number);
  }, [bookingId, kind, inspection, handoff?.workflow.version]);

  useEffect(() => {
    let active = true;
    if (!handoff || !handoff.workflow.allowed_actions.includes('view_code')) {
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
      setRefreshKey((key) => key + 1);
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveInspection(event?: FormEvent, publish = false) {
    event?.preventDefault();
    if (!handoff) return;
    if (publish && photos.length + photoFiles.length < 2) {
      setNotice(null);
      setError('Add at least two condition photos before publishing the inspection.');
      return;
    }
    await perform(publish ? 'publish-inspection' : 'save-inspection', async () => {
      const saved = await saveBookingInspectionDraft({
        bookingId,
        kind,
        version: draftDirty.current && draftBaseVersion.current !== null
          ? draftBaseVersion.current : handoff.workflow.version,
        appearanceCondition: appearance,
        existingDamage: damage,
        includedAccessories: accessories.split('\n').map((item) => item.trim()).filter(Boolean),
        functionalCondition: functional,
        serialNumber: serial,
      });
      if (!Number.isSafeInteger(saved.workflow_version)) {
        throw new Error('Draft saved, but its version was not returned. Refresh before publishing.');
      }
      draftDirty.current = false;
      draftBaseVersion.current = saved.workflow_version ?? null;
      const pendingPhotos = [...photoFiles];
      while (pendingPhotos.length) {
        const next = pendingPhotos[0];
        await uploadBookingInspectionPhoto(bookingId, kind, saved.id, next.file, next);
        pendingPhotos.shift();
        setPhotoFiles([...pendingPhotos]);
      }
      if (photoInput.current) photoInput.current.value = '';
      if (publish && saved.workflow_version !== undefined) {
        await publishBookingInspection(bookingId, kind, saved.workflow_version);
      }
      setNotice(publish
        ? 'Inspection published and your confirmation recorded. The renter can now review this revision.'
        : 'Draft saved privately. Publish it when the condition and photos are ready for review.');
    });
  }

  async function handleReview(decision: 'agree' | 'request_correction' | 'dispute') {
    if (!handoff || !inspection?.revision) return;
    const revision = inspection.revision;
    await perform('review', async () => {
      await reviewBookingInspection({
        bookingId, kind, revision, version: handoff.workflow.version,
        decision, reason: reviewReason,
      });
      setReviewDecision(null);
      setReviewReason('');
      setNotice(decision === 'agree' ? 'Your agreement to this inspection revision is recorded.'
        : decision === 'dispute' ? 'Condition dispute recorded. You can still verify physical return without accepting damage charges.'
          : 'Correction requested. The owner must publish a new revision for your review.');
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
      setNotice(kind === 'pickup' ? 'Pickup verified. The rental is now active.'
        : 'Physical return verified. Condition review and financial processing remain separate.');
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
      setNotice('Damage claim submitted for staff review. Receipt confirmation does not authorize a deduction.');
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

  const workflow = handoff.workflow;
  const can = (action: string) => !busy && !refreshError && workflow.allowed_actions.includes(action);
  const canPublishInspection = can('publish_inspection') || (!inspection && can('save_draft'));
  const done = kind === 'pickup' ? ['active', 'returned'].includes(workflow.stage) : workflow.physical_return_verified;
  const waitingForOtp = workflow.stage === 'verify';
  const otherInspection = kind === 'return' ? handoff.pickup : null;
  const acceptedTime = kind === 'pickup' ? handoff.actual_pickup_at : handoff.actual_return_at;
  const dueDate = dateLabel(handoff.end_date);
  const otpSeconds = otp ? Math.max(0, Math.ceil((new Date(otp.expires_at).getTime() - now) / 1000)) : 0;
  const ownerCanInspect = handoff.is_owner && workflow.allowed_actions.includes('save_draft');
  const canStart = workflow.allowed_actions.includes(kind === 'pickup' ? 'start_pickup' : 'start_return');
  const arrangement = workflow.stage === 'arrange' ? arrangementGuidance(booking, kind, workflow, schedule) : null;
  const blockerLabels: Record<string, string> = {
    payment_required: 'The rental payment must be confirmed before pickup.',
    approved_window_required: kind === 'pickup'
      ? 'Pickup opens 2 hours before the approved time and closes when its window ends. Check the schedule below.'
      : 'The return can only start during an approved handoff window. Check the schedule below.',
    deposit_hold_required: 'The renter’s temporary security hold must be ready before pickup.',
  };
  const draftConflict = draftDirty.current && draftBaseVersion.current !== null && draftBaseVersion.current !== workflow.version;
  const evidenceReady = photos.length >= 2 && photos.every(photo => photo.signedUrl && loadedPhotos.has(photo.signedUrl));
  const ownerName = handoff.is_owner ? 'You' : booking.counterpartName;
  const renterName = handoff.is_owner ? booking.counterpartName : 'You';
  const rentalStatus = workflow.physical_return_verified
    ? workflow.financially_closed ? 'Booking closed' : workflow.condition_status === 'disputed'
      ? 'Returned - condition under review' : 'Returned - financial processing'
    : booking.status === 'active' || booking.status === 'return_pending' ? 'Active rental'
      : done ? (kind === 'pickup' ? 'Active rental' : 'Returned')
        : 'Confirmed rental';

  return (
    <main className="animate-fade-in pb-20 md:pb-10">
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8">
        <PageBackButton fallback={{ name: 'dashboard', tab: handoff.is_owner ? 'lending' : 'renting' }}>
          Back to bookings
        </PageBackButton>
        <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-main font-display sm:text-3xl">{kind === 'pickup' ? 'Pickup' : 'Return'}</h1>
            <p className="mt-1 text-sm text-sec">
              You’re {handoff.is_owner ? 'lending' : 'renting'} · Confirm the item condition together.
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

        <WorkflowProgress workflow={workflow} />
        {!done && <Surface role="region" aria-label="What happens next" aria-live="polite" className="mb-5 p-4 sm:p-5">
          <h2 className="font-semibold text-main">{workflow.action === 'renew_deposit'
            ? handoff.is_owner ? 'Waiting for renter to restore deposit protection' : 'Renew your security deposit authorization'
            : arrangement ? arrangement.title
              : workflow.stage === 'inspection' ? handoff.is_owner ? 'Record the item condition' : 'Waiting for owner inspection'
                : workflow.stage === 'review' ? handoff.is_owner ? 'Waiting for renter review' : 'Review the published inspection'
                  : workflow.stage === 'verify' ? handoff.is_owner ? 'Verify the exchange' : 'Share your exchange code'
                    : 'Exchange status'}</h2>
          <p className="mt-1 text-sm text-sec">{workflow.action === 'renew_deposit'
            ? 'The renter needs to renew the temporary security hold below. Your inspection evidence and approvals are preserved; do not repeat rental payment.'
            : arrangement ? arrangement.description
            : workflow.stage === 'inspection' ? handoff.is_owner
              ? `Record the condition and at least two photos below. Publish the inspection for ${booking.counterpartName} to review.`
              : `${booking.counterpartName} is recording the condition. The published notes and photos will appear here automatically.`
              : workflow.stage === 'review' ? handoff.is_owner
                ? `${booking.counterpartName} needs to review the published photos and condition. No action is needed from you yet.`
                : 'Review the photos and notes below. Agree only if they are accurate, or request a correction.'
                : kind === 'return' ? 'The renter shares the code when ready; the owner enters it below to confirm physical receipt only, not condition agreement or deductions.'
                  : handoff.is_owner ? 'Ask the renter for their six-digit code when you are both ready. Enter it below to verify pickup and start the rental.'
                    : 'Show your six-digit code below to the owner only when you are ready to receive the item. The owner enters it to start the rental.'}</p>
          {kind === 'pickup' && <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-sec">
            <span>Rental payment: {workflow.payment_ready ? 'confirmed' : 'not confirmed'}</span>
            <span>Security hold: {booking.deposit <= 0 ? 'not required' : workflow.deposit_ready ? 'ready' : 'needs attention'}</span>
          </p>}
          {workflow.blockers.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-sec">
            {workflow.blockers.map(blocker => <li key={blocker}>{blockerLabels[blocker]
              ?? 'A handoff requirement needs review. Refresh this booking or contact support.'}</li>)}
          </ul>}
        </Surface>}

        {!done && workflow.stage === 'arrange' && <BookingPrecheckin booking={booking} kind={kind}
          onReady={setPrecheckinReady} onStateChange={setSchedule} onChanged={() => setRefreshKey(key => key + 1)} />}
        {!done && workflow.stage !== 'arrange' && <details className="mb-4 rounded-card border border-app p-4">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-main">Agreed schedule</summary>
          <BookingPrecheckin booking={booking} kind={kind} exchangeStarted onReady={setPrecheckinReady} />
        </details>}
        {((kind === 'pickup' && (booking.deliveryTrip === 'dropoff' || booking.deliveryTrip === 'both'))
          || (kind === 'return' && (booking.deliveryTrip === 'return' || booking.deliveryTrip === 'both')))
          ? <div className="mb-4"><BookingDeliveryAddress bookingId={bookingId} /></div>
          : kind === 'pickup' && <div className="mb-4"><BookingPickup key={String(precheckinReady)} bookingId={bookingId} status={booking.status} paymentFirst={booking.paymentFirst} /></div>}
        {booking.deposit > 0 && !done && <div className="mb-4"><DepositAuthorizationStatus bookingId={bookingId} deposit={booking.deposit}
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
                {kind === 'return' && <p className="mt-2 text-sm text-sec">{workflow.condition_status === 'disputed'
                  ? 'Item returned - condition under review. Receipt verification does not accept a damage claim or authorize a deduction.'
                  : 'Physical return verified. Security deposit and owner payout processing are separate from receipt.'}</p>}
              </div>
            </div>
            {kind === 'return' && <div className="mt-5"><RentalSettlement bookingId={bookingId} isOwner={booking.isOwner} /></div>}
            {kind === 'pickup' && <Button className="mt-5 mr-3" onClick={() => navigate({ name: 'check-out', id: bookingId })}>View return details</Button>}
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
            <div className={`mb-5 grid items-start gap-5 ${waitingForOtp ? 'lg:grid-cols-2' : ''}`}>
            {(workflow.stage !== 'arrange' || canStart || inspection) && <Surface className="p-4 sm:p-6">
              <SectionHeader as="h2" title={kind === 'pickup' ? 'Pickup handoff' : 'Return handoff'} subtitle={
                kind === 'pickup'
                  ? 'The owner records the item condition and photos. Review the evidence before acknowledging.'
                  : 'Compare the item with its pickup record, verify accessories, and record its current condition.'
              } className="mb-4" />

              {workflow.allowed_actions.includes(kind === 'pickup' ? 'start_pickup' : 'start_return') && (
                <Button disabled={!can(kind === 'pickup' ? 'start_pickup' : 'start_return')}
                  loading={busy === 'begin'} onClick={() => void perform('begin', async () => {
                    await beginBookingHandoff(bookingId, kind, workflow.version);
                    setNotice(kind === 'pickup' ? 'Pickup started. Record the condition together.' : 'Return started. The owner can record the received condition.');
                  })}>{kind === 'pickup' ? 'Begin pickup' : handoff.is_owner ? 'Begin return inspection' : 'Begin return'}</Button>
              )}
              {!handoff.is_owner && !inspection && <p className="text-sm text-sec">
                The owner records the condition. The published inspection and photos will appear here automatically for your review.
              </p>}
              {inspectionDetail?.review_reason && <Alert className="mt-3" tone="warning"
                title={workflow.condition_status === 'disputed' ? 'Return condition disputed' : 'Correction requested'}>
                {inspectionDetail.review_reason}
              </Alert>}

              {otherInspection && (
                <div className="mb-6 rounded-card-lg bg-subtle p-4">
                  <InspectionRecord inspection={otherInspection.inspection} photos={otherInspection.photos} title="Pickup condition reference" />
                </div>
              )}

              {ownerCanInspect && (
                <form onSubmit={(event) => void handleSaveInspection(event, true)}
                  onChange={() => { if (!draftDirty.current) draftBaseVersion.current = workflow.version; draftDirty.current = true; }}
                  className="mt-5 space-y-4">
                  {draftConflict && <Alert tone="warning" title="Newer handoff version available">
                    Your unsaved entries are preserved. Review the latest record below before keeping your edits for this version.
                    <Button type="button" className="mt-3" variant="secondary" disabled={!can('save_draft')}
                      onClick={() => {
                        draftBaseVersion.current = workflow.version;
                        setNotice('Your edits are retained for the latest version. Save or publish when ready.');
                      }}>Keep my edits for this version</Button>
                  </Alert>}
                  <fieldset disabled={Boolean(busy)} className="space-y-4">
                  <label className="block text-sm font-semibold text-main">
                    Item appearance and condition
                    <textarea required minLength={10} maxLength={2000} rows={3} value={appearance} onChange={(event) => setAppearance(event.target.value)}
                      className="mt-1.5 w-full rounded-card border border-app bg-card px-3 py-2.5 text-sm font-normal text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" />
                  </label>
                  <div className="flex flex-wrap gap-2" aria-label="Appearance shortcuts">
                    {['Good condition', 'Fair condition with normal wear', 'Worn condition; see damage notes'].map(value => <Button
                      key={value} type="button" size="sm" variant="secondary" onClick={() => {
                        draftBaseVersion.current ??= workflow.version; draftDirty.current = true; setAppearance(value);
                      }}>{value}</Button>)}
                  </div>
                  <label className="block text-sm font-semibold text-main">
                    Existing scratches or damage
                    <textarea required minLength={1} maxLength={2000} rows={3} value={damage} onChange={(event) => setDamage(event.target.value)}
                      className="mt-1.5 w-full rounded-card border border-app bg-card px-3 py-2.5 text-sm font-normal text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" />
                    <span className="mt-1 block text-xs font-normal text-sec">Describe existing wear clearly; enter “None observed” when applicable.</span>
                  </label>
                  <Button type="button" size="sm" variant="ghost" onClick={() => {
                    draftBaseVersion.current ??= workflow.version; draftDirty.current = true; setDamage('None observed');
                  }}>No damage observed</Button>
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
                      disabled={Boolean(busy)}
                      onChange={(event) => {
                        const selected = Array.from(event.target.files ?? []);
                        if (selected.length + photoFiles.length + photos.length > 12) {
                          setError('An inspection can have at most 12 photos. Your existing selections have been kept.');
                          return;
                        }
                        setPhotoFiles(current => [...current, ...selected.map(file => ({ file, objectPath: null, uploaded: false }))]);
                      }}
                      className="mt-1.5 block w-full text-sm font-normal text-sec file:mr-3 file:rounded-card file:border file:border-app file:bg-subtle file:px-3 file:py-2 file:text-sm file:font-semibold file:text-main" />
                    <span className="mt-1 block text-xs font-normal text-sec">Stored privately and shared only with booking participants.</span>
                  </label>
                  {photoFiles.length > 0 && <p className="text-xs text-sec">{photoFiles.length} photo{photoFiles.length === 1 ? '' : 's'} selected</p>}
                  {photoFiles.length > 0 && <ul className="space-y-1 text-xs text-sec">
                    {photoFiles.map((photo, index) => <li key={`${photo.file.name}:${index}`} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 break-all">{photo.file.name}{photo.uploaded ? ' - uploaded, awaiting registration' : ''}</span>
                      <Button type="button" size="sm" variant="ghost" disabled={Boolean(busy) || photo.uploaded || Boolean(photo.objectPath)}
                        onClick={() => setPhotoFiles(current => current.filter((_, position) => position !== index))}>Remove</Button>
                    </li>)}
                  </ul>}
                  <p className="text-xs text-sec">Publishing shares a permanent record with the renter. Drafts stay private.</p>
                  <div className="flex flex-wrap gap-3">
                    <Button type="submit" disabled={!canPublishInspection || draftConflict} loading={busy === 'publish-inspection'}>Publish &amp; confirm</Button>
                    <Button type="button" variant="secondary" disabled={!can('save_draft') || draftConflict} loading={busy === 'save-inspection'}
                      onClick={() => void handleSaveInspection()}>Save draft</Button>
                  </div>
                  </fieldset>
                </form>
              )}

              {inspection && (
                <div className="mt-5 space-y-4">
                  <InspectionRecord inspection={inspection} photos={photos} title={kind === 'pickup' ? 'Pickup inspection record' : 'Return inspection record'}
                    onPhotoStatus={(url, loaded) => setLoadedPhotos(current => {
                      if (current.has(url) === loaded) return current;
                      const next = new Set(current);
                      if (loaded) next.add(url); else next.delete(url);
                      return next;
                    })} />
                  <div className="flex flex-wrap gap-2 text-xs text-sec">
                    <Badge tone="neutral">Revision {inspection.revision}</Badge>
                    <Badge tone={inspection.publication_status === 'published' ? 'success' : 'neutral'}>{inspection.publication_status === 'published' ? 'Published' : 'Private draft'}</Badge>
                    <Badge tone={workflow.condition_status === 'agreed' ? 'success' : 'neutral'}>Condition: {workflow.condition_status.replace(/_/g, ' ')}</Badge>
                  </div>
                  {!handoff.is_owner && workflow.allowed_actions.includes('agree_inspection') && <div className="space-y-3">
                    <p className="text-sm text-sec">{kind === 'return'
                      ? 'Review the condition separately from receipt. Sharing a return code does not authorize a damage deduction.'
                      : 'Review the condition and photos before agreeing to this revision.'}</p>
                    {!evidenceReady && <Alert tone="warning">All required evidence must be available before agreeing.
                      <Button variant="secondary" size="sm" onClick={() => setRefreshKey(key => key + 1)}>Reload evidence</Button>
                    </Alert>}
                    <div className="flex flex-wrap gap-2">
                      <Button disabled={!can('agree_inspection') || !evidenceReady} onClick={() => void handleReview('agree')}>Agree to condition</Button>
                      <Button variant="secondary" disabled={!can('request_correction')}
                        onClick={() => setReviewDecision('request_correction')}>Request correction</Button>
                      {kind === 'return' && <Button variant="secondary" disabled={!can('dispute_condition')}
                        onClick={() => setReviewDecision('dispute')}>Dispute condition</Button>}
                    </div>
                  </div>}
                  {reviewDecision && <form className="space-y-3" onSubmit={event => {
                    event.preventDefault(); void handleReview(reviewDecision);
                  }}>
                    <label className="block text-sm font-semibold text-main">{reviewDecision === 'dispute' ? 'Dispute reason' : 'Correction details'}
                      <textarea required minLength={10} maxLength={2000} rows={3} value={reviewReason}
                        onChange={event => setReviewReason(event.target.value)}
                        className="mt-2 w-full rounded-card border border-app bg-card px-3 py-2 font-normal text-main" />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" loading={busy === 'review'} disabled={Boolean(busy)}>Send {reviewDecision === 'dispute' ? 'dispute' : 'correction request'}</Button>
                      <Button type="button" variant="ghost" disabled={Boolean(busy)} onClick={() => setReviewDecision(null)}>Cancel</Button>
                    </div>
                  </form>}
                  {inspectionDetail?.history && inspectionDetail.history.length > 0 && <details>
                    <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-main">Published inspection history</summary>
                    <div className="space-y-6">{inspectionDetail.history.map(revision => <InspectionRecord
                      key={`${revision.inspection.id}:${revision.inspection.revision}`} inspection={revision.inspection}
                      photos={revision.photos} title={`Published revision ${revision.inspection.revision}`} />)}</div>
                  </details>}
                </div>
              )}
            </Surface>}

            {waitingForOtp && <Surface className="p-4 sm:p-6">
                <SectionHeader as="h2" title={kind === 'pickup' ? 'Pickup verification' : 'Return verification'}
                  subtitle={kind === 'return'
                    ? 'This code verifies physical receipt only. It does not accept a condition dispute or authorize a deduction.'
                    : 'Both participants approved this inspection revision. Share the code when ready to exchange the item.'}
                  className="mb-4" />
                {!handoff.is_owner ? (
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
                        <p className="text-sm text-sec">{otpLoadError ?? (otp ? 'Your code has expired. Request a new code to continue.' : 'Loading your code…')}</p>
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
                    <Button type="submit" disabled={otpCode.length !== 6 || !can('verify_code')} loading={busy === 'verify-otp'}>Verify and {kind === 'pickup' ? 'start rental' : 'confirm receipt'}</Button>
                  </form>
                )}
            </Surface>}
            </div>

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
            {kind === 'return' && handoff.is_owner && workflow.allowed_actions.includes('report_receipt') && (
              <details className="mb-5 rounded-card border border-app p-4">
                <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-main">Received the item but cannot verify the code?</summary>
                <p className="mt-2 text-sm text-sec">Report receipt for support to verify. This doesn't complete the return or authorize settlement.</p>
                <form className="mt-3 space-y-3" onSubmit={event => {
                  event.preventDefault();
                  void perform('report-receipt', async () => {
                    await reportBookingReturnReceipt(bookingId, workflow.version, receiptReason);
                    setReceiptReason('');
                    setNotice('Receipt reported to support. The return remains unverified until authorized verification.');
                  });
                }}>
                  <label className="block text-sm font-semibold text-main">Receipt statement
                    <textarea required minLength={10} maxLength={2000} rows={3} value={receiptReason}
                      onChange={event => setReceiptReason(event.target.value)}
                      className="mt-2 w-full rounded-card border border-app bg-card px-3 py-2 font-normal text-main" />
                  </label>
                  <Button type="submit" variant="secondary" disabled={!can('report_receipt')} loading={busy === 'report-receipt'}>Ask support to verify receipt</Button>
                </form>
              </details>
            )}
          </>
        )}

        {error && <Alert tone="error" title="Action not completed" className="mb-4">{error}</Alert>}
        {refreshError && <Alert tone="error" title="Handoff updates interrupted" className="mb-4">
          {refreshError} The details above may be out of date.
          <Button className="mt-2" size="sm" variant="secondary" onClick={() => setRefreshKey((key) => key + 1)}>Refresh handoff</Button>
        </Alert>}
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
            <p className="mt-2 text-sm text-sec">Report an issue if someone is unavailable, an inspection is disputed, or you need help with an early or late return. Pickup or return still requires verification.</p>
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
            <p className="mt-2 text-sm text-sec">Describe any new damage, missing accessories or functional issues and attach evidence. Staff must review the claim; a disputed deposit is not captured automatically.</p>
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
          <details className="mt-6">
            <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-main">Handoff history</summary>
            <ul className="space-y-2">
              {handoff.events.slice().reverse().map((event) => (
                <li key={event.id} className="flex items-center gap-2 text-xs text-sec">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                  <span className="flex-1">{event.event_type.replace(/_/g, ' ')}</span>
                  <time dateTime={event.created_at}>{dateTimeLabel(event.created_at)}</time>
                </li>
              ))}
            </ul>
          </details>
        )}

        <div className="sr-only" aria-live="polite">{busy ? 'Saving changes' : ''}</div>
      </div>
    </main>
  );
}
