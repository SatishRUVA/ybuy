import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Clock3, Gavel, Plus, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import type { Category } from '@/data';
import { fetchCategories, toUiCategory, createDraftListing, deleteOwnerListing, uploadListingPhoto, removeListingImageUrl, saveListingImageOrder, fetchListingById, fetchOwnerPickup } from '@/lib/listings';
import { getListingFlowPolicy, saveListingFlow, type ListingFlowPolicy, type ListingFlowDetails } from '@/lib/listing-flow';
import { moderateListingContent, type ListingFlag, type ListingPhotoDecision } from '@/lib/listing-ai';
import { MAX_LISTING_PHOTO_BYTES, prepareListingPhoto } from '@/lib/listing-photo';
import { LISTING_RULES, LISTING_FIELD_IDS, ITEM_STEP_FIELDS, parseMoney, validateListing, type ListingField } from '@/lib/listing-rules';
import { todayIso, addDaysIso } from '@/lib/geo';
import { pickupTimeZone, pickupToday } from '@/lib/pickup-timezone';
import { formatPickupAddress } from '@/lib/pickup-location';
import { HANDOFF_WINDOW_LABELS } from '@/lib/handoff-hours';
import {
  ListingAction as Button,
  ListingAiSkeleton,
  ListingField as Field,
  ListingNotice as Alert,
  ListingSkeleton as Skeleton,
} from '@/main-site/components/listing-ui';
import { listingInputClass as fieldClass, listingTextareaClass as textareaClass } from '@/main-site/components/listing-ui-classes';
import { PickupLocation, type PickupLocationValue } from '@/main-site/components/pickup-location';
import { ListingPhotoEditor } from '@/main-site/components/listing-photo-editor';
import { ListingNegotiationSettings } from '@/main-site/components/listing-negotiation-settings';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from '@/main-site/components/shadcn/alert-dialog';
import { auctionPublicationMessage, type ListingAuction } from '@/lib/listing-auctions';
import { ListingAvailabilityPicker } from '@/main-site/components/listing-availability-picker';
import { LISTING_DEFAULT_AVAILABLE_DAYS, listingAvailabilityError } from '@/lib/listing-availability';
import {
  EMPTY_ITEM_DETAILS,
  HANDOFF_WINDOWS,
  RETURN_RULE_OPTIONS,
  listingItemDetailsError,
  type HandoffWindow,
  type ListingItemDetails,
} from '@/lib/listing-item-details';
import { useFeatureFlag } from '@/lib/use-feature-flags';
import { fetchOwnerEarningsQuote, type ListingPriceQuote } from '@/lib/listing-pricing';
import { fetchMainItemRequest, type MainItemRequest } from '../request-flow';
import { RequestFulfillment } from '../components/request-fulfillment';
import { maskListingContact } from '../../../supabase/functions/_shared/listing-contact';
import './create-listing.css';

const STEPS = ['Photos', 'Details', 'Pricing', 'Availability', 'Pickup', 'Review'] as const;
const STEP_TITLES = ['Show it off', 'Tell people about it', 'Set your price', 'Availability', 'Where and when to meet', 'Looks good?'];
const BLOCKING_FLAG_TYPES = new Set<ListingFlag['type']>(['prohibited_item', 'drug_related', 'profanity', 'content_violation']);
const skipLocalPhotoReview = import.meta.env.DEV
  && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
  && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(import.meta.env.VITE_SUPABASE_URL).hostname);
const EMPTY_PICKUP: PickupLocationValue = { formattedAddress: '', streetAddress: '', city: '', state: '', postalCode: '', country: '', latitude: null, longitude: null, placeId: '' };
const CONDITION_LABELS: Record<string, string> = { new: 'New', like_new: 'Like new', good: 'Good', fair: 'Fair' };
const formatListingDate = (date: string) => date ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Choose date';
type Form = {
  title: string; categoryId: string; description: string; value: string; condition: string; price: string;
  weeklyRate: string; monthlyRate: string;
  weeklyPricing: 'daily' | 'discount' | 'fixed'; monthlyPricing: 'daily' | 'discount' | 'fixed';
  weeklyDiscountEnabled: boolean; weeklyDiscount: string; monthlyDiscountEnabled: boolean; monthlyDiscount: string;
  instant: boolean; delivery: boolean; deliveryFee: string; quantity: number; start: string; end: string;
  itemDetails: ListingItemDetails;
};
const EMPTY_FORM: Form = { title: '', categoryId: '', description: '', value: '', condition: '', price: '', weeklyRate: '', monthlyRate: '', weeklyPricing: 'discount', monthlyPricing: 'discount', weeklyDiscountEnabled: true, weeklyDiscount: '20', monthlyDiscountEnabled: true, monthlyDiscount: '30', instant: false, delivery: false, deliveryFee: '', quantity: 1, start: '', end: '', itemDetails: EMPTY_ITEM_DETAILS };
type FlowErrors = Partial<Record<ListingField | 'availability' | 'delivery' | 'quantity' | 'item-details' | 'handoff-details' | 'weekly-discount' | 'monthly-discount' | 'weekly-rate' | 'monthly-rate', string>>;
const fieldStep = (field: keyof FlowErrors) => field === 'photos' ? 1
  : field === 'item-details' || (ITEM_STEP_FIELDS.includes(field as ListingField) && field !== 'value') ? 2
    : field === 'availability' ? 4 : ['pickup', 'delivery', 'handoff-details'].includes(field) ? 5 : 3;
const fieldId = (field: keyof FlowErrors) => field in LISTING_FIELD_IDS ? LISTING_FIELD_IDS[field as ListingField] : `listing-${field}`;
function focusListingControl(target: HTMLElement | null) {
  if (!target) return;
  const control = target.matches('input, select, textarea, button') ? target
    : target.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)') ?? target;
  control.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'center', behavior: 'instant' });
}
const message = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
const listingText = (form: Form) => [form.description, form.itemDetails.brand, form.itemDetails.model,
  ...form.itemDetails.included_items, form.itemDetails.additional_details].filter(Boolean).join('\n\n');
const textKey = (form: Form) => JSON.stringify([form.title, listingText(form)]);

export function CreateListingPage({ editId, requestId }: { editId?: string; requestId?: string }) {
  const { navigate } = useRouter();
  const { profile } = useAuth();
  const durationDiscountFlag = useFeatureFlag('duration_discounts');
  const biddingFlag = useFeatureFlag('bidding');
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const priceForPreview = parseMoney(form.price) ?? 0;
  const [earningsQuotes, setEarningsQuotes] = useState<Record<number, ListingPriceQuote> | null>(null);
  const [earningsQuoteError, setEarningsQuoteError] = useState<string | null>(null);
  const formRef = useRef(form);
  formRef.current = form;
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoFiles, setPhotoFiles] = useState<(File | null)[]>([]);
  const localPhotoUrls = useRef(new Set<string>());
  const [pickup, setPickup] = useState(EMPTY_PICKUP);
  const [pickupConfirmed, setPickupConfirmed] = useState(false);
  const [policy, setPolicy] = useState<ListingFlowPolicy | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [sourceRequest, setSourceRequest] = useState<MainItemRequest | null>(null);
  const [sourceRequestError, setSourceRequestError] = useState<string | null>(null);
  const [listingId, setListingId] = useState<string | null>(null);
  const idRef = useRef<string | null>(null);
  const revision = useRef<number>(1);
  const draftCreation = useRef<Promise<string> | null>(null);
  const [status, setStatus] = useState('draft');
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [furthestStep, setFurthestStep] = useState(1);
  const [attempted, setAttempted] = useState(false);
  const [working, setWorking] = useState(false);
  const operation = useRef(false);
  const saveInFlight = useRef<Promise<boolean> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [discardError, setDiscardError] = useState<string | null>(null);
  const [confirmedAuction, setConfirmedAuction] = useState<(ListingAuction & { starts_at: string; ends_at: string }) | null>(null);
  const auctionTicket = useRef<HTMLElement>(null);
  const [version, setVersion] = useState(0);
  const versionRef = useRef(0);
  const [savedVersion, setSavedVersion] = useState(0);
  const savedVersionRef = useRef(0);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiApplied, setAiApplied] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const aiRun = useRef(0);
  const editedFields = useRef({ title: false, description: false, categoryId: false, brand: false, model: false });
  const [flags, setFlags] = useState<ListingFlag[]>([]);
  const [photoDecisions, setPhotoDecisions] = useState<Record<string, ListingPhotoDecision>>({});
  const [photoFocusIndex, setPhotoFocusIndex] = useState<number | null>(null);
  const photoChangesPending = useRef(false);
  const hasPhotoReview = useRef(false);
  const reviewedText = useRef('');
  const [warnings, setWarnings] = useState<Record<string, string>>({});
  const [qualitySuggestions, setQualitySuggestions] = useState<Record<string, string>>({});
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number; text: string } | null>(null);
  const [preparingDetails, setPreparingDetails] = useState(false);
  const [failedUploads, setFailedUploads] = useState<{ file: File; replaceUrl?: string; replaceIndex?: number; error: string }[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null);
  const [includedItem, setIncludedItem] = useState('');
  const [includedError, setIncludedError] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const originalWindow = useRef<{ start: string; end: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const summary = useRef<HTMLDivElement>(null);
  const initialStepReady = useRef(false);

  useEffect(() => {
    if (!completed) return;
    window.scrollTo({ top: 0, behavior: 'instant' });
    heading.current?.focus({ preventScroll: true });
  }, [completed]);

  function changed() {
    versionRef.current += 1;
    setVersion(versionRef.current);
    setNotice(null);
  }
  function update<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    changed();
  }
  function updateLongerPricing(period: 'weekly' | 'monthly', pricing: Form['weeklyPricing']) {
    setForm(current => period === 'weekly'
      ? { ...current, weeklyPricing: pricing, weeklyDiscountEnabled: pricing === 'discount' ? true : pricing === 'daily' ? false : current.weeklyDiscountEnabled,
        weeklyDiscount: pricing === 'discount' && !current.weeklyDiscountEnabled && Number(current.weeklyDiscount) <= 0 ? '20' : current.weeklyDiscount }
      : { ...current, monthlyPricing: pricing, monthlyDiscountEnabled: pricing === 'discount' ? true : pricing === 'daily' ? false : current.monthlyDiscountEnabled,
        monthlyDiscount: pricing === 'discount' && !current.monthlyDiscountEnabled && Number(current.monthlyDiscount) <= 0 ? '30' : current.monthlyDiscount });
    changed();
  }
  function updateItemDetails<K extends keyof ListingItemDetails>(key: K, value: ListingItemDetails[K]) {
    if (key === 'brand') editedFields.current.brand = true;
    if (key === 'model') editedFields.current.model = true;
    update('itemDetails', { ...form.itemDetails, [key]: value });
  }
  function addIncludedItem() {
    const item = includedItem.trim();
    const next = { ...form.itemDetails, included_items: [...form.itemDetails.included_items, item] };
    const error = listingItemDetailsError(next);
    if (error) { setIncludedError(error); return; }
    update('itemDetails', next);
    setIncludedItem(''); setIncludedError(null);
  }
  function toggleWindow(kind: 'pickup_windows' | 'return_windows', window: HandoffWindow) {
    const current = form.itemDetails[kind];
    const next = current.includes(window) ? current.filter((value) => value !== window) : [...current, window];
    updateItemDetails(kind, next.length > 0 ? next : current);
  }
  function toggleReturnRule(rule: string) {
    const current = form.itemDetails.return_rules;
    updateItemDetails('return_rules', current.includes(rule) ? current.filter((value) => value !== rule) : [...current, rule]);
  }

  useEffect(() => {
    if (!profile) return;
    let active = true;
    void (async () => {
      try {
        const [nextPolicy, rows] = await Promise.all([getListingFlowPolicy(), fetchCategories()]);
        const resumeId = editId;
        let contextId = requestId;
        if (!contextId && resumeId) {
          try { contextId = localStorage.getItem(`ybuy-listing-request:${profile.id}:${resumeId}`) ?? undefined; }
          catch (error) { console.warn('Could not restore the listing request context.', error); }
        }
        let request: MainItemRequest | null = null;
        try {
          request = contextId ? await fetchMainItemRequest(contextId) : null;
          if (request && (request.renter_id === profile.id || !['open', 'responses_received', 'negotiating'].includes(request.status)
            || Date.parse(request.expires_at) <= Date.now())) throw new Error('Choose another renter’s active request before listing an item for it.');
        } catch (reason) {
          if (requestId) throw reason;
          request = null;
          if (active) setSourceRequestError(message(reason, 'The saved renter request is no longer available. You can still edit your listing.'));
        }
        const row = resumeId ? await fetchListingById(resumeId) : null;
        if (resumeId && (!row || row.owner_id !== profile.id)) throw new Error('Listing not found or not owned by your account.');
        const ownRow = row?.owner_id === profile.id && (editId || row.status === 'draft') ? row : null;
        const savedPickup = ownRow ? await fetchOwnerPickup(ownRow.id) : null;
        if (!active) return;
        setPolicy(nextPolicy);
        setCategories(rows.map((category) => toUiCategory(category, new Map())));
        setSourceRequest(request);
        if (ownRow) {
          if (!Number.isSafeInteger(ownRow.revision)) throw new Error('Listing editing is unavailable right now. Please try again later.');
          revision.current = ownRow.revision!;
          idRef.current = ownRow.id;
          setListingId(ownRow.id);
          if (request) {
            try { localStorage.setItem(`ybuy-listing-request:${profile.id}:${ownRow.id}`, request.id); }
            catch (error) { console.warn('Could not remember the listing request context.', error); }
          }
          setStatus(ownRow.status);
          originalWindow.current = ownRow.availability_start && ownRow.availability_end
            ? { start: ownRow.availability_start, end: ownRow.availability_end } : null;
          setForm({
            title: ownRow.title, description: ownRow.description ?? '', categoryId: ownRow.category_id,
            value: ownRow.estimated_value == null ? '' : String(ownRow.estimated_value), condition: ownRow.item_condition ?? '',
            price: String(ownRow.price_per_day), weeklyRate: ownRow.price_per_week == null ? '' : String(ownRow.price_per_week),
            monthlyRate: ownRow.price_per_month == null ? '' : String(ownRow.price_per_month),
            weeklyPricing: ownRow.price_per_week != null ? 'fixed' : ownRow.weekly_discount_enabled ? 'discount' : 'daily',
            monthlyPricing: ownRow.price_per_month != null ? 'fixed' : ownRow.monthly_discount_enabled ? 'discount' : 'daily',
            weeklyDiscountEnabled: ownRow.weekly_discount_enabled === true, weeklyDiscount: String(ownRow.weekly_discount_percent ?? 20), monthlyDiscountEnabled: ownRow.monthly_discount_enabled === true, monthlyDiscount: String(ownRow.monthly_discount_percent ?? 30), instant: ownRow.instant_booking, delivery: ownRow.delivery_available,
            deliveryFee: String(ownRow.delivery_fee ?? 0), quantity: ownRow.available_quantity,
            start: ownRow.availability_start ?? todayIso(), end: ownRow.availability_end ?? addDaysIso(ownRow.availability_start ?? todayIso(), Math.min(LISTING_DEFAULT_AVAILABLE_DAYS, nextPolicy.listing_duration_days)),
            itemDetails: { brand: ownRow.brand ?? '', model: ownRow.model ?? '', included_items: ownRow.included_items ?? [],
              additional_details: ownRow.additional_details ?? '', delivery_radius_miles: ownRow.delivery_radius_miles ?? null,
              pickup_windows: ownRow.pickup_windows && ownRow.pickup_windows.length > 0 ? ownRow.pickup_windows : [...HANDOFF_WINDOWS],
              return_windows: ownRow.return_windows && ownRow.return_windows.length > 0 ? ownRow.return_windows : [...HANDOFF_WINDOWS],
              return_rules: ownRow.return_rules ?? [],
              return_note: ownRow.return_note ?? '' },
          });
          setPhotos([...ownRow.listing_images].sort((a, b) => a.sort_order - b.sort_order).map((image) => image.url));
          setPhotoFiles(ownRow.listing_images.map(() => null));
          const hasSavedDetails = Boolean(ownRow.title.trim() || ownRow.description?.trim());
          editedFields.current = {
            title: Boolean(ownRow.title.trim()),
            description: Boolean(ownRow.description?.trim()),
            // Empty photo-only drafts use the first category only to satisfy the draft insert.
            categoryId: ownRow.status !== 'draft' || hasSavedDetails,
            brand: Boolean(ownRow.brand?.trim()),
            model: Boolean(ownRow.model?.trim()),
          };
          if (savedPickup) {
            const restoredTimeZone = savedPickup.timeZone
              ?? (savedPickup.latitude !== null && savedPickup.longitude !== null
                ? pickupTimeZone(savedPickup.latitude, savedPickup.longitude) : undefined);
            const restoredPickup = {
              ...savedPickup, timeZone: restoredTimeZone,
              manualConfirmed: savedPickup.latitude === null && Boolean(restoredTimeZone),
            };
            setPickup(restoredPickup);
            setPickupConfirmed(Boolean(restoredPickup.formattedAddress && restoredPickup.streetAddress && restoredPickup.city
              && restoredPickup.state && restoredPickup.postalCode && restoredPickup.country && restoredPickup.timeZone));
          }
          setNotice(ownRow.status === 'draft' ? 'Your saved draft is ready to continue.' : 'Photo edits save immediately. Other changes save when you choose Save changes.');
          if (editId) setStep(2);
        } else {
          setForm({ ...EMPTY_FORM, start: todayIso(), end: addDaysIso(todayIso(), Math.min(LISTING_DEFAULT_AVAILABLE_DAYS, nextPolicy.listing_duration_days)),
            ...(request ? { title: request.title, categoryId: request.category_id, description: request.description,
              start: request.preferred_start_date, end: request.preferred_end_date, quantity: request.requested_quantity,
              price: request.max_daily_budget == null ? '' : String(request.max_daily_budget) } : {}) });
          if (request) editedFields.current = { ...editedFields.current, title: true, description: true, categoryId: true };
        }
        setReady(true);
      } catch (error) {
        if (active) setLoadError(message(error, 'Could not load the listing form.'));
      }
    })();
    return () => { active = false; aiRun.current += 1; };
  }, [editId, requestId, profile]);

  useEffect(() => {
    const dailyRate = parseMoney(form.price);
    const weeklyRate = form.weeklyPricing === 'fixed' && form.weeklyRate.trim() ? parseMoney(form.weeklyRate) : null;
    const monthlyRate = form.monthlyPricing === 'fixed' && form.monthlyRate.trim() ? parseMoney(form.monthlyRate) : null;
    const weeklyDiscount = Number(form.weeklyDiscount || 0);
    const monthlyDiscount = Number(form.monthlyDiscount || 0);
    setEarningsQuotes(null);
    setEarningsQuoteError(null);
    if (!listingId || dailyRate === null || dailyRate < LISTING_RULES.price.min || dailyRate > LISTING_RULES.price.max
      || (form.weeklyPricing === 'fixed' && (weeklyRate === null || weeklyRate < LISTING_RULES.price.min || weeklyRate > LISTING_RULES.price.max))
      || (form.monthlyPricing === 'fixed' && (monthlyRate === null || monthlyRate < LISTING_RULES.price.min || monthlyRate > LISTING_RULES.price.max))
      || !Number.isFinite(weeklyDiscount) || weeklyDiscount < 0 || weeklyDiscount > 50
      || !Number.isFinite(monthlyDiscount) || monthlyDiscount < 0 || monthlyDiscount > 50) return;
    let active = true;
    const timer = window.setTimeout(() => {
      Promise.all([1, 7, 30].map(days => fetchOwnerEarningsQuote({
        listingId, dailyRate, weeklyRate, monthlyRate,
        weeklyDiscountEnabled: form.weeklyPricing !== 'daily' && form.weeklyDiscountEnabled && durationDiscountFlag.enabled,
        weeklyDiscountPercent: weeklyDiscount,
        monthlyDiscountEnabled: form.monthlyPricing !== 'daily' && form.monthlyDiscountEnabled && durationDiscountFlag.enabled,
        monthlyDiscountPercent: monthlyDiscount,
        days,
      }))).then(quotes => {
        if (active) setEarningsQuotes(Object.fromEntries(quotes.map(quote => [quote.days, quote])));
      }).catch(error => {
        if (active) setEarningsQuoteError(message(error, 'Could not load an earnings estimate.'));
      });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [listingId, form.price, form.weeklyRate, form.monthlyRate, form.weeklyPricing, form.monthlyPricing, form.weeklyDiscountEnabled,
    form.weeklyDiscount, form.monthlyDiscountEnabled, form.monthlyDiscount, durationDiscountFlag.enabled]);

  useEffect(() => {
    if (!ready || completed) return;
    setFurthestStep((current) => Math.max(current, step));
    if (!initialStepReady.current) {
      initialStepReady.current = true;
      return;
    }
    const timer = requestAnimationFrame(() => {
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    });
    return () => cancelAnimationFrame(timer);
  }, [step, ready, completed]);
  useEffect(() => {
    if (!confirmedAuction) return;
    auctionTicket.current?.focus({ preventScroll: true });
    auctionTicket.current?.scrollIntoView({ block: 'center', behavior: 'instant' });
  }, [confirmedAuction]);
  useEffect(() => {
    if (!focusTarget) return;
    const timer = requestAnimationFrame(() => {
      const target = document.getElementById(focusTarget);
      let disclosure = target?.closest('details');
      while (disclosure) {
        disclosure.open = true;
        disclosure = disclosure.parentElement?.closest('details') ?? null;
      }
      focusListingControl(target);
      setFocusTarget(null);
    });
    return () => cancelAnimationFrame(timer);
  }, [step, focusTarget]);

  useEffect(() => () => {
    localPhotoUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    if (completed || (editId ? version === savedVersion : version === 0 && !listingId)) return;
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [version, savedVersion, editId, listingId, completed]);

  async function ensureDraft(): Promise<string> {
    if (idRef.current) return idRef.current;
    if (draftCreation.current) return draftCreation.current;
    if (!profile || !categories[0]) throw new Error('Categories and your account must be available before continuing.');
    draftCreation.current = createDraftListing(profile.id, categories[0].id).then(async (id) => {
      idRef.current = id;
      setListingId(id);
      if (sourceRequest) {
        try { localStorage.setItem(`ybuy-listing-request:${profile.id}:${id}`, sourceRequest.id); }
        catch (error) { console.warn('Could not remember the listing request context.', error); }
      }
      const row = await fetchListingById(id);
      if (!row) throw new Error('Could not verify the new draft. Reload before continuing.');
      return id;
    }).finally(() => { draftCreation.current = null; });
    return draftCreation.current;
  }

  async function refreshRevision(id: string) {
    const row = await fetchListingById(id);
    if (!row || !Number.isSafeInteger(row.revision)) throw new Error('Could not verify the latest listing revision. Reload before making further changes.');
    revision.current = row.revision!;
  }

  const pickupFields = [pickup.formattedAddress, pickup.streetAddress, pickup.city, pickup.state, pickup.postalCode, pickup.country];
  const availabilityZone = pickup.timeZone
    ?? (pickup.latitude !== null && pickup.longitude !== null ? pickupTimeZone(pickup.latitude, pickup.longitude) : '');
  const availabilityToday = pickupConfirmed && availabilityZone ? pickupToday(availabilityZone) : todayIso();
  const errors: FlowErrors = validateListing({
    photoCount: photos.length, title: form.title, categoryId: form.categoryId, description: form.description,
    pickupConfirmed, pickupFields, priceText: form.price, depositText: '0', valueText: form.value, maxValue: policy?.max_estimated_value, condition: form.condition,
  });
  for (const [field, text, pricing] of [['weekly-rate', form.weeklyRate, form.weeklyPricing], ['monthly-rate', form.monthlyRate, form.monthlyPricing]] as const) {
    if (pricing === 'fixed') {
      const amount = parseMoney(text);
      if (amount === null || amount < LISTING_RULES.price.min || amount > LISTING_RULES.price.max) {
        errors[field] = `Enter a price from $${LISTING_RULES.price.min} to $${LISTING_RULES.price.max}.`;
      }
    }
  }
  delete errors.deposit;
  const retainedAvailability = status !== 'draft' && originalWindow.current?.start === form.start && originalWindow.current?.end === form.end;
  if (!retainedAvailability) {
    const availabilityError = listingAvailabilityError(form.start, form.end, availabilityToday);
    if (availabilityError) errors.availability = availabilityError;
  }
  if (!Number.isInteger(form.quantity) || form.quantity < 1 || (policy && form.quantity > policy.max_quantity)) errors.quantity = 'Choose an allowed number of identical units.';
  const deliveryFee = parseMoney(form.deliveryFee || '0');
  if (form.delivery && (deliveryFee === null || deliveryFee < 1 || (policy && deliveryFee > policy.max_delivery_fee))) errors.delivery = `Enter a delivery fee between $1 and $${policy?.max_delivery_fee ?? 99}.`;
  const itemError = listingItemDetailsError({ ...EMPTY_ITEM_DETAILS, brand: form.itemDetails.brand, model: form.itemDetails.model,
    included_items: form.itemDetails.included_items, additional_details: form.itemDetails.additional_details });
  if (itemError) errors['item-details'] = itemError;
  const handoffError = listingItemDetailsError({ ...EMPTY_ITEM_DETAILS, delivery_radius_miles: form.itemDetails.delivery_radius_miles,
    pickup_windows: form.itemDetails.pickup_windows, return_windows: form.itemDetails.return_windows,
    return_rules: form.itemDetails.return_rules, return_note: form.itemDetails.return_note });
  if (handoffError) errors['handoff-details'] = handoffError;
  for (const [field, value] of [
    ['weekly-discount', form.weeklyDiscount],
    ['monthly-discount', form.monthlyDiscount],
  ] as const) {
    if (value && (!/^\d{1,2}(\.\d{1,2})?$/.test(value) || Number(value) > 50)) {
      errors[field] = 'Enter a discount between 0% and 50%.';
    }
  }
  const fieldsForStep: (keyof FlowErrors)[] = step === 1 ? ['photos'] : step === 2
    ? [...ITEM_STEP_FIELDS.filter((field) => field !== 'photos' && field !== 'value'), 'item-details'] : step === 3
      ? ['price', 'weekly-rate', 'monthly-rate', 'value', 'quantity', 'weekly-discount', 'monthly-discount'] : step === 4 ? ['availability'] : step === 5 ? ['pickup', 'delivery', 'handoff-details'] : Object.keys(errors) as (keyof FlowErrors)[];
  const visibleErrors = attempted ? fieldsForStep.filter((field) => errors[field]) : [];
  const blockingFlags = flags.filter((flag) => flag.confidence === 'high' && BLOCKING_FLAG_TYPES.has(flag.type));
  const photoLimit = Math.min(policy?.max_photos ?? 4, 4);
  const handlePhotoFocusHandled = useCallback(() => setPhotoFocusIndex(null), []);
  function focusFirstError(fields: (keyof FlowErrors)[]) {
    const field = fields.find(field => errors[field]);
    if (!field) return;
    setStep(fieldStep(field));
    setFocusTarget(fieldId(field));
  }

  async function persist(publish: boolean): Promise<boolean> {
    setAttempted(true);
    if (fieldsForStep.some(field => errors[field])) {
      focusFirstError(fieldsForStep);
      return false;
    }
    if (saveInFlight.current) {
      const saved = await saveInFlight.current;
      if (!saved || (!publish && savedVersionRef.current === versionRef.current)) return saved;
    }
    const task = async () => {
      if (!policy) return false;
      const capturedVersion = versionRef.current;
      const current = formRef.current;
      setSaving(true); setSaveError(null);
      try {
        const weeklyEnabled = current.weeklyPricing !== 'daily' && current.weeklyDiscountEnabled && (durationDiscountFlag.enabled || Boolean(editId));
        const monthlyEnabled = current.monthlyPricing !== 'daily' && current.monthlyDiscountEnabled && (durationDiscountFlag.enabled || Boolean(editId));
        const price = current.price.trim() ? parseMoney(current.price) : 1;
        const weeklyRate = current.weeklyPricing === 'fixed' && current.weeklyRate.trim() ? parseMoney(current.weeklyRate) : null;
        const monthlyRate = current.monthlyPricing === 'fixed' && current.monthlyRate.trim() ? parseMoney(current.monthlyRate) : null;
        const value = current.value.trim() ? parseMoney(current.value) : null;
        if ((step === 3 || step === STEPS.length) && (price === null || price < LISTING_RULES.price.min || price > LISTING_RULES.price.max)) throw new Error('Enter a valid daily rental price before saving. Your entry has been kept.');
        for (const discount of [current.weeklyDiscount, current.monthlyDiscount]) {
          if (discount && (!/^\d{1,2}(\.\d{1,2})?$/.test(discount) || Number(discount) > 50)) throw new Error('Discounts must be between 0% and 50%.');
        }
        const id = await ensureDraft();
        const allDetails: ListingFlowDetails = {
          title: current.title.trim(), description: current.description.trim(), category_id: current.categoryId || categories[0].id,
          price_per_day: price ?? undefined, price_per_week: weeklyRate, price_per_month: monthlyRate,
          estimated_value: value, item_condition: current.condition || null,
          weekly_discount_enabled: weeklyEnabled, weekly_discount_percent: Number(current.weeklyDiscount || 0),
          monthly_discount_enabled: monthlyEnabled, monthly_discount_percent: Number(current.monthlyDiscount || 0),
          location_label: [pickup.city, pickup.state].filter(Boolean).join(', '),
          instant_booking: current.instant, delivery_available: current.delivery, available_quantity: current.quantity,
          delivery_fee: current.delivery ? parseMoney(current.deliveryFee || '0')! : 0,
          availability_start: current.start,           availability_end: current.end,
          item_details: current.itemDetails,
        };
        const stepKeys: (keyof ListingFlowDetails)[][] = [
          [],
          ['title', 'description', 'category_id', 'item_condition', 'item_details'],
          ['price_per_day', 'price_per_week', 'price_per_month', 'weekly_discount_enabled', 'weekly_discount_percent', 'monthly_discount_enabled', 'monthly_discount_percent', 'estimated_value', 'instant_booking', 'available_quantity'],
          ['availability_start', 'availability_end'],
          ['location_label', 'delivery_available', 'delivery_fee', 'item_details'],
        ];
        const details: ListingFlowDetails = step === STEPS.length ? allDetails : Object.fromEntries(
          Object.entries(allDetails).filter(([key]) => stepKeys[step - 1].includes(key as keyof ListingFlowDetails)),
        );
        const confirmedPickup = step >= 5 && pickupConfirmed
          ? {
            formattedAddress: pickup.formattedAddress, streetAddress: pickup.streetAddress, city: pickup.city,
            state: pickup.state, postalCode: pickup.postalCode, country: pickup.country,
            latitude: pickup.latitude, longitude: pickup.longitude, placeId: pickup.placeId, timeZone: pickup.timeZone,
          } : undefined;
        const result = await saveListingFlow(id, revision.current, details, confirmedPickup, publish);
        revision.current = result.revision;
        originalWindow.current = { start: current.start, end: current.end };
        setStatus(result.status);
        savedVersionRef.current = capturedVersion;
        setSavedVersion(capturedVersion);
        setNotice(publish ? null : result.status === 'draft' ? 'Draft saved. Resume it from My listings.'
          : result.status === 'archived' ? 'Changes saved. This listing remains archived.'
            : result.status === 'suspended' ? 'Changes saved. This listing remains suspended.' : 'Listing changes saved.');
        if (publish) {
          if (result.status !== 'published' && result.status !== 'pending_approval') throw new Error('We could not confirm publication. Your listing is not live yet.');
          setCompleted(true);
        }
        return true;
      } catch (error) {
        setSaveError(message(error, 'Could not save your listing. Your entries are still here; try again.'));
        return false;
      } finally { setSaving(false); }
    };
    saveInFlight.current = task();
    try { return await saveInFlight.current; }
    finally { saveInFlight.current = null; }
  }

  async function analyze(id: string, urls: string[], applySuggestions = true) {
    if (!urls.length) { setFlags([]); return false; }
    const run = ++aiRun.current;
    setAiLoading(true); setAiError(null); setPhotoError(null);
    const captured = formRef.current;
    try {
      const result = await moderateListingContent({ listingId: id, photoUrls: urls, title: captured.title, description: captured.description }, applySuggestions ? 'suggestions' : 'publication');
      if (run !== aiRun.current) return false;
      setFlags(result.flags);
      setPhotoDecisions(Object.fromEntries(result.photoDecisions.map((decision) => [urls[decision.photoIndex], decision])));
      setQualitySuggestions(Object.fromEntries(result.photoQualitySuggestions.filter((item) => urls[item.photoIndex])
        .map((item) => [urls[item.photoIndex], `${item.reason} ${item.recommendation}`])));
      photoChangesPending.current = false;
      hasPhotoReview.current = true;
      const problem = result.photoDecisions.find(decision => decision.decision !== 'approved');
      const photoFlag = result.flags.find(flag => flag.confidence === 'high' && BLOCKING_FLAG_TYPES.has(flag.type) && (flag.source === 'photo' || flag.source === 'both'));
      if (problem || photoFlag) {
        setPhotoError(problem ? `Photo ${problem.photoIndex + 1}: ${problem.reason} Replace or recheck this photo before continuing.` : photoFlag!.reason);
        if (problem) setPhotoFocusIndex(problem.photoIndex);
        if (!applySuggestions) setStep(1);
        return false;
      }
      if (result.masked.changed) {
        const current = formRef.current;
        const next = { ...current,
          title: current.title === captured.title ? result.masked.title : current.title,
          description: current.description === captured.description ? result.masked.description : current.description };
        formRef.current = next;
        setForm(next);
        changed();
        setNotice('Contact information was removed. Review the updated details before continuing.');
        if (!applySuggestions) { setStep(2); return false; }
      }
      if (!applySuggestions) return true;
      if (!result.suggestion) {
        setAiError(result.aiError || 'AI could not identify enough details. Please describe the item yourself.');
        return true;
      }
      const suggestion = result.suggestion;
      setForm((current) => ({
        ...current,
        title: editedFields.current.title ? current.title : suggestion.title,
        description: editedFields.current.description ? current.description : suggestion.description,
        categoryId: editedFields.current.categoryId || !suggestion.categoryId ? current.categoryId : suggestion.categoryId,
        itemDetails: {
          ...current.itemDetails,
          brand: editedFields.current.brand || !suggestion.brand ? current.itemDetails.brand : suggestion.brand,
          model: editedFields.current.model || !suggestion.model ? current.itemDetails.model : suggestion.model,
        },
      }));
      changed(); setAiApplied(true);
      reviewedText.current = '';
      if (result.masked.changed) setNotice('Contact information was removed. Review the updated details before continuing.');
      return true;
    } catch (error) {
      if (run === aiRun.current) {
        if (applySuggestions) setAiError(message(error, 'AI suggestions are unavailable. Continue manually.'));
        else {
          setPhotoError(message(error, 'Photo review could not be completed. Recheck your photos before publishing.'));
          setStep(1);
        }
      }
      return false;
    } finally { if (run === aiRun.current) setAiLoading(false); }
  }

  async function reviewDetails(publishing = false): Promise<boolean> {
    const current = formRef.current;
    const photoProblem = Object.values(photoDecisions).find(decision => decision.decision !== 'approved');
    if (photoProblem || blockingFlags.some(flag => flag.source === 'photo' || flag.source === 'both')) {
      setPublishError('Resolve the flagged photos before continuing. Replace or recheck the highlighted photo.');
      setStep(1);
      if (photoProblem) setPhotoFocusIndex(photoProblem.photoIndex);
      return false;
    }
    if (!publishing && skipLocalPhotoReview && (!hasPhotoReview.current || photoChangesPending.current)) return true;
    if (!publishing && reviewedText.current === textKey(current)) return true;
    const result = await moderateListingContent({ listingId: await ensureDraft(), photoUrls: skipLocalPhotoReview ? [] : photos,
      title: current.title, description: listingText(current), reviewMode: 'text' }, 'publication');
    setFlags((previous) => [...previous.filter((flag) => flag.source === 'photo' || flag.source === 'both'), ...result.flags]);
    if (result.masked.changed) {
      const next = { ...current, title: maskListingContact(current.title), description: maskListingContact(current.description),
        itemDetails: { ...current.itemDetails, brand: maskListingContact(current.itemDetails.brand),
          model: maskListingContact(current.itemDetails.model),
          included_items: current.itemDetails.included_items.map(maskListingContact),
          additional_details: maskListingContact(current.itemDetails.additional_details) } };
      formRef.current = next;
      setForm(next);
      changed();
      setNotice('Contact information was removed. Review the updated details before continuing.');
      setStep(2);
      return false;
    }
    if (result.flags.some((flag) => flag.confidence === 'high' && BLOCKING_FLAG_TYPES.has(flag.type))) {
      setPublishError('Correct the flagged details before continuing.');
      setStep(2);
      return false;
    }
    if (result.aiError) {
      if (!skipLocalPhotoReview || result.aiError !== 'AI is not configured. Please contact support or enter details manually.') {
        throw new Error(result.aiError);
      }
      console.warn('Local listing publication is using deterministic text checks without AI review.');
    }
    if (publishing && !skipLocalPhotoReview) {
      setPhotoDecisions(Object.fromEntries(result.photoDecisions.map((decision) => [photos[decision.photoIndex], decision])));
      const needsCorrection = result.photoDecisions.find((decision) => decision.decision !== 'approved');
      if (needsCorrection) {
        setPublishError('One or more photos need attention before this listing can be published. Replace the highlighted photo, then recheck.');
        setStep(1);
        setPhotoFocusIndex(needsCorrection.photoIndex);
        return false;
      }
    }
    reviewedText.current = textKey(current);
    return true;
  }

  async function upload(files: File[], replacing?: number) {
    if (operation.current || !policy) return;
    operation.current = true; setWorking(true); setPhotoError(null); setSaveError(null);
    const failures: typeof failedUploads = [];
    const next = [...photos];
    const nextFiles = [...photoFiles];
    try {
      if (editId && saveInFlight.current && !await saveInFlight.current) throw new Error('Retry saving before changing photos.');
      const slots = Math.max(0, replacing === undefined ? photoLimit - photos.length : 1);
      if (files.length > slots) setPhotoError(`You can add at most ${slots} more ${slots === 1 ? 'photo' : 'photos'}. The remaining files were not added.`);
      if (slots < 1) return;
      const accepted = files.slice(0, slots);
      const id = listingId ? await ensureDraft() : null;
      for (const [index, file] of accepted.entries()) {
        setUploadProgress({ done: index, total: accepted.length, text: `${editId ? 'Uploading' : 'Preparing'} photo ${index + 1} of ${accepted.length}` });
        try {
          const prepared = await prepareListingPhoto(file, policy.min_photo_dimension, Math.min(policy.max_photo_bytes, MAX_LISTING_PHOTO_BYTES));
          const safeFile = prepared.file;
          let url: string;
          if (id) {
            const result = await uploadListingPhoto(id, safeFile, replacing ?? next.length, replacing === undefined ? undefined : next[replacing]);
            url = result.url;
            const warning = result.warning;
            if (warning) setWarnings((current) => ({ ...current, [url]: warning }));
          } else {
            url = URL.createObjectURL(safeFile);
            localPhotoUrls.current.add(url);
            if (replacing !== undefined && photoFiles[replacing]) {
              URL.revokeObjectURL(next[replacing]);
              localPhotoUrls.current.delete(next[replacing]);
            }
          }
          if (replacing === undefined) next.push(url); else next[replacing] = url;
          if (replacing === undefined) nextFiles.push(id ? null : safeFile); else nextFiles[replacing] = id ? null : safeFile;
          setPhotos([...next]);
          setPhotoFiles([...nextFiles]);
          setPhotoDecisions({});
          setQualitySuggestions({});
          setFlags([]);
          if (id) photoChangesPending.current = true;
          changed();
        } catch (error) {
          failures.push({ file, replaceUrl: editId && replacing !== undefined ? photos[replacing] : undefined,
            replaceIndex: !editId ? replacing : undefined, error: message(error, 'Upload failed. Retry this photo.') });
        } finally {
          setUploadProgress({ done: index + 1, total: accepted.length, text: index + 1 === accepted.length ? (editId ? 'Finishing your photo uploads' : 'Photos ready') : `Added ${index + 1} of ${accepted.length} photos` });
        }
      }
      if (id) await refreshRevision(id);
      setUploadProgress({ done: accepted.length, total: accepted.length, text: editId ? 'Photo uploads finished' : 'Photos ready' });
    } catch (error) { setPhotoError(message(error, 'Could not prepare your photos.')); }
    finally {
      setFailedUploads((current) => [...current.filter((item) => !files.includes(item.file)), ...failures]);
      setUploadProgress(null); setWorking(false); operation.current = false;
    }
  }

  async function mutatePhotos(action: () => Promise<string[]>, recheck = true) {
    if (operation.current || !listingId) return;
    operation.current = true; setWorking(true); setSaveError(null);
    try {
      if (saveInFlight.current && !await saveInFlight.current) throw new Error('Retry saving before changing photos.');
      const next = await action();
      setPhotos(next); changed();
      await refreshRevision(listingId);
      if (recheck) {
        setFlags([]); setPhotoDecisions({}); setQualitySuggestions({});
        photoChangesPending.current = true;
      } else {
        setPhotoDecisions((current) => Object.fromEntries(next.filter((url) => current[url])
          .map((url) => [url, { ...current[url], photoIndex: next.indexOf(url) }])));
      }
    } catch (error) { setSaveError(message(error, 'Could not save the gallery change. Reload to check its saved state.')); }
    finally { operation.current = false; setWorking(false); }
  }

  async function uploadStagedPhotos(id: string): Promise<string[]> {
    const next = [...photos];
    const nextFiles = [...photoFiles];
    const failures: string[] = [];
    for (const [index, file] of nextFiles.entries()) {
      if (!file) continue;
      setUploadProgress({ done: index, total: photos.length, text: `Uploading photo ${index + 1} of ${photos.length}` });
      try {
        const result = await uploadListingPhoto(id, file, index);
        const localUrl = next[index];
        if (localPhotoUrls.current.delete(localUrl)) URL.revokeObjectURL(localUrl);
        next[index] = result.url;
        nextFiles[index] = null;
        const warning = result.warning ?? warnings[localUrl];
        setWarnings((current) => {
          const updated = { ...current };
          delete updated[localUrl];
          if (warning) updated[result.url] = warning;
          return updated;
        });
      } catch (error) {
        failures.push(`${file.name}: ${message(error, 'Upload failed.')}`);
      } finally {
        setUploadProgress({ done: index + 1, total: photos.length, text: `Uploaded ${index + 1} of ${photos.length} photos` });
      }
    }
    setPhotos(next);
    setPhotoFiles(nextFiles);
    if (nextFiles.some(Boolean)) throw new Error(`Could not upload every photo. ${failures.join(' ') || 'Click Continue to retry.'}`);
    await refreshRevision(id);
    return next;
  }

  function retryFailedUpload(item: (typeof failedUploads)[number]) {
    if (item.replaceIndex !== undefined) { void upload([item.file], item.replaceIndex); return; }
    if (!item.replaceUrl) { void upload([item.file]); return; }
    const currentIndex = photos.indexOf(item.replaceUrl);
    if (currentIndex >= 0) { void upload([item.file], currentIndex); return; }
    if (photos.length < photoLimit) { void upload([item.file]); return; }
    setPhotoError('The photo being replaced is no longer in the gallery. Remove a photo or choose a new one before retrying.');
  }

  async function removePhoto(index: number) {
    if (!listingId || photoFiles[index]) {
      if (localPhotoUrls.current.delete(photos[index])) URL.revokeObjectURL(photos[index]);
      setPhotos((current) => current.filter((_, at) => at !== index));
      setPhotoFiles((current) => current.filter((_, at) => at !== index));
      changed(); setFlags([]); setPhotoDecisions({}); setQualitySuggestions({});
      photoChangesPending.current = true;
      return;
    }
    await mutatePhotos(async () => {
      await removeListingImageUrl(listingId, photos[index]);
      const next = photos.filter((_, at) => at !== index);
      await saveListingImageOrder(listingId, next);
      return next;
    });
  }

  async function reorderPhoto(from: number, to: number) {
    const next = [...photos];
    const [photo] = next.splice(from, 1);
    next.splice(to, 0, photo);
    const nextFiles = [...photoFiles];
    const [file] = nextFiles.splice(from, 1);
    nextFiles.splice(to, 0, file ?? null);
    if (!listingId || photoFiles.some(Boolean)) {
      setPhotos(next); setPhotoFiles(nextFiles); changed();
      setPhotoDecisions((current) => Object.fromEntries(next.filter((url) => current[url])
        .map((url) => [url, { ...current[url], photoIndex: next.indexOf(url) }])));
      return;
    }
    await mutatePhotos(async () => {
      await saveListingImageOrder(listingId, next);
      return next;
    }, false);
  }

  async function continueStep(destination = Math.min(STEPS.length, step + 1)) {
    if (saving || working) return;
    setAttempted(true);
    if (fieldsForStep.some((field) => errors[field])) { focusFirstError(fieldsForStep); return; }
    if (step === 1 && skipLocalPhotoReview) {
      if (!editId && photoFiles.some(Boolean)) {
        setWorking(true); operation.current = true; setPhotoError(null);
        try {
          const id = await ensureDraft();
          await uploadStagedPhotos(id);
          photoChangesPending.current = true;
        } catch (error) {
          setPhotoError(message(error, 'Could not prepare your photos. Click Continue to retry.'));
          return;
        } finally {
          setWorking(false); operation.current = false; setUploadProgress(null);
        }
      }
      setAttempted(false); setStep(2);
      return;
    }
    if (!editId && step === 1 && (!hasPhotoReview.current || photoChangesPending.current || photoFiles.some(Boolean))) {
      setPreparingDetails(true); setWorking(true); operation.current = true; setPhotoError(null);
      try {
        const id = await ensureDraft();
        const urls = await uploadStagedPhotos(id);
        if (!await analyze(id, urls)) return;
        setAttempted(false); setStep(2);
      } catch (error) {
        setPhotoError(message(error, 'Could not prepare your photos. Click Continue to retry.'));
      } finally {
        setPreparingDetails(false); setWorking(false); operation.current = false; setUploadProgress(null);
      }
      return;
    }
    if (step === 1 && photoChangesPending.current && listingId) {
      try {
        if (!await analyze(listingId, photos)) return;
        setAttempted(false); setStep(2);
      } catch (error) {
        setAiError(message(error, 'Could not recheck your photos. Please retry.'));
      }
      return;
    }
    if (step === 1) {
      const problem = Object.values(photoDecisions).find(decision => decision.decision !== 'approved');
      if (problem || blockingFlags.some(flag => flag.source === 'photo' || flag.source === 'both')) {
        setPhotoError('Photos need attention before publishing. Replace or recheck the flagged photo before continuing.');
        if (problem) setPhotoFocusIndex(problem.photoIndex);
        return;
      }
    }
    if (step === 2) {
      operation.current = true; setWorking(true); setPublishError(null);
      try {
        if (!await reviewDetails()) return;
      } catch (error) {
        setPublishError(message(error, 'Could not review your details. Please retry.'));
        return;
      } finally { operation.current = false; setWorking(false); }
    }
    try {
      if (editId && !await persist(false)) return;
      setAttempted(false); setStep(destination);
    } finally { setPreparingDetails(false); }
  }
  async function goBack() {
    if (step > 1) { setStep(step - 1); setAttempted(false); return; }
    await leavePage();
  }
  async function leavePage(discardConfirmed = false) {
    if (operation.current) return;
    if (editId && versionRef.current !== savedVersionRef.current) {
      setSaveError('Review and save your changes before leaving this listing.');
      return;
    }
    if (!editId && !discardConfirmed && (idRef.current || versionRef.current > 0)) {
      setDiscardError(null);
      setConfirmDiscard(true);
      return;
    }
    if (!editId && idRef.current && status === 'draft' && !profile) {
      setDiscardError('Your session is unavailable. Sign in again before discarding this draft.');
      return;
    }
    if (!editId && profile && idRef.current && status === 'draft') {
      operation.current = true; setWorking(true); setDiscardError(null);
      try {
        await deleteOwnerListing(profile.id, idRef.current);
        if (sourceRequest) {
          try { localStorage.removeItem(`ybuy-listing-request:${profile.id}:${idRef.current}`); }
          catch (error) { console.warn('Could not clear the abandoned listing request context.', error); }
        }
        idRef.current = null;
        setListingId(null);
      } catch (error) {
        setDiscardError(message(error, 'Could not discard the unfinished listing. Your entries are still here.'));
        return;
      } finally { operation.current = false; setWorking(false); }
    }
    setConfirmDiscard(false);
    navigate(requestId ? { name: 'requests', requestId, matches: true } : { name: 'owner-listings' });
  }
  async function publish() {
    if (operation.current) return;
    setPublishError(null);
    setAttempted(true);
    if (Object.keys(errors).length) { focusFirstError(Object.keys(errors) as (keyof FlowErrors)[]); return; }
    aiRun.current += 1;
    setAiLoading(false);
    operation.current = true; setWorking(true);
    try {
      if (status === 'archived' || status === 'suspended') {
        await persist(false);
        return;
      }
      if (editId && status === 'draft' && !await persist(false)) return;
      if (!await reviewDetails(true)) return;
      await persist(true);
    } catch (error) { setPublishError(message(error, 'The required listing review did not finish. Retry publication.')); }
    finally { operation.current = false; setWorking(false); }
  }

  async function shareListing() {
    if (!listingId) return;
    try {
      const url = `${window.location.origin}/listing/${listingId}`;
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setNotice('Listing link copied.');
    } catch (error) {
      console.warn('Listing link could not be copied.', error);
      setShareCopied(false);
      setNotice('Could not copy the listing link. Open the listing to copy its URL.');
    }
  }
  function startFresh() {
    setConfirmedAuction(null);
    if (!policy) return;
    aiRun.current += 1;
    localPhotoUrls.current.forEach((url) => URL.revokeObjectURL(url));
    localPhotoUrls.current.clear();
    idRef.current = null; revision.current = 1;
    versionRef.current = 0; savedVersionRef.current = 0;
    editedFields.current = { title: false, description: false, categoryId: false, brand: false, model: false };
    reviewedText.current = '';
    hasPhotoReview.current = false;
    setForm({ ...EMPTY_FORM, start: todayIso(), end: addDaysIso(todayIso(), Math.min(LISTING_DEFAULT_AVAILABLE_DAYS, policy.listing_duration_days)) });
    setListingId(null); setStatus('draft'); setCompleted(false); setPhotos([]); setPhotoFiles([]);
    setPickup(EMPTY_PICKUP); setPickupConfirmed(false); setStep(1); setFurthestStep(1); setAttempted(false);
    setIncludedItem(''); setIncludedError(null);
    setVersion(0); setSavedVersion(0); setSaveError(null); setPublishError(null); setNotice(null); setShareCopied(false);
    setAiLoading(false); setAiApplied(false); setAiError(null); setFlags([]); setPhotoDecisions({});
    photoChangesPending.current = false;
    setWarnings({}); setQualitySuggestions({}); setFailedUploads([]); setPhotoError(null);
    setReplaceIndex(null);
    originalWindow.current = null;
  }

  if (loadError) return <div className="owner-listing listing-studio"><div className="owner-listing-shell"><Alert tone="error" title="Listing form unavailable">{loadError}</Alert><Button className="mt-4" onClick={() => window.location.reload()}>Retry</Button></div></div>;
  if (!ready || !policy) return <div className="owner-listing listing-studio min-h-screen" aria-busy="true"><div className="owner-listing-shell"><Skeleton className="listing-skeleton--title mb-6" /><Skeleton className="listing-skeleton--field" /><Skeleton className="listing-skeleton--field mt-4" /></div></div>;
  if (completed) return <div className="owner-listing listing-studio min-h-screen"><div className="owner-listing-shell space-y-6">
    {notice && <p role="status" className="text-sm text-accent">{notice}</p>}
    {status === 'published' ? <section role="region" aria-labelledby="listing-success-title" className="listing-success">
      <div>
        <h1 ref={heading} tabIndex={-1} id="listing-success-title">Your listing is live!</h1>
        <p role="status" className="mt-2 text-sm text-sec">People nearby can find your item and request a rental.</p>
        <p className="mt-3 font-semibold text-main">{form.title}</p>
        <div role="group" aria-label="Published listing actions" className="listing-success-actions">
          {!editId && <Button onClick={startFresh}>List another</Button>}
          {biddingFlag.enabled && !confirmedAuction && <a href="#listing-bidding" className="inline-flex min-h-11 items-center font-semibold text-accent underline">Set up optional bidding</a>}
          <Button variant="secondary" onClick={() => navigate({ name: 'listing', id: listingId! })}>View item</Button>
          <Button variant="secondary" onClick={() => navigate({ name: 'edit-listing', id: listingId! })}>Edit listing</Button>
          <Button variant="ghost" onClick={() => void shareListing()}>{shareCopied ? 'Copied!' : 'Copy link'}</Button>
        </div>
      </div>
      {photos[0] && <img src={photos[0]} alt={form.title} />}
    </section>
      : <section className="p-6 sm:p-10"><ShieldCheck aria-hidden="true" size={32} className="text-accent mb-4" />
        <h1 className="text-2xl font-bold text-main">Submitted for review</h1><p role="status" className="text-sec mt-2">Your listing is not live yet. Review its status from My listings.</p>
        <p className="mt-4 font-semibold">{form.title}</p>
        {biddingFlag.enabled && <p className="mt-3 text-sm text-sec">Once approved, open My listings and choose Bidding settings on your published listing. Bidding cannot start before approval.</p>}
        <Button className="mt-6" onClick={() => navigate({ name: 'owner-listings' })}>My listings</Button></section>}
    {status === 'published' && (biddingFlag.enabled || editId) && <section aria-label="Optional competitive bidding" className="owner-listing-bidding">
      {confirmedAuction && <article ref={auctionTicket} tabIndex={-1} aria-label="Your bidding details" className="owner-auction-ticket">
        <div className="owner-auction-ticket-main">
          <span className="owner-auction-ticket-status"><Gavel size={16} aria-hidden="true" />{confirmedAuction.status === 'scheduled' ? 'Scheduled bidding' : 'Live bidding'}</span>
          <h2 className="mt-3 text-xl font-bold text-main break-words">{form.title}</h2>
          <p role="status" className="mt-2 text-xs leading-relaxed text-sec">{auctionPublicationMessage(confirmedAuction)}</p>
          <a href={`/bidding/${listingId}`} className="owner-auction-ticket-link">View bidding <ArrowRight size={16} aria-hidden="true" /></a>
        </div>
        <div className="owner-auction-ticket-clock">
          <Clock3 size={28} aria-hidden="true" className="text-sec" />
          <span className="mt-3 text-xs font-semibold text-sec">{confirmedAuction.status === 'scheduled' ? 'Bidding opens' : 'Bidding closes'}</span>
          <time dateTime={confirmedAuction.status === 'scheduled' ? confirmedAuction.starts_at : confirmedAuction.ends_at} className="mt-1 text-lg font-bold text-main">
            {new Date(confirmedAuction.status === 'scheduled' ? confirmedAuction.starts_at : confirmedAuction.ends_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </time>
          <span className="mt-1 text-sm font-medium text-main">
            {new Date(confirmedAuction.status === 'scheduled' ? confirmedAuction.starts_at : confirmedAuction.ends_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}
          </span>
        </div>
      </article>}
      {!confirmedAuction && <div className="listing-bidding-details">
        <div className="listing-bidding-copy">
          <h2 className="listing-bidding-title">Add optional bidding</h2>
          <p className="listing-bidding-description">Your listing is live. Choose a date range; bidding uses your listed daily price and automatic timing.</p>
        </div>
        <ListingNegotiationSettings listingId={listingId!} startSetup onSaved={auction => {
          if (auction && ['scheduled', 'open'].includes(auction.status) && auction.starts_at && auction.ends_at) {
            setConfirmedAuction({ ...auction, starts_at: auction.starts_at, ends_at: auction.ends_at });
          }
        }} />
      </div>}
    </section>}
    {status === 'published' && biddingFlag.error && <Alert tone="warning" title="Bidding options unavailable">{biddingFlag.error} Your listing is still live.</Alert>}
    {status === 'published' && sourceRequest && <RequestFulfillment request={sourceRequest} publishedListingId={listingId!} />}
    {status === 'pending_approval' && sourceRequest && <div className="space-y-3">
      <p className="text-sm text-sec">Once approved, return here to notify the renter.</p>
      <Button variant="secondary" onClick={() => navigate({ name: 'edit-listing', id: listingId!, requestId: sourceRequest.id })}>Review this listing and request</Button>
    </div>}
    {!editId && status !== 'published' && <div className="text-center"><Button variant="ghost" onClick={startFresh}>List another item</Button></div>}
  </div></div>;

  const invalid = (field: keyof FlowErrors) => attempted && fieldsForStep.includes(field) ? errors[field] : undefined;
  const fieldProps = (field: ListingField) => ({ 'aria-invalid': Boolean(invalid(field)), 'aria-describedby': invalid(field) ? `${LISTING_FIELD_IDS[field]}-error` : undefined });
  const nextLabel = step === STEPS.length ? editId && status !== 'draft' ? 'Save changes' : 'Publish my listing' : 'Continue';
  const stepHeading = step === STEPS.length && status === 'archived' ? 'Review archived listing'
    : step === STEPS.length && status === 'suspended' ? 'Review listing changes' : STEP_TITLES[step - 1];
  const pickupWindows = form.itemDetails.pickup_windows.map(window => HANDOFF_WINDOW_LABELS[window]).join(', ');
  const returnWindows = form.itemDetails.return_windows.map(window => HANDOFF_WINDOW_LABELS[window]).join(', ');
  const longerPrice = (period: 'weekly' | 'monthly') => {
    const pricing = period === 'weekly' ? form.weeklyPricing : form.monthlyPricing;
    const rate = period === 'weekly' ? form.weeklyRate : form.monthlyRate;
    const discount = period === 'weekly' ? form.weeklyDiscount : form.monthlyDiscount;
    if (pricing === 'fixed') return rate ? `$${rate} fixed price` : 'Set a fixed price';
    if (pricing === 'discount' && durationDiscountFlag.enabled) return `${discount}% off`;
    if (pricing === 'discount' && editId) return 'Discount paused';
    return 'No special rate';
  };
  return (
    <div className="owner-listing listing-studio min-h-screen pb-10">
      <AlertDialog open={confirmDiscard} onOpenChange={open => { if (!working) setConfirmDiscard(open); }}>
        <AlertDialogContent>
          <AlertDialogTitle>Discard this listing?</AlertDialogTitle>
          <AlertDialogDescription>Your unfinished listing and uploaded draft photos will be discarded. You cannot resume this draft after leaving.</AlertDialogDescription>
          {discardError && <p role="alert" className="mt-3 text-sm text-error">{discardError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel asChild><Button variant="secondary" disabled={working}>Keep editing</Button></AlertDialogCancel>
            <Button disabled={working} loading={working} onClick={() => void leavePage(true)}>Discard listing</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="owner-listing-shell listing-studio-shell mx-auto px-4 sm:px-6">
        {sourceRequest && <Alert tone="info" title={`Listing for: ${sourceRequest.title}`}>
          Requested {sourceRequest.preferred_start_date} – {sourceRequest.preferred_end_date} in {sourceRequest.location_label}. Review the suggested details and enter your own item photos and pickup address.
        </Alert>}
        {sourceRequestError && <Alert tone="warning" title="Saved request context unavailable">{sourceRequestError}</Alert>}
        {sourceRequest && editId && status === 'published' && <RequestFulfillment request={sourceRequest} publishedListingId={listingId!} />}
        <header className="listing-studio-header">
          <div className="owner-listing-toolbar">
            <Button variant="ghost" size="sm" disabled={working || saving} icon={<ArrowLeft aria-hidden="true" size={16} />} onClick={() => void leavePage()}>
              {requestId ? 'Back to request matches' : 'Back to my listings'}
            </Button>
            <div>
              <h1>{editId ? 'Edit your listing' : 'Let’s get your item listed'}</h1>
              <p className="listing-studio-intro">We’ll walk you through it. You can go back and change anything.</p>
            </div>
          </div>
          {editId && <div className="flex flex-wrap items-center gap-2">
          <span role="status" className="inline-flex items-center gap-2 text-xs text-sec min-h-11">
            <span aria-hidden="true" className={`h-2 w-2 rounded-full ${saveError ? 'bg-error' : 'bg-accent'}`} />{saving ? 'Saving...' : saveError ? 'Not saved - retry below' : version === savedVersion && listingId ? 'All changes saved' : listingId ? 'Unsaved changes' : 'Private draft'}
          </span>
          {status === 'draft' && <Button size="sm" variant="secondary" disabled={working || saving} loading={saving} onClick={() => void persist(false)}>Save draft</Button>}
          </div>}
        </header>
        {saveError && <div role="alert" className="owner-listing-save-error mb-5"><Alert tone="error" title="Your changes have not been saved">{saveError}
        <Button variant="secondary" className="mt-3" disabled={working || saving} onClick={() => editId ? void persist(false) : void publish()}>{editId ? 'Retry save' : 'Retry publication'}</Button></Alert></div>}
        <div className="listing-studio-layout">
          <nav className="listing-step-rail" aria-label="Listing steps">
            <ol aria-label="Listing progress" className="owner-listing-progress">
              {STEPS.map((label, index) => <li key={label} className="relative min-w-0" data-reached={index + 1 <= furthestStep}>
                <button type="button" disabled={working || saving || index + 1 > furthestStep} onClick={() => {
                  if (index + 1 > step) void continueStep(index + 1);
                  else { setStep(index + 1); setAttempted(false); }
                }}
                  aria-label={`${label}, step ${index + 1} of ${STEPS.length}`}
                  aria-current={step === index + 1 ? 'step' : undefined}
                  className={`owner-step-button ${step === index + 1 ? 'text-accent' : 'text-sec'}`}>
                  <span className={`owner-step-number ${index + 1 <= furthestStep ? 'bg-accent border-accent text-accent-text' : 'bg-card border-strong text-sec'}`}>{index + 1 < furthestStep && index + 1 !== step ? <Check aria-hidden="true" size={14} /> : index + 1}</span>
                  <span className="owner-step-copy"><span className="owner-step-label">{label}</span></span>
                </button>
              </li>)}
            </ol>
            <p className="listing-step-status" aria-live="polite">Step {step} of {STEPS.length}: {STEPS[step - 1]}</p>
            <progress className="listing-step-progress" max={STEPS.length} value={step} aria-label="Listing progress" />
          </nav>
          <div className="owner-listing-workspace listing-studio-workspace">
          <section className="owner-listing-panel min-w-0 overflow-hidden" role="region" aria-label={`Step ${step}: ${STEPS[step - 1]}`}>
            <div className="owner-listing-panel-heading px-5 sm:px-6 pt-6 pb-5 border-b border-app">
              <div>
                <h2 ref={heading} tabIndex={-1} className="text-xl font-bold text-main">{stepHeading}</h2>
                <p className="text-sm text-sec mt-2 leading-relaxed">{[
                  `Add 1–${photoLimit} photos. Your first photo is the cover, so lead with your best one.`,
                  skipLocalPhotoReview ? 'Give people the essentials.' : 'Review your item details before continuing.',
                  'Set your daily price and see what you could earn.', 'Choose your first and last available day.', 'Set the where and when.', 'Here’s your listing at a glance.',
                ][step - 1]}</p></div>
            </div>
            {notice && <div className="border-b border-app bg-accent-soft px-5 sm:px-6 py-3"><p role="status" className="flex items-start gap-2 text-xs text-accent"><CheckCircle2 size={16} aria-hidden="true" className="shrink-0" />{notice}</p></div>}
            <fieldset key={step} disabled={working || saving}
              className="owner-listing-fields min-w-0 px-5 sm:px-6 py-6 space-y-5">
              {visibleErrors.length > 0 && <div ref={summary} tabIndex={-1} role="alert" className="rounded-card-lg bg-error-soft p-4">
                <h3 className="font-semibold text-error">A few details need your attention</h3>
                <ul className="mt-2 space-y-2 text-sm text-error">{visibleErrors.map((field) => <li key={field}>
                  <a href={`#${field in LISTING_FIELD_IDS ? LISTING_FIELD_IDS[field as ListingField] : `listing-${field}`}`} onClick={(event) => {
                    event.preventDefault();
                    setStep(fieldStep(field));
                    setFocusTarget(fieldId(field));
                  }}>{errors[field]}</a>
                </li>)}</ul>
              </div>}
              {preparingDetails && step === 1 ? <div className="space-y-4" role="status" aria-busy="true" aria-label="Analyzing photos and preparing item details">
                <p className="text-sm font-semibold text-main">Analyzing your photos and preparing item details…</p>
                <div className="overflow-hidden border border-app"><Skeleton className="aspect-[16/10] w-full" /></div>
                <Skeleton className="h-5 w-2/3" /><Skeleton className="h-11 w-1/2" />
                <div className="grid grid-cols-2 gap-3"><Skeleton className="h-11" /><Skeleton className="h-11" /></div>
                <Skeleton className="h-28 w-full" />
                <span className="sr-only">The next step will show your title and all listing details.</span>
              </div> : <>
              {step === 1 && <>
                <ListingPhotoEditor photos={photos} maximum={photoLimit} maxBytes={Math.min(policy.max_photo_bytes, MAX_LISTING_PHOTO_BYTES)} minDimension={policy.min_photo_dimension} disabled={working || saving} uploadProgress={uploadProgress} preventLastPhotoRemoval={status === 'published'}
                  decisions={photoDecisions} focusIndex={photoFocusIndex} onFocusHandled={handlePhotoFocusHandled}
                  warnings={{ ...warnings, ...qualitySuggestions }} error={invalid('photos')} onAdd={() => { setReplaceIndex(null); fileInput.current?.click(); }}
                  onDrop={(files) => void upload(files)} onReplace={(index) => { setReplaceIndex(index); fileInput.current?.click(); }}
                  onRemove={(index) => void removePhoto(index)}
                  onReorder={(from, to) => void reorderPhoto(from, to)} />
                <input ref={fileInput} aria-hidden="true" tabIndex={-1} type="file" accept="image/jpeg,image/png,image/webp" multiple className="listing-photo-input"
                  disabled={working || saving} onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; const target = replaceIndex; setReplaceIndex(null); void upload(files, target ?? undefined); }} />
                {aiLoading && <ListingAiSkeleton />}
                {photoError && <Alert tone="error" title="Photos need attention before publishing">{photoError}</Alert>}
                {photos.length > 0 && (photoError || aiError) && <Button variant="secondary" disabled={working || saving || aiLoading}
                  onClick={() => {
                    photoChangesPending.current = true;
                    void continueStep();
                  }}>Recheck photos</Button>}
                {failedUploads.map((item, index) => <Alert key={`${item.file.name}-${index}`} tone="error" title={item.file.name}>{item.error}
                  <div className="flex gap-2 mt-2"><Button variant="secondary" disabled={working || saving} onClick={() => retryFailedUpload(item)}>Retry photo</Button>
                    <Button variant="ghost" onClick={() => setFailedUploads((items) => items.filter((_, at) => at !== index))}>Dismiss</Button></div></Alert>)}
              </>}
              {step === 2 && <>
                {!skipLocalPhotoReview && <div className="owner-ai-panel rounded-card">
                  <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold text-accent inline-flex items-center gap-2"><Sparkles aria-hidden="true" size={14} />{aiLoading ? 'Creating suggestions from your photos...' : aiApplied ? 'AI suggestions ready' : 'AI suggestions'}</p>
                    <Button variant="secondary" disabled={working || saving || aiLoading || !photos.length} onClick={() => void ensureDraft().then((id) => analyze(id, photos)).catch((error) => setAiError(message(error, 'Could not analyze photos.')))}>{aiApplied ? 'Regenerate' : 'Generate details'}</Button></div>
                  <p className="text-xs text-sec mt-1">Review the suggestions and add anything missing. Your edits are kept if you regenerate.</p>
                  {aiLoading && <Button variant="ghost" onClick={() => { aiRun.current += 1; setAiLoading(false); setAiError('Continue manually. You can retry AI later.'); }}>Continue manually</Button>}
                </div>}
                {aiLoading && <ListingAiSkeleton />}
                {aiError && <div role="status" className="text-xs text-warning"><p className="font-semibold">Manual entry is available</p><p className="mt-1">{aiError}</p></div>}
                {flags.length > 0 && <Alert tone={blockingFlags.length ? 'error' : 'warning'} title={blockingFlags.length ? 'Does not meet Community Guidelines' : 'Review these suggestions'}><ul className="list-disc pl-4">{flags.map((flag, index) => <li key={index}>{flag.reason}</li>)}</ul>
                  <p className="mt-2">Replace flagged photos and correct flagged text to continue. Contact support if you disagree with the review.</p></Alert>}
                {Object.values(photoDecisions).some((decision) => decision.decision !== 'approved') && <Alert tone="error" title="Photos need attention before publishing">
                  <ul className="space-y-2">{Object.values(photoDecisions).filter((decision) => decision.decision !== 'approved').map((decision) => (
                    <li key={decision.photoIndex} className="flex flex-wrap items-center justify-between gap-2">
                      <span>Photo {decision.photoIndex + 1}: {decision.reason}</span>
                      <Button size="sm" variant="secondary" onClick={() => { setPhotoFocusIndex(decision.photoIndex); setStep(1); }}>
                        {decision.decision === 'manual_review' ? 'Review photo' : 'Fix this photo'}
                      </Button>
                    </li>
                  ))}</ul>
                  <Button size="sm" variant="ghost" className="mt-2" onClick={() => navigate({ name: 'support' })}>Contact support or report an issue</Button>
                </Alert>}
                <Field label="Title" htmlFor="listing-title" error={invalid('title')}><input id="listing-title" value={form.title} maxLength={LISTING_RULES.title.max} placeholder="Give your item a name"
                  onChange={(event) => { editedFields.current.title = true; update('title', event.target.value); }} className={fieldClass()} {...fieldProps('title')} />
                  <p className="text-xs text-sec text-right mt-1">{form.title.length}/{LISTING_RULES.title.max}</p></Field>
                <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Category" htmlFor="listing-category-group" error={invalid('category')}><select id="listing-category-group" value={form.categoryId}
                  onChange={(event) => { editedFields.current.categoryId = true; update('categoryId', event.target.value); }} className={fieldClass()} {...fieldProps('category')}>
                  <option value="">Choose a category</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></Field>
                <Field label="Condition" htmlFor="listing-condition" error={invalid('condition')}>
                  <select id="listing-condition" value={form.condition} onChange={event => update('condition', event.target.value)}
                    className={fieldClass()} {...fieldProps('condition')}>
                    <option value="">Choose a condition</option>
                    {Object.entries(CONDITION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </Field>
                </div>
                <Field label="Description" htmlFor="listing-description" error={invalid('description')}>
                  <textarea id="listing-description" value={form.description} rows={5} required minLength={LISTING_RULES.description.min} maxLength={LISTING_RULES.description.max} placeholder="Describe the item, what is included, and any wear."
                    onChange={(event) => { editedFields.current.description = true; update('description', event.target.value); }} className={textareaClass()} {...fieldProps('description')} />
                  <p className="text-xs text-sec text-right mt-1">{form.description.length}/{LISTING_RULES.description.max}</p></Field>
                <div className="space-y-5">
                <div id="listing-item-details" tabIndex={-1} className="grid grid-cols-2 gap-3">
                  <Field label="Brand (optional)" htmlFor="listing-brand"><input id="listing-brand" value={form.itemDetails.brand} maxLength={80}
                    aria-invalid={Boolean(invalid('item-details'))} aria-describedby={invalid('item-details') ? 'listing-item-details-error' : undefined}
                    onChange={event => updateItemDetails('brand', event.target.value)} className={fieldClass()} /></Field>
                  <Field label="Model (optional)" htmlFor="listing-model"><input id="listing-model" value={form.itemDetails.model} maxLength={80}
                    aria-invalid={Boolean(invalid('item-details'))} aria-describedby={invalid('item-details') ? 'listing-item-details-error' : undefined}
                    onChange={event => updateItemDetails('model', event.target.value)} className={fieldClass()} /></Field>
                </div>
                {invalid('item-details') && <p id="listing-item-details-error" role="alert" className="text-xs text-error">{invalid('item-details')}</p>}
                {editId && <div>
                  <p className="text-[13px] font-semibold text-main">What's included <span className="text-xs font-normal text-sec">(optional)</span></p>
                  {form.itemDetails.included_items.length > 0 && <ul className="mt-2 flex flex-wrap gap-2" aria-label="Included items">
                    {form.itemDetails.included_items.map((item, index) => <li key={item} className="inline-flex items-center gap-1 rounded-card bg-accent-soft pl-3 text-xs text-accent">
                      {item}<button type="button" aria-label={`Remove included item ${item}`} className="grid min-h-11 min-w-9 place-items-center"
                        onClick={() => updateItemDetails('included_items', form.itemDetails.included_items.filter((_, at) => at !== index))}><X size={12} aria-hidden="true" /></button>
                    </li>)}
                  </ul>}
                  <div className="flex gap-2 mt-2">
                    <label htmlFor="listing-included-item" className="sr-only">Included item</label>
                    <input id="listing-included-item" maxLength={60} value={includedItem} placeholder="e.g. Carrying case" className={fieldClass('min-w-0 flex-1')}
                      aria-invalid={Boolean(includedError)} aria-describedby={includedError ? 'listing-included-error' : undefined}
                      onChange={event => { setIncludedItem(event.target.value); setIncludedError(null); }}
                      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addIncludedItem(); } }} />
                    <Button size="sm" variant="secondary" icon={<Plus size={14} aria-hidden="true" />} disabled={form.itemDetails.included_items.length >= 12} onClick={addIncludedItem}>Add item</Button>
                  </div>
                  {includedError && <p id="listing-included-error" role="alert" className="text-xs text-error mt-2">{includedError}</p>}
                </div>}
                {editId && <Field label="Additional details (optional)" htmlFor="listing-additional-details">
                  <textarea id="listing-additional-details" value={form.itemDetails.additional_details} maxLength={500} rows={2}
                    placeholder="Usage notes, features, or anything renters should know" onChange={event => updateItemDetails('additional_details', event.target.value)} className={textareaClass()} />
                  <p className="text-xs text-sec text-right mt-1">{form.itemDetails.additional_details.length}/500</p>
                </Field>}
                </div>
              </>}
              </>}
              {step === 3 && <>
                <div className="owner-rental-grid">
                <section aria-label="Rental pricing" className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Price per day ($)" htmlFor="listing-price" error={invalid('price')}>
                    <div className="relative mt-2">
                      <span aria-hidden="true" className="absolute inset-y-0 left-4 flex items-center text-lg font-semibold text-muted">$</span>
                      <input id="listing-price" inputMode="decimal" value={form.price} onChange={(event) => update('price', event.target.value)} className={fieldClass('pl-9 pr-20 text-lg font-semibold tnum')} {...fieldProps('price')} />
                      <span aria-hidden="true" className="absolute inset-y-0 right-4 flex items-center text-sm text-sec">/ day</span>
                    </div>
                  </Field>
                  <Field label="Replacement value ($)" htmlFor="listing-value" error={invalid('value')}>
                    <input id="listing-value" inputMode="decimal" value={form.value} placeholder="What would a comparable replacement cost?"
                      onChange={(event) => update('value', event.target.value)} className={fieldClass()} {...fieldProps('value')} />
                    <p className="text-xs text-sec mt-2">Used to calculate protection and the refundable deposit. Maximum ${policy.max_estimated_value.toLocaleString('en-US')}.</p>
                  </Field>
                  </div>
                  <section className="listing-choice-section space-y-4" aria-labelledby="longer-rental-prices">
                    <h3 id="longer-rental-prices" className="font-semibold text-main">Longer rentals <span className="font-normal text-sec">(optional)</span></h3>
                    {(['weekly', 'monthly'] as const).map(period => {
                      const weekly = period === 'weekly';
                      const days = weekly ? 7 : 30;
                      const rateKey = weekly ? 'weeklyRate' : 'monthlyRate';
                      const rateField = weekly ? 'weekly-rate' : 'monthly-rate';
                      const pricing = weekly ? form.weeklyPricing : form.monthlyPricing;
                      const discountKey = weekly ? 'weeklyDiscount' : 'monthlyDiscount';
                      const selectedDiscount = form[discountKey];
                      const options = weekly ? ['5', '10', '15', '20'] : ['10', '15', '20', '30'];
                      if (pricing === 'discount' && !options.includes(selectedDiscount)) options.push(selectedDiscount);
                      return <fieldset key={period} className="listing-duration-choice">
                        <legend className="text-sm font-semibold">Discount for a {days}-day rental</legend>
                        <div className="listing-duration-options">
                          <label><input type="radio" name={`${period}-price`} checked={pricing === 'daily'} onChange={() => updateLongerPricing(period, 'daily')} /> None</label>
                          {durationDiscountFlag.enabled && options.map(discount => <label key={discount}>
                            <input type="radio" name={`${period}-price`} checked={pricing === 'discount' && selectedDiscount === discount} onChange={() => {
                              update(discountKey, discount);
                              updateLongerPricing(period, 'discount');
                            }} /> {discount}% off
                          </label>)}
                          {editId && <label><input type="radio" name={`${period}-price`} checked={pricing === 'fixed'} onChange={() => updateLongerPricing(period, 'fixed')} /> Fixed price</label>}
                        </div>
                        {pricing === 'fixed' && <Field label={`${days}-day total (USD)`} htmlFor={`listing-${rateField}`} error={invalid(rateField)}>
                          <input id={`listing-${rateField}`} inputMode="decimal" value={form[rateKey]} onChange={event => update(rateKey, event.target.value)}
                            className={fieldClass()} aria-invalid={Boolean(invalid(rateField))}
                            aria-describedby={invalid(rateField) ? `listing-${rateField}-error` : undefined} />
                        </Field>}
                        {pricing === 'discount' && !durationDiscountFlag.enabled && <p className="text-sm text-sec">Discounts are currently paused.</p>}
                      </fieldset>;
                    })}
                    <p className="text-xs text-sec">A 30-day total takes priority over the 7-day total. Changes apply to new bookings.</p>
                  </section>
                </section>
                <section aria-label="Booking approval settings" className="space-y-5">
                <Field label="How many do you have?" htmlFor="listing-quantity" error={invalid('quantity')}>
                  <input id="listing-quantity" type="number" min={1} max={policy.max_quantity} step={1} value={form.quantity || ''}
                    onChange={event => update('quantity', Number(event.target.value))} className={fieldClass()}
                    aria-invalid={Boolean(invalid('quantity'))} aria-describedby={invalid('quantity') ? 'listing-quantity-error' : undefined} />
                  <p className="text-xs text-sec mt-2">Identical items you can rent out. Maximum {policy.max_quantity}.</p>
                </Field>
                <fieldset className="space-y-3"><legend className="text-sm font-semibold text-main mb-2">How should bookings work?</legend>
                  <div className="listing-duration-options">
                  {[{ value: false, label: 'I’ll approve each request' }, { value: true, label: 'Let people book instantly' }].map((option) => <label key={option.label}>
                    <input type="radio" name="booking-mode" checked={form.instant === option.value} onChange={() => update('instant', option.value)} />
                    {option.label}</label>)}
                  </div>
                </fieldset>
                </section>
                </div>
                {priceForPreview > 0 && earningsQuotes && <div className="listing-earnings space-y-2 text-sm">
                  <h3 className="font-semibold text-main">What you could earn</h3>
                  {[1, 7, 30].map(days => {
                    const quote = earningsQuotes[days];
                    return quote && <div key={days} className="flex justify-between gap-3">
                      <span className="text-sec">{days === 1 ? 'Per day' : days === 7 ? 'Per week' : 'Per month'} · owner fee ${quote.owner_service_fee_amount?.toFixed(2)}</span>
                      <strong className="text-main tnum">${quote.estimated_owner_net?.toFixed(2)}</strong>
                    </div>;
                  })}
                  <p className="text-xs text-sec">Estimate only. Final rates and fees are set when a booking is created.</p>
                </div>}
                {earningsQuoteError && <Alert tone="error" title="Earnings estimate unavailable">{earningsQuoteError}</Alert>}
              </>}
              {step === 4 && <>
                <ListingAvailabilityPicker start={form.start} end={form.end} today={availabilityToday}
                  error={invalid('availability')} onChange={(start, end) => { setForm(current => ({ ...current, start, end })); changed(); }} />
                {retainedAvailability && <p className="text-xs text-sec">Your saved listing dates are retained until you select a new range.</p>}
              </>}
              {step === 5 && <>
                <div className="listing-location-sections space-y-4 min-w-0">
                  <div aria-invalid={Boolean(invalid('pickup'))} aria-describedby={invalid('pickup') ? 'listing-pickup-error' : undefined} tabIndex={-1}>
                  <PickupLocation error={invalid('pickup')} value={pickup} onChange={(next) => {
                    setPickup(next);
                    setPickupConfirmed(Boolean(next.formattedAddress && next.streetAddress && next.city && next.state
                      && next.postalCode && next.country && next.timeZone && (next.placeId || next.manualConfirmed)));
                    changed();
                  }} />
                  {invalid('pickup') && <p id="listing-pickup-error" role="alert" className="text-sm text-error">{invalid('pickup')}</p>}
                  </div>
                  <div id="listing-handoff-details" tabIndex={-1} aria-invalid={Boolean(invalid('handoff-details'))} aria-describedby={invalid('handoff-details') ? 'listing-handoff-details-error' : undefined} className="space-y-4">
                  {invalid('handoff-details') && <p id="listing-handoff-details-error" role="alert" className="text-sm text-error">{invalid('handoff-details')}</p>}
                  <section className="listing-choice-section space-y-4" aria-labelledby="handoff-times">
                    <h3 id="handoff-times" className="text-sm font-semibold text-main">When works for you?</h3>
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-main">Pickup windows</p>
                      <p className="text-xs text-sec">Each time starts a one-hour window in your pickup time zone.</p>
                      <div className="flex flex-wrap gap-2">{HANDOFF_WINDOWS.map((window) => <button key={`pickup-${window}`} type="button"
                        className={`min-h-11 rounded-full border px-3 text-sm ${form.itemDetails.pickup_windows.includes(window)
                          ? 'bg-accent text-accent-text border-accent' : 'bg-card text-sec border-strong'}`}
                        aria-pressed={form.itemDetails.pickup_windows.includes(window)}
                        onClick={() => toggleWindow('pickup_windows', window)}>{HANDOFF_WINDOW_LABELS[window]}</button>)}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-main">Return windows</p>
                      <div className="flex flex-wrap gap-2">{HANDOFF_WINDOWS.map((window) => <button key={`return-${window}`} type="button"
                        className={`min-h-11 rounded-full border px-3 text-sm ${form.itemDetails.return_windows.includes(window)
                          ? 'bg-accent text-accent-text border-accent' : 'bg-card text-sec border-strong'}`}
                        aria-pressed={form.itemDetails.return_windows.includes(window)}
                        onClick={() => toggleWindow('return_windows', window)}>{HANDOFF_WINDOW_LABELS[window]}</button>)}
                      </div>
                    </div>
                  </section>
                    <fieldset className="listing-choice-section space-y-3">
                      <legend className="sr-only">Delivery options</legend>
                      <label className="flex items-center gap-2 min-h-11 text-sm font-semibold">
                        <input type="checkbox" checked={form.delivery} onChange={(event) => update('delivery', event.target.checked)} className="h-5 w-5 accent-[var(--accent)]" />
                        I can also deliver (pickup is always included)
                      </label>
                      {form.delivery && <Field label="Delivery fee per trip (USD)" htmlFor="listing-delivery" error={invalid('delivery')}>
                        <input id="listing-delivery" type="number" min={1} max={policy.max_delivery_fee} step="0.01" inputMode="decimal" value={form.deliveryFee} onChange={(event) => update('deliveryFee', event.target.value)} placeholder="25.00" aria-invalid={Boolean(invalid('delivery'))} aria-describedby={invalid('delivery') ? 'listing-delivery-error' : undefined} className={fieldClass('mt-2')} />
                        <p className="text-xs text-sec mt-2">$1–${policy.max_delivery_fee} per trip. Renters see this fee separately when they choose delivery.</p>
                      </Field>}
                      {form.delivery && <Field label="Delivery radius (optional)" htmlFor="listing-delivery-radius">
                        <select id="listing-delivery-radius" value={form.itemDetails.delivery_radius_miles ?? ''} className={fieldClass()}
                          onChange={event => updateItemDetails('delivery_radius_miles', event.target.value ? Number(event.target.value) : null)}>
                          <option value="">Choose a radius</option>{[5, 10, 25, 50].map(miles => <option key={miles} value={miles}>Within {miles} miles</option>)}
                        </select>
                        <p className="mt-2 text-xs text-sec">Your declared delivery area, not an automatic address or checkout restriction.</p>
                      </Field>}
                    </fieldset>
                    {editId && <fieldset className="listing-choice-section space-y-3">
                    <legend className="text-sm font-semibold text-main mb-2">Anything to do before it comes back? <span className="font-normal text-sec">(optional)</span></legend>
                    <div className="flex flex-wrap gap-2">{RETURN_RULE_OPTIONS.map((rule) => <button key={rule} type="button"
                      className={`min-h-11 rounded-full border px-3 text-sm text-left ${form.itemDetails.return_rules.includes(rule)
                        ? 'bg-accent text-accent-text border-accent' : 'bg-card text-sec border-strong'}`}
                      aria-pressed={form.itemDetails.return_rules.includes(rule)}
                      onClick={() => toggleReturnRule(rule)}>{rule}</button>)}
                    </div>
                    </fieldset>}
                    <Field label="Return note (optional)" htmlFor="listing-return-note">
                      <textarea id="listing-return-note" value={form.itemDetails.return_note} maxLength={240} rows={2}
                        placeholder="Place lens cap and charger in the case before handoff."
                        onChange={event => updateItemDetails('return_note', event.target.value)} className={textareaClass()} />
                      <p className="text-xs text-sec text-right mt-1">{form.itemDetails.return_note.length}/240</p>
                    </Field>
                  </div>
                </div>
              </>}
              {step === 6 && <>
                {status === 'archived' && <p role="status" className="rounded-card-lg bg-subtle p-4 text-sm text-sec">This listing is archived. Saving changes here will keep it archived; it will not become visible to renters.</p>}
                {status === 'suspended' && <p role="status" className="rounded-card-lg bg-warning-soft p-4 text-sm text-sec">This listing is suspended. You can save corrections, but it will stay hidden until it is reviewed.</p>}
                <div className="owner-listing-review min-w-0 space-y-4">
                <div className="listing-review-card">
                  {photos[0] && <img src={photos[0]} alt="" />}
                  <div className="min-w-0">
                    <p className="text-sm text-sec">{categories.find((category) => category.id === form.categoryId)?.name} &middot; {CONDITION_LABELS[form.condition]}</p>
                    <h3 className="mt-2 text-xl font-bold text-main break-words">{form.title}</h3>
                    <p className="mt-2 text-sm text-sec whitespace-pre-wrap">{form.description}</p>
                    <Button size="sm" variant="ghost" aria-label="Edit item details" onClick={() => { setStep(2); setAttempted(false); }}>Edit item</Button>
                  </div>
                </div>
                <div className="listing-review-details">
                  <section>
                    <div className="listing-review-heading"><h3>Price &amp; booking</h3><Button size="sm" variant="ghost" aria-label="Edit price" onClick={() => { setStep(3); setAttempted(false); }}>Edit</Button></div>
                    <p><strong>${form.price}</strong> per day</p>
                    <p>Estimated replacement value: ${form.value}</p>
                    <p>7 days: {longerPrice('weekly')} &middot; 30 days: {longerPrice('monthly')}</p>
                    <p>{form.quantity} {form.quantity === 1 ? 'unit' : 'units'} &middot; {form.instant ? 'Instant booking' : 'Review requests'}</p>
                  </section>
                  <section>
                    <div className="listing-review-heading"><h3>Availability</h3><Button size="sm" variant="ghost" aria-label="Edit dates" onClick={() => { setStep(4); setAttempted(false); }}>Edit</Button></div>
                    <p>{formatListingDate(form.start)} – {formatListingDate(addDaysIso(form.end, -1))}</p>
                    <p>Return by {formatListingDate(form.end)}</p>
                  </section>
                  <section>
                    <div className="listing-review-heading"><h3>Pickup &amp; return</h3><Button size="sm" variant="ghost" aria-label="Edit pickup" onClick={() => { setStep(5); setAttempted(false); }}>Edit</Button></div>
                    <p>{formatPickupAddress(pickup)}</p>
                    <p>{form.delivery ? `Delivery $${form.deliveryFee} per trip` : 'No delivery'}</p>
                    <p>Pickup: {pickupWindows}</p>
                    <p>Return: {returnWindows}</p>
                  </section>
                </div>
                {form.itemDetails.included_items.length > 0 && <section><h3 className="text-sm font-semibold mb-2">What's included</h3><ul className="flex flex-wrap gap-2">
                  {form.itemDetails.included_items.map(item => <li key={item} className="rounded-card bg-subtle px-2 py-1 text-xs text-sec">{item}</li>)}</ul></section>}
                {form.itemDetails.return_rules.length > 0 && <section><h3 className="text-sm font-semibold mb-2">Return expectations</h3><ul className="space-y-1">
                  {form.itemDetails.return_rules.map(rule => <li key={rule} className="text-xs text-sec">• {rule}</li>)}</ul></section>}
                {form.itemDetails.return_note && <section><h3 className="text-sm font-semibold mb-2">Return note</h3><p className="text-xs text-sec whitespace-pre-wrap">{form.itemDetails.return_note}</p></section>}
                {form.itemDetails.additional_details && <section><h3 className="text-sm font-semibold mb-2">Additional details</h3><p className="text-xs text-sec whitespace-pre-wrap">{form.itemDetails.additional_details}</p></section>}
                <p className="text-sm leading-relaxed text-sec">Your exact pickup address stays private until an eligible booking is confirmed.</p>
                {blockingFlags.length > 0 && <Alert tone="error" title="Does not meet Community Guidelines">{blockingFlags.map((flag) => flag.reason).join(' ')} <Button variant="secondary" onClick={() => setStep(2)}>Review details</Button></Alert>}
                <div className="rounded-card-lg border border-app bg-subtle p-4 text-xs text-sec"><ShieldCheck aria-hidden="true" size={18} className="text-accent mb-2" />{policy.high_value_threshold === null || Number(form.value) > policy.high_value_threshold ? 'This item needs review before it can go live.' : 'Your listing will be checked before it goes live.'}</div>
                {biddingFlag.error
                  ? <Alert tone="error" title="Bidding settings unavailable">{biddingFlag.error}</Alert>
                  : !biddingFlag.loading && !biddingFlag.enabled
                    ? <p className="text-xs text-sec">Competitive bidding is currently unavailable.</p>
                    : biddingFlag.enabled && status === 'draft'
                      ? <Alert tone="info" title="Bidding is available after publication">
                        {policy.high_value_threshold === null || !form.value.trim() || Number(form.value) > policy.high_value_threshold
                          ? 'This listing needs administrative approval before it can go live. After approval, choose Bidding settings in My listings.'
                          : 'After publishing, you can optionally set up bidding from the confirmation page or My listings.'}
                      </Alert>
                      : biddingFlag.enabled && status === 'pending_approval'
                        ? <Alert tone="info" title="Bidding is available after approval">Once your listing is approved and live, choose Bidding settings in My listings.</Alert>
                        : null}
                </div>
                  {status === 'published' && <ListingNegotiationSettings listingId={listingId!} />}
              </>}
            </fieldset>
            {publishError && <div role="alert" className="px-5 sm:px-6 pb-4"><Alert tone="error" title="Your listing has not been published">
              <p>{status === 'draft' && version === savedVersion ? 'Your draft is saved. ' : 'Your entries are kept. '}{publishError}</p>
              <Button variant="secondary" className="mt-3" disabled={working || saving} onClick={() => void publish()}>Retry publication</Button>
              <Button variant="ghost" className="mt-3" disabled={working || saving} onClick={() => navigate({ name: 'support' })}>Contact support or report an issue</Button>
            </Alert></div>}
            <div className="owner-listing-actions border-t border-app bg-card px-4 sm:px-8 py-4 flex flex-wrap items-center justify-between gap-3">
              <Button variant="secondary" disabled={step === 1 || working || saving} onClick={() => void goBack()}>Back</Button>
              <div className="flex min-w-0 flex-wrap gap-2">
                <Button disabled={working || saving} loading={working && (step === 1 || step === 2 || step === STEPS.length)} loadingLabel={step === 1 ? 'Preparing details...' : step === 2 ? 'Checking details...' : 'Publishing...'}
                  onClick={() => step === STEPS.length ? void publish() : continueStep()}>{nextLabel}</Button>
              </div>
            </div>
          </section>
          </div>
        </div>
      </div>
    </div>
  );
}
