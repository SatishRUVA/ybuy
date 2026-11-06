import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, ArrowRight, BellRing, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, ImagePlus, MapPin, Minus, Plus, Save, ShieldCheck, Sparkles, Truck, X, Zap } from 'lucide-react';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import type { Category } from '@/data';
import { fetchCategories, toUiCategory, createDraftListing, deleteOwnerListing, uploadListingPhoto, removeListingImageUrl, saveListingImageOrder, fetchListingById, fetchOwnerPickup } from '@/lib/listings';
import { getListingFlowPolicy, saveListingFlow, type ListingFlowPolicy, type ListingFlowDetails } from '@/lib/listing-flow';
import { moderateListingContent, type ListingFlag } from '@/lib/listing-ai';
import { LISTING_RULES, LISTING_FIELD_IDS, ITEM_STEP_FIELDS, parseMoney, validateListing, type ListingField } from '@/lib/listing-rules';
import { todayIso, addDaysIso } from '@/lib/geo';
import { pickupTimeZone, pickupToday } from '@/lib/pickup-timezone';
import { HANDOFF_WINDOW_LABELS } from '@/lib/handoff-hours';
import { Button, Alert, Surface, Field, IconButton } from '@/main-site/components/ui';
import { fieldClass, textareaClass } from '@/main-site/components/form-classes';
import { PickupLocation, type PickupLocationValue } from '@/main-site/components/pickup-location';
import { ListingPhotoEditor } from '@/main-site/components/listing-photo-editor';
import { ListingNegotiationSettings } from '@/main-site/components/listing-negotiation-settings';
import { ListingAvailabilityPicker } from '@/main-site/components/listing-availability-picker';
import { LISTING_MAX_AVAILABLE_DAYS, listingAvailabilityError } from '@/lib/listing-availability';
import { SuccessFeedback } from '@/main-site/components/success-feedback';
import { ListingAiSkeleton, Skeleton } from '@/main-site/components/skeleton';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from '@/main-site/components/shadcn/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/main-site/components/shadcn/dialog';
import {
  EMPTY_ITEM_DETAILS,
  HANDOFF_WINDOWS,
  RETURN_RULE_OPTIONS,
  listingItemDetailsError,
  type HandoffWindow,
  type ListingItemDetails,
} from '@/lib/listing-item-details';
import { useFeatureFlag } from '@/lib/use-feature-flags';
import { calculateRentalPricing } from '@/lib/rental-pricing';
import { fetchMainItemRequest, type MainItemRequest } from '../request-flow';
import { RequestFulfillment } from '../components/request-fulfillment';

const STEPS = ['Photos', 'Details', 'Rental settings', 'Availability', 'Location', 'Review'] as const;
const STEP_TITLES = ['Add photos of your item', 'Review and edit item details', 'Set rental settings', 'Set availability', 'Set location and handoff options', 'Review and publish'];
const EMPTY_PICKUP: PickupLocationValue = { formattedAddress: '', streetAddress: '', city: '', state: '', postalCode: '', country: '', latitude: null, longitude: null, placeId: '' };
const CONDITION_LABELS: Record<string, string> = { new: 'New', like_new: 'Like new', good: 'Good', fair: 'Fair' };
const formatListingDate = (date: string) => date ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Choose date';
type Form = {
  title: string; categoryId: string; description: string; value: string; condition: string; price: string;
  weeklyDiscountEnabled: boolean; weeklyDiscount: string; monthlyDiscountEnabled: boolean; monthlyDiscount: string;
  instant: boolean; delivery: boolean; deliveryFee: string; quantity: number; start: string; end: string;
  itemDetails: ListingItemDetails;
};
const EMPTY_FORM: Form = { title: '', categoryId: '', description: '', value: '', condition: '', price: '', weeklyDiscountEnabled: true, weeklyDiscount: '20', monthlyDiscountEnabled: true, monthlyDiscount: '30', instant: false, delivery: false, deliveryFee: '', quantity: 1, start: '', end: '', itemDetails: EMPTY_ITEM_DETAILS };
type FlowErrors = Partial<Record<ListingField | 'availability' | 'delivery' | 'quantity' | 'item-details', string>>;
const message = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

export function CreateListingPage({ editId, requestId }: { editId?: string; requestId?: string }) {
  const { navigate } = useRouter();
  const { profile } = useAuth();
  const durationDiscountFlag = useFeatureFlag('duration_discounts');
  const biddingFlag = useFeatureFlag('bidding');
  const reducedMotion = useReducedMotion();
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const priceForPreview = parseMoney(form.price) ?? 0;
  const weeklyPreview = calculateRentalPricing(priceForPreview, 7, { weeklyEnabled: true, weeklyPercent: Number(form.weeklyDiscount) || 0 });
  const monthlyPreview = calculateRentalPricing(priceForPreview, 30, { monthlyEnabled: true, monthlyPercent: Number(form.monthlyDiscount) || 0 });
  const formRef = useRef(form);
  formRef.current = form;
  const [photos, setPhotos] = useState<string[]>([]);
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
  const [biddingDialogOpen, setBiddingDialogOpen] = useState(false);
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
  const [warnings, setWarnings] = useState<Record<string, string>>({});
  const [qualitySuggestions, setQualitySuggestions] = useState<Record<string, string>>({});
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number; text: string } | null>(null);
  const [preparingDetails, setPreparingDetails] = useState(false);
  const [failedUploads, setFailedUploads] = useState<{ file: File; replaceUrl?: string; error: string }[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null);
  const [previewPhoto, setPreviewPhoto] = useState(0);
  const [includedItem, setIncludedItem] = useState('');
  const [includedError, setIncludedError] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const originalWindow = useRef<{ start: string; end: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const summary = useRef<HTMLDivElement>(null);
  const resetButton = useRef<HTMLButtonElement | null>(null);
  const resumeKey = profile ? `ybuy-listing-draft:${profile.id}` : null;

  function changed() {
    versionRef.current += 1;
    setVersion(versionRef.current);
    setNotice(null);
  }
  function update<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((current) => ({ ...current, [key]: value }));
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
        let resumeId = editId;
        if (!resumeId) {
          try { resumeId = localStorage.getItem(`ybuy-listing-draft:${profile.id}`) ?? undefined; }
          catch (error) { console.warn('Draft resume storage is unavailable.', error); }
        }
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
        if (resumeId && (!row || row.owner_id !== profile.id)) {
          if (editId) throw new Error('Listing not found or not owned by your account.');
          try { localStorage.removeItem(`ybuy-listing-draft:${profile.id}`); }
          catch (error) { console.warn('Could not clear the stale draft pointer.', error); }
        }
        const ownRow = row?.owner_id === profile.id && (editId || row.status === 'draft') ? row : null;
        const savedPickup = ownRow ? await fetchOwnerPickup(ownRow.id) : null;
        if (!active) return;
        setPolicy(nextPolicy);
        setCategories(rows.map((category) => toUiCategory(category, new Map())));
        setSourceRequest(request);
        if (ownRow) {
          if (!Number.isSafeInteger(ownRow.revision)) throw new Error('Listing editing requires the latest database migration.');
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
            price: String(ownRow.price_per_day), weeklyDiscountEnabled: ownRow.weekly_discount_enabled === true, weeklyDiscount: String(ownRow.weekly_discount_enabled && Number(ownRow.weekly_discount_percent) <= 0 ? 20 : ownRow.weekly_discount_percent ?? 20), monthlyDiscountEnabled: ownRow.monthly_discount_enabled === true, monthlyDiscount: String(ownRow.monthly_discount_enabled && Number(ownRow.monthly_discount_percent) <= 0 ? 30 : ownRow.monthly_discount_percent ?? 30), instant: ownRow.instant_booking, delivery: ownRow.delivery_available,
            deliveryFee: String(ownRow.delivery_fee ?? 0), quantity: ownRow.available_quantity,
            start: ownRow.availability_start ?? todayIso(), end: ownRow.availability_end ?? addDaysIso(todayIso(), Math.min(LISTING_MAX_AVAILABLE_DAYS, nextPolicy.listing_duration_days)),
            itemDetails: { brand: ownRow.brand ?? '', model: ownRow.model ?? '', included_items: ownRow.included_items ?? [],
              additional_details: ownRow.additional_details ?? '', delivery_radius_miles: ownRow.delivery_radius_miles ?? null,
              pickup_windows: ownRow.pickup_windows && ownRow.pickup_windows.length > 0 ? ownRow.pickup_windows : [...HANDOFF_WINDOWS],
              return_windows: ownRow.return_windows && ownRow.return_windows.length > 0 ? ownRow.return_windows : [...HANDOFF_WINDOWS],
              return_rules: ownRow.return_rules ?? [],
              return_note: ownRow.return_note ?? '' },
          });
          setPhotos([...ownRow.listing_images].sort((a, b) => a.sort_order - b.sort_order).map((image) => image.url));
          const hasSavedDetails = Boolean(ownRow.title.trim() || ownRow.description?.trim());
          editedFields.current = {
            title: Boolean(ownRow.title.trim()),
            description: Boolean(ownRow.description?.trim()),
            // Empty photo-only drafts use the first category only to satisfy the draft insert.
            categoryId: ownRow.status !== 'draft' || hasSavedDetails,
            brand: Boolean(ownRow.brand?.trim()),
            model: Boolean(ownRow.model?.trim()),
          };
          if (savedPickup) { setPickup(savedPickup); setPickupConfirmed(true); }
          setNotice(ownRow.status === 'draft' ? 'Your saved draft is ready to continue.' : 'Photo edits save immediately. Other changes save when you choose Save changes.');
          if (editId) setStep(2);
        } else {
          setForm({ ...EMPTY_FORM, start: todayIso(), end: addDaysIso(todayIso(), Math.min(LISTING_MAX_AVAILABLE_DAYS, nextPolicy.listing_duration_days)),
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

  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [step]);
  useEffect(() => {
    if (!focusTarget) return;
    const target = document.getElementById(focusTarget);
    target?.focus();
    target?.scrollIntoView({ block: 'center' });
    setFocusTarget(null);
  }, [step, focusTarget]);

  useEffect(() => {
    if (version === savedVersion) return;
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [version, savedVersion]);

  async function ensureDraft(): Promise<string> {
    if (idRef.current) return idRef.current;
    if (draftCreation.current) return draftCreation.current;
    if (!profile || !categories[0]) throw new Error('Categories and your account must be available before saving.');
    draftCreation.current = createDraftListing(profile.id, categories[0].id).then(async (id) => {
      idRef.current = id;
      setListingId(id);
      if (resumeKey) {
        try { localStorage.setItem(resumeKey, id); }
        catch (error) { console.warn('Could not remember the saved draft on this device.', error); setNotice('Draft created. Resume it from My listings.'); }
      }
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
  const availabilityToday = pickupConfirmed && pickup.latitude !== null && pickup.longitude !== null
    ? pickupToday(pickupTimeZone(pickup.latitude, pickup.longitude)) : todayIso();
  const errors: FlowErrors = validateListing({
    photoCount: photos.length, title: form.title, categoryId: form.categoryId, description: form.description,
    pickupConfirmed, pickupFields, priceText: form.price, depositText: '0', valueText: form.value, maxValue: policy?.max_estimated_value, condition: form.condition,
  });
  delete errors.deposit;
  const retainedAvailability = status !== 'draft' && originalWindow.current?.start === form.start && originalWindow.current?.end === form.end;
  if (!retainedAvailability) {
    const availabilityError = listingAvailabilityError(form.start, form.end, availabilityToday);
    if (availabilityError) errors.availability = availabilityError;
  }
  if (!Number.isInteger(form.quantity) || form.quantity < 1 || (policy && form.quantity > policy.max_quantity)) errors.quantity = 'Choose an allowed number of identical units.';
  const deliveryFee = parseMoney(form.deliveryFee || '0');
  if (form.delivery && (deliveryFee === null || deliveryFee < 1 || (policy && deliveryFee > policy.max_delivery_fee))) errors.delivery = `Enter a delivery fee between $1 and $${policy?.max_delivery_fee ?? 99}.`;
  const itemError = listingItemDetailsError(form.itemDetails);
  if (itemError) errors['item-details'] = itemError;
  const fieldsForStep: (keyof FlowErrors)[] = step === 1 ? ['photos'] : step === 2
    ? [...ITEM_STEP_FIELDS.filter((field) => field !== 'photos' && field !== 'value'), 'item-details'] : step === 3
      ? ['price', 'value', 'quantity'] : step === 4 ? ['availability'] : step === 5 ? ['pickup', 'delivery', 'item-details'] : Object.keys(errors) as (keyof FlowErrors)[];
  const visibleErrors = attempted ? fieldsForStep.filter((field) => errors[field]) : [];
  const blockingFlags = flags.filter((flag) => flag.confidence === 'high' && ['prohibited_item', 'drug_related'].includes(flag.type));

  async function persist(publish: boolean): Promise<boolean> {
    setAttempted(true);
    if (fieldsForStep.some(field => errors[field])) {
      requestAnimationFrame(() => summary.current?.focus());
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
        const weeklyEnabled = current.weeklyDiscountEnabled && (durationDiscountFlag.enabled || Boolean(editId));
        const monthlyEnabled = current.monthlyDiscountEnabled && (durationDiscountFlag.enabled || Boolean(editId));
        const price = current.price.trim() ? parseMoney(current.price) : 1;
        const value = current.value.trim() ? parseMoney(current.value) : null;
        if ((step === 3 || step === STEPS.length) && (price === null || price < LISTING_RULES.price.min || price > LISTING_RULES.price.max)) throw new Error('Enter a valid daily rental price before saving. Your entry has been kept.');
        for (const discount of [current.weeklyDiscount, current.monthlyDiscount]) {
          if (discount && (!/^\d{1,2}(\.\d{1,2})?$/.test(discount) || Number(discount) > 50)) throw new Error('Discounts must be between 0% and 50%.');
        }
        const id = await ensureDraft();
        const allDetails: ListingFlowDetails = {
          title: current.title.trim(), description: current.description.trim(), category_id: current.categoryId || categories[0].id,
          price_per_day: price ?? undefined, estimated_value: value, item_condition: current.condition || null,
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
          ['price_per_day', 'weekly_discount_enabled', 'weekly_discount_percent', 'monthly_discount_enabled', 'monthly_discount_percent', 'estimated_value', 'instant_booking', 'available_quantity'],
          ['availability_start', 'availability_end'],
          ['location_label', 'delivery_available', 'delivery_fee', 'item_details'],
        ];
        const details: ListingFlowDetails = step === STEPS.length ? allDetails : Object.fromEntries(
          Object.entries(allDetails).filter(([key]) => stepKeys[step - 1].includes(key as keyof ListingFlowDetails)),
        );
        const confirmedPickup = step >= 5 && pickupConfirmed && pickup.latitude !== null && pickup.longitude !== null
          ? { ...pickup, latitude: pickup.latitude, longitude: pickup.longitude } : undefined;
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
          if (result.status !== 'published' && result.status !== 'pending_approval') throw new Error('The backend has not confirmed publication. Your listing has not been marked live.');
          if (status !== 'published' && result.status === 'published' && biddingFlag.enabled) setBiddingDialogOpen(true);
          setCompleted(true);
          if (resumeKey) {
            try { localStorage.removeItem(resumeKey); } catch (error) { console.warn('Could not clear the saved draft pointer.', error); }
          }
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

  async function analyze(id: string, urls: string[]) {
    if (!urls.length) { setFlags([]); return; }
    const run = ++aiRun.current;
    setAiLoading(true); setAiError(null);
    try {
      const result = await moderateListingContent({ listingId: id, photoUrls: urls, title: formRef.current.title, description: formRef.current.description });
      if (run !== aiRun.current) return;
      setFlags(result.flags);
      setQualitySuggestions(Object.fromEntries(result.photoQualitySuggestions.filter((item) => urls[item.photoIndex])
        .map((item) => [urls[item.photoIndex], `${item.reason} ${item.recommendation}`])));
      if (!result.suggestion) throw new Error(result.aiError || 'AI could not identify enough details. Please describe the item yourself.');
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
    } catch (error) {
      if (run === aiRun.current) setAiError(message(error, 'AI suggestions are unavailable. Continue manually.'));
    } finally { if (run === aiRun.current) setAiLoading(false); }
  }

  async function upload(files: File[], replacing?: number) {
    if (operation.current || !policy) return;
    operation.current = true; setWorking(true); setPhotoError(null); setSaveError(null);
    const failures: typeof failedUploads = [];
    const next = [...photos];
    try {
      if (saveInFlight.current && !await saveInFlight.current) throw new Error('Retry the draft save before changing photos.');
      const slots = replacing === undefined ? policy.max_photos - photos.length : 1;
      if (files.length > slots) setPhotoError(`Only ${slots} more ${slots === 1 ? 'photo is' : 'photos are'} allowed. The remaining files were not uploaded.`);
      if (slots < 1) return;
      const accepted = files.slice(0, slots);
      const id = await ensureDraft();
      for (const [index, file] of accepted.entries()) {
        setUploadProgress({ done: index, total: accepted.length, text: `Uploading photo ${index + 1} of ${accepted.length}` });
        try {
          if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose JPEG, PNG, or WebP.');
          if (file.size > policy.max_photo_bytes) throw new Error(`Use a photo smaller than ${Math.round(policy.max_photo_bytes / 1048576)} MB.`);
          const bitmap = await createImageBitmap(file);
          const { width, height } = bitmap; bitmap.close();
          if (width < policy.min_photo_dimension || height < policy.min_photo_dimension) throw new Error(`This photo is too small (${width} x ${height} pixels). Choose a larger original photo, at least ${policy.min_photo_dimension} x ${policy.min_photo_dimension} pixels, then upload it again.`);
          const result = await uploadListingPhoto(id, file, replacing ?? next.length, replacing === undefined ? undefined : next[replacing]);
          if (replacing === undefined) next.push(result.url); else next[replacing] = result.url;
          setPhotos([...next]);
          if (result.warning || width < 1000 || height < 1000) setWarnings((current) => ({ ...current, [result.url]: result.warning ?? 'Try a higher-resolution, well-lit photo so renters can inspect the item.' }));
          changed();
        } catch (error) {
          failures.push({ file, replaceUrl: replacing === undefined ? undefined : photos[replacing], error: message(error, 'Upload failed. Retry this photo.') });
        } finally {
          setUploadProgress({ done: index + 1, total: accepted.length, text: index + 1 === accepted.length ? 'Finishing your photo uploads' : `Added ${index + 1} of ${accepted.length} photos` });
        }
      }
      await refreshRevision(id);
      setUploadProgress({ done: accepted.length, total: accepted.length, text: 'Photo uploads finished' });
      if (!photos.length && next.length) void analyze(id, next);
    } catch (error) { setSaveError(message(error, 'Could not prepare your photos.')); }
    finally {
      setFailedUploads((current) => [...current.filter((item) => !files.includes(item.file)), ...failures]);
      setUploadProgress(null); setWorking(false); operation.current = false;
    }
  }

  async function mutatePhotos(action: () => Promise<string[]>) {
    if (operation.current || !listingId) return;
    operation.current = true; setWorking(true); setSaveError(null);
    try {
      if (saveInFlight.current && !await saveInFlight.current) throw new Error('Retry saving before changing photos.');
      const next = await action();
      setPhotos(next); changed();
      await refreshRevision(listingId);
      setFlags([]);
    } catch (error) { setSaveError(message(error, 'Could not save the gallery change. Reload to check its saved state.')); }
    finally { operation.current = false; setWorking(false); }
  }

  function retryFailedUpload(item: (typeof failedUploads)[number]) {
    if (!item.replaceUrl) { void upload([item.file]); return; }
    const currentIndex = photos.indexOf(item.replaceUrl);
    if (currentIndex >= 0) { void upload([item.file], currentIndex); return; }
    if (photos.length < policy!.max_photos) { void upload([item.file]); return; }
    setPhotoError('The photo being replaced is no longer in the gallery. Remove a photo or choose a new one before retrying.');
  }

  async function continueStep() {
    if (saving || working) return;
    setAttempted(true);
    if (fieldsForStep.some((field) => errors[field])) { requestAnimationFrame(() => summary.current?.focus()); return; }
    setPreparingDetails(step === 1);
    try {
      if (!await persist(false)) return;
      setAttempted(false); setStep((current) => Math.min(STEPS.length, current + 1));
    } finally { setPreparingDetails(false); }
  }
  async function goBack() {
    if (step > 1) { setStep(step - 1); setAttempted(false); return; }
    if (versionRef.current !== savedVersionRef.current) {
      if (status !== 'draft') { setSaveError('Review and save your changes before leaving this listing.'); return; }
      setSaveError('Use Continue or Save draft to save a valid step before leaving.');
      return;
    }
    navigate({ name: 'owner-dashboard' });
  }
  async function publish() {
    if (operation.current) return;
    setPublishError(null);
    setAttempted(true);
    if (Object.keys(errors).length || blockingFlags.length) { requestAnimationFrame(() => summary.current?.focus()); return; }
    aiRun.current += 1;
    setAiLoading(false);
    operation.current = true; setWorking(true);
    try {
      if (status === 'archived' || status === 'suspended') {
        await persist(false);
        return;
      }
      if (status === 'draft' && !await persist(false)) return;
      const currentDetails = formRef.current.itemDetails;
      const extraDetails = [currentDetails.brand, currentDetails.model, ...currentDetails.included_items, currentDetails.additional_details].filter(Boolean).join('\n');
      const result = await moderateListingContent({ listingId: await ensureDraft(), photoUrls: photos, title: formRef.current.title,
        description: [formRef.current.description, extraDetails].filter(Boolean).join('\n\n') }, 'publication');
      if (result) {
        setFlags(result.flags);
        if (result.flags.some((flag) => flag.confidence === 'high' && ['prohibited_item', 'drug_related'].includes(flag.type))) {
          setPublishError('This listing needs a policy review. Correct the affected content and contact support to review any persisted policy flags.');
          return;
        }
        if (result.masked.changed) {
          if (extraDetails) {
            setPublishError('Remove contact information from your item description, brand, model, included items or additional details before publishing.');
            setStep(2);
            return;
          }
          const next = { ...formRef.current, title: result.masked.title, description: result.masked.description };
          formRef.current = next;
          setForm(next);
          changed();
          setPublishError('Contact information was removed. Review the updated details before publishing.');
          setStep(2);
          return;
        }
      }
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
    if (!policy) return;
    aiRun.current += 1;
    idRef.current = null; revision.current = 1;
    versionRef.current = 0; savedVersionRef.current = 0;
    editedFields.current = { title: false, description: false, categoryId: false, brand: false, model: false };
    setForm({ ...EMPTY_FORM, start: todayIso(), end: addDaysIso(todayIso(), Math.min(LISTING_MAX_AVAILABLE_DAYS, policy.listing_duration_days)) });
    setListingId(null); setStatus('draft'); setCompleted(false); setPhotos([]);
    setPickup(EMPTY_PICKUP); setPickupConfirmed(false); setStep(1); setAttempted(false);
    setIncludedItem(''); setIncludedError(null);
    setVersion(0); setSavedVersion(0); setSaveError(null); setPublishError(null); setNotice(null); setShareCopied(false);
    setAiLoading(false); setAiApplied(false); setAiError(null); setFlags([]);
    setWarnings({}); setQualitySuggestions({}); setFailedUploads([]); setPhotoError(null);
    setReplaceIndex(null); setPreviewPhoto(0); setConfirmReset(false);
    originalWindow.current = null;
  }
  async function discardDraft() {
    if (operation.current || !profile || status !== 'draft') return;
    operation.current = true; setWorking(true); setSaveError(null);
    try {
      if (saveInFlight.current && !await saveInFlight.current) throw new Error('Retry saving before discarding this draft.');
      if (idRef.current) await deleteOwnerListing(profile.id, idRef.current);
      if (resumeKey) {
        try { localStorage.removeItem(resumeKey); }
        catch (error) { console.warn('Could not clear the discarded draft pointer.', error); }
      }
      startFresh();
      setNotice('Draft discarded. You can start again.');
    } catch (error) { setSaveError(message(error, 'Could not discard the draft. Your entries have been kept.')); }
    finally { operation.current = false; setWorking(false); }
  }

  if (loadError) return <div className="max-w-3xl mx-auto p-6"><Alert tone="error" title="Listing form unavailable">{loadError}</Alert><Button className="mt-4" onClick={() => window.location.reload()}>Retry</Button></div>;
  if (!ready || !policy) return <div className="max-w-5xl mx-auto p-6" aria-busy="true"><Skeleton className="h-20 mb-6" /><Skeleton className="h-96" /></div>;
  if (completed) return <div className="owner-listing min-h-screen px-4 sm:px-6 py-8 sm:py-12"><div className="max-w-3xl mx-auto space-y-6">
    {notice && <p role="status" className="text-sm text-accent">{notice}</p>}
    {status === 'published' ? <SuccessFeedback kind="listing" id={listingId!} title={form.title} image={photos[0]}
      onListAnother={editId ? undefined : startFresh}
      primary={{ label: 'View listing', onClick: () => navigate({ name: 'listing', id: listingId! }) }}
      secondary={{ label: 'Manage listing', onClick: () => navigate({ name: 'edit-listing', id: listingId! }) }}
      tertiary={{ label: shareCopied ? 'Copied!' : 'Share listing', onClick: () => void shareListing() }} />
      : <Surface className="p-6 sm:p-10"><ShieldCheck aria-hidden="true" size={32} className="text-accent mb-4" />
        <h1 className="text-2xl font-bold text-main">Submitted for review</h1><p role="status" className="text-sec mt-2">Your listing is not live yet. Review its status from My listings.</p>
        <p className="mt-4 font-semibold">{form.title}</p><Button className="mt-6" onClick={() => navigate({ name: 'owner-dashboard' })}>My listings</Button></Surface>}
    {status === 'published' && editId && !biddingDialogOpen && <ListingNegotiationSettings listingId={listingId!} />}
    {status === 'published' && biddingDialogOpen && <Dialog open={biddingDialogOpen} onOpenChange={setBiddingDialogOpen}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Your listing is live</DialogTitle>
          <DialogDescription>Set up competitive bidding now, or do it later by editing your listing.</DialogDescription>
        </DialogHeader>
        <ListingNegotiationSettings listingId={listingId!} />
        <DialogFooter>
          <Button variant="secondary" onClick={() => setBiddingDialogOpen(false)}>Do this later</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>}
    {status === 'published' && sourceRequest && <RequestFulfillment request={sourceRequest} publishedListingId={listingId!} />}
    {status === 'pending_approval' && sourceRequest && <div className="space-y-3">
      <p className="text-sm text-sec">Return after approval to notify the renter; pending listings cannot be linked or advertised as available.</p>
      <Button variant="secondary" onClick={() => navigate({ name: 'edit-listing', id: listingId!, requestId: sourceRequest.id })}>Review this listing and request</Button>
    </div>}
    {!editId && status !== 'published' && <div className="text-center"><Button variant="ghost" onClick={startFresh}>List another item</Button></div>}
  </div></div>;

  const invalid = (field: keyof FlowErrors) => attempted && fieldsForStep.includes(field) ? errors[field] : undefined;
  const fieldProps = (field: ListingField) => ({ 'aria-invalid': Boolean(invalid(field)), 'aria-describedby': invalid(field) ? `${LISTING_FIELD_IDS[field]}-error` : undefined });
  const nextLabel = step === STEPS.length ? editId && status !== 'draft' ? 'Save changes' : 'Publish listing' : 'Continue';
  const stepHeading = step === STEPS.length && status === 'archived' ? 'Review archived listing'
    : step === STEPS.length && status === 'suspended' ? 'Review listing changes' : STEP_TITLES[step - 1];
  const activePreview = Math.min(previewPhoto, Math.max(0, photos.length - 1));
  return (
    <div className="owner-listing min-h-screen pb-10">
      <div className={`owner-listing-shell mx-auto px-4 sm:px-6 pt-5 sm:pt-7 ${step === 3 ? 'owner-listing-shell--rental max-w-7xl' : step === 4 ? 'max-w-3xl' : 'max-w-xl'}`}>
        {sourceRequest && <Alert tone="info" title={`Listing for: ${sourceRequest.title}`}>
          Requested {sourceRequest.preferred_start_date} – {sourceRequest.preferred_end_date} in {sourceRequest.location_label}. Review the suggested details and enter your own item photos and pickup address.
        </Alert>}
        {sourceRequestError && <Alert tone="warning" title="Saved request context unavailable">{sourceRequestError}</Alert>}
        {sourceRequest && editId && status === 'published' && <RequestFulfillment request={sourceRequest} publishedListingId={listingId!} />}
        <div className="owner-listing-toolbar flex flex-wrap items-center justify-between gap-3 mb-2">
          <h1 className="text-lg sm:text-xl font-bold tracking-tight text-main">{editId ? 'Manage your listing' : 'Create a listing'}</h1>
          <div className="flex flex-wrap items-center gap-2">
          <span role="status" className="inline-flex items-center gap-2 text-xs text-sec min-h-11">
            <span aria-hidden="true" className={`h-2 w-2 rounded-full ${saveError ? 'bg-error' : 'bg-accent'}`} />{saving ? 'Saving...' : saveError ? 'Not saved - retry below' : version === savedVersion && listingId ? 'All changes saved' : listingId ? 'Unsaved changes' : 'Private draft'}
          </span>
          {status === 'draft' && <Button size="sm" variant="secondary" disabled={working || saving} loading={saving} icon={<Save aria-hidden="true" size={14} />} onClick={() => void persist(false)}>Save draft</Button>}
          {!editId && status === 'draft' && <Button size="sm" variant="ghost" disabled={working || saving} onClick={event => { resetButton.current = event.currentTarget; setConfirmReset(true); }}>Reset form</Button>}
          </div>
        </div>
        <p className="owner-listing-mobile-step mb-2 text-sm font-semibold text-main sm:hidden" aria-live="polite">Step {step} of {STEPS.length}<span className="mx-2 text-sec" aria-hidden="true">·</span>{STEPS[step - 1]}</p>
        <ol aria-label="Listing progress" className="owner-listing-progress grid grid-cols-6 mb-4 sm:mb-6">
          {STEPS.map((label, index) => <li key={label} className="relative min-w-0" data-reached={index + 1 <= step}>
            <button type="button" disabled={working || saving || index + 1 > step} onClick={() => { setStep(index + 1); setAttempted(false); }}
              aria-current={step === index + 1 ? 'step' : undefined}
              className={`owner-step-button relative flex w-full min-h-16 flex-col items-center gap-2 px-1 py-2 text-[10px] sm:text-xs disabled:cursor-default ${step === index + 1 ? 'text-accent' : 'text-sec'}`}>
              <span className={`owner-step-number relative grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs font-bold ${index + 1 <= step ? 'bg-accent border-accent text-accent-text' : 'bg-card border-strong text-sec'}`}>{index + 1 < step ? <Check aria-hidden="true" size={12} /> : index + 1}</span>
              <span className="owner-step-copy text-center"><span className="owner-step-label block font-semibold">{label}</span></span>
            </button>
          </li>)}
        </ol>
        {saveError && <div role="alert" className="owner-listing-save-error mb-5"><Alert tone="error" title="Your changes have not been saved">{saveError}
        <Button variant="secondary" className="mt-3" disabled={working || saving} onClick={() => void persist(false)}>Retry save</Button></Alert></div>}
        <div className="owner-listing-workspace mx-auto">
          <Surface className="owner-listing-panel min-w-0 overflow-hidden" role="region" aria-label={`Step ${step}: ${STEPS[step - 1]}`}>
            <div className="px-5 sm:px-6 pt-5 pb-2">
              <div>
                <h2 ref={heading} tabIndex={-1} className="text-lg font-bold text-main">{stepHeading}</h2>
                <p className="text-xs text-sec mt-1.5 leading-relaxed">{['Clear photos help renters choose with confidence. Add up to ' + policy.max_photos + ' photos.', 'AI can help with details. Please review and edit as needed.', 'Configure pricing, quantity, booking type and protection.', 'Choose when your item will be available for rent.', 'Choose where renters can pick up or request delivery.', 'Check all the details before publishing your listing.'][step - 1]}</p></div>
            </div>
            {notice && <div className="border-b border-app bg-accent-soft px-5 sm:px-6 py-3"><p role="status" className="flex items-start gap-2 text-xs text-accent"><CheckCircle2 size={16} aria-hidden="true" className="shrink-0" />{notice}</p></div>}
            <motion.fieldset key={step} disabled={working || saving}
              initial={reducedMotion ? false : { opacity: 0.96, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: 'easeOut' }}
              className="owner-listing-fields min-w-0 px-5 sm:px-6 pt-3 pb-5 space-y-4">
              {visibleErrors.length > 0 && <div ref={summary} tabIndex={-1} role="alert" className="rounded-card-lg bg-error-soft p-4">
                <h3 className="font-semibold text-error">A few details need your attention</h3>
                <ul className="mt-2 space-y-2 text-sm text-error">{visibleErrors.map((field) => <li key={field}>
                  <a href={`#${field in LISTING_FIELD_IDS ? LISTING_FIELD_IDS[field as ListingField] : `listing-${field}`}`} onClick={(event) => {
                    event.preventDefault();
                    setStep(field === 'photos' ? 1 : field === 'value' ? 3 : field === 'item-details' || ITEM_STEP_FIELDS.includes(field as ListingField) ? 2 : field === 'availability' ? 4 : ['pickup', 'delivery'].includes(field) ? 5 : 3);
                    setFocusTarget(field in LISTING_FIELD_IDS ? LISTING_FIELD_IDS[field as ListingField] : `listing-${field}`);
                  }}>{errors[field]}</a>
                </li>)}</ul>
              </div>}
              {preparingDetails && step === 1 ? <motion.div initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4" role="status" aria-busy="true" aria-label="Saving photos and preparing item details">
                <p className="text-sm font-semibold text-main">Saving photos and preparing your item details…</p>
                <div className="overflow-hidden rounded-card-lg border border-app"><Skeleton className="aspect-[16/10] w-full" rounded="rounded-none" /></div>
                <Skeleton className="h-5 w-2/3" /><Skeleton className="h-11 w-1/2" />
                <div className="grid grid-cols-2 gap-3"><Skeleton className="h-11" /><Skeleton className="h-11" /></div>
                <Skeleton className="h-28 w-full" />
                <span className="sr-only">The next step will show your title and all listing details.</span>
              </motion.div> : <>
              {step === 1 && <>
                <ListingPhotoEditor photos={photos} maximum={policy.max_photos} disabled={working || saving} uploadProgress={uploadProgress} preventLastPhotoRemoval={status === 'published'}
                  warnings={{ ...warnings, ...qualitySuggestions }} error={invalid('photos')} onAdd={() => { setReplaceIndex(null); fileInput.current?.click(); }}
                  onDrop={(files) => void upload(files)} onReplace={(index) => { setReplaceIndex(index); fileInput.current?.click(); }}
                  onRemove={(index) => void mutatePhotos(async () => { await removeListingImageUrl(listingId!, photos[index]); const next = photos.filter((_, at) => at !== index); await saveListingImageOrder(listingId!, next); return next; })}
                  onReorder={(from, to) => void mutatePhotos(async () => { const next = [...photos]; const [photo] = next.splice(from, 1); next.splice(to, 0, photo); await saveListingImageOrder(listingId!, next); return next; })} />
                <input ref={fileInput} aria-label="Upload listing photos" type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only"
                  disabled={working || saving} onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; const target = replaceIndex; setReplaceIndex(null); void upload(files, target ?? undefined); }} />
                <p className="text-xs text-sec">Choose photos from your camera or device. Use the original photo, not a small thumbnail. JPEG, PNG, or WebP, up to {Math.round(policy.max_photo_bytes / 1048576)} MB each; at least {policy.min_photo_dimension} x {policy.min_photo_dimension} pixels.</p>
                {aiLoading && <ListingAiSkeleton />}
                {photoError && <Alert tone="warning">{photoError}</Alert>}
                {failedUploads.map((item, index) => <Alert key={`${item.file.name}-${index}`} tone="error" title={item.file.name}>{item.error}
                  <div className="flex gap-2 mt-2"><Button variant="secondary" disabled={working || saving} onClick={() => retryFailedUpload(item)}>Retry photo</Button>
                    <Button variant="ghost" onClick={() => setFailedUploads((items) => items.filter((_, at) => at !== index))}>Dismiss</Button></div></Alert>)}
                <div className="flex gap-3 rounded-card-lg bg-warning-soft p-4"><ImagePlus aria-hidden="true" size={20} className="shrink-0 text-warning" /><div><p className="text-sm font-semibold text-main">A little light goes a long way</p><p className="text-sm text-sec mt-1 leading-relaxed">Use natural light and a clear background. Include different angles, accessories, and visible wear.</p></div></div>
              </>}
              {step === 2 && <>
                <div className="owner-ai-panel rounded-card">
                  <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold text-accent inline-flex items-center gap-2"><Sparkles aria-hidden="true" size={14} />{aiLoading ? 'Creating suggestions from your photos...' : aiApplied ? 'AI suggestions ready' : 'AI suggestions'}</p>
                    <Button variant="secondary" disabled={working || saving || aiLoading || !photos.length} onClick={() => void ensureDraft().then((id) => analyze(id, photos)).catch((error) => setAiError(message(error, 'Could not analyze photos.')))}>{aiApplied ? 'Regenerate' : 'Generate details'}</Button></div>
                  <p className="text-xs text-sec mt-1">AI fills details, including brand and model, when identifiable. Review the suggestions and enter anything missing. Your edits are preserved when you regenerate.</p>
                  {aiLoading && <Button variant="ghost" onClick={() => { aiRun.current += 1; setAiLoading(false); setAiError('Continue manually. You can retry AI later.'); }}>Continue manually</Button>}
                </div>
                {aiLoading && <ListingAiSkeleton />}
                {aiError && <div role="status" className="text-xs text-warning"><p className="font-semibold">Manual entry is available</p><p className="mt-1">{aiError}</p></div>}
                {flags.length > 0 && <Alert tone={blockingFlags.length ? 'error' : 'warning'} title={blockingFlags.length ? 'Review a potential policy violation' : 'Review these suggestions'}><ul className="list-disc pl-4">{flags.map((flag, index) => <li key={index}>{flag.reason}</li>)}</ul>
                  <p className="mt-2">Correct affected photos or details and regenerate to recheck. Persisted blocking flags require a trusted support review, even after a clean recheck. Photo-quality tips alone do not block publication.</p></Alert>}
                <Field label="Title" htmlFor="listing-title" error={invalid('title')}><input id="listing-title" value={form.title} maxLength={LISTING_RULES.title.max} placeholder="What are you sharing?"
                  onChange={(event) => { editedFields.current.title = true; update('title', event.target.value); }} className={fieldClass()} {...fieldProps('title')} />
                  <p className="text-xs text-sec text-right mt-1">{form.title.length}/{LISTING_RULES.title.max}</p></Field>
                <Field label="Category" htmlFor="listing-category-group" error={invalid('category')}><select id="listing-category-group" value={form.categoryId}
                  onChange={(event) => { editedFields.current.categoryId = true; update('categoryId', event.target.value); }} className={fieldClass()} {...fieldProps('category')}>
                  <option value="">Choose a category</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></Field>
                <div id="listing-item-details" tabIndex={-1} className="grid grid-cols-2 gap-3">
                  <Field label="Brand (optional)" htmlFor="listing-brand"><input id="listing-brand" value={form.itemDetails.brand} maxLength={80}
                    aria-invalid={Boolean(invalid('item-details'))} aria-describedby={invalid('item-details') ? 'listing-item-details-error' : undefined}
                    onChange={event => updateItemDetails('brand', event.target.value)} className={fieldClass()} /></Field>
                  <Field label="Model (optional)" htmlFor="listing-model"><input id="listing-model" value={form.itemDetails.model} maxLength={80}
                    aria-invalid={Boolean(invalid('item-details'))} aria-describedby={invalid('item-details') ? 'listing-item-details-error' : undefined}
                    onChange={event => updateItemDetails('model', event.target.value)} className={fieldClass()} /></Field>
                </div>
                {invalid('item-details') && <p id="listing-item-details-error" role="alert" className="text-xs text-error">{invalid('item-details')}</p>}
                <fieldset id="listing-condition" tabIndex={-1} aria-describedby={invalid('condition') ? 'listing-condition-error' : undefined}>
                  <legend className="text-[13px] font-semibold text-main mb-2">Item condition</legend>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{Object.entries(CONDITION_LABELS).map(([value, label]) => <label key={value} className={`owner-condition relative flex min-h-11 items-center justify-center gap-2 rounded-full border px-3 text-sm cursor-pointer ${form.condition === value ? 'bg-accent text-accent-text border-accent' : 'bg-card text-sec border-strong'}`}>
                    <input type="radio" name="item-condition" value={value} checked={form.condition === value} onChange={() => update('condition', value)} className="absolute inset-0 h-full w-full opacity-0 cursor-pointer" />
                    {form.condition === value && <Check aria-hidden="true" size={14} />}{label}
                  </label>)}</div>
                  {invalid('condition') && <p id="listing-condition-error" role="alert" className="text-sm text-error mt-2">{invalid('condition')}</p>}
                </fieldset>
                <Field label="Description" htmlFor="listing-description" error={invalid('description')}>
                  <textarea id="listing-description" value={form.description} rows={5} required minLength={LISTING_RULES.description.min} maxLength={LISTING_RULES.description.max} placeholder="Describe the item, what is included, and any wear."
                    onChange={(event) => { editedFields.current.description = true; update('description', event.target.value); }} className={textareaClass()} {...fieldProps('description')} />
                  <p className="text-xs text-sec text-right mt-1">{form.description.length}/{LISTING_RULES.description.max}</p></Field>
                <div>
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
                      aria-describedby={includedError ? 'listing-included-error' : undefined}
                      onChange={event => { setIncludedItem(event.target.value); setIncludedError(null); }}
                      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addIncludedItem(); } }} />
                    <Button size="sm" variant="secondary" icon={<Plus size={14} aria-hidden="true" />} disabled={form.itemDetails.included_items.length >= 12} onClick={addIncludedItem}>Add item</Button>
                  </div>
                  {includedError && <p id="listing-included-error" role="alert" className="text-xs text-error mt-2">{includedError}</p>}
                </div>
                <Field label="Additional details (optional)" htmlFor="listing-additional-details">
                  <textarea id="listing-additional-details" value={form.itemDetails.additional_details} maxLength={500} rows={2}
                    placeholder="Usage notes, features, or anything renters should know" onChange={event => updateItemDetails('additional_details', event.target.value)} className={textareaClass()} />
                  <p className="text-xs text-sec text-right mt-1">{form.itemDetails.additional_details.length}/500</p>
                </Field>
              </>}
              </>}
              {step === 3 && <>
                <div className="owner-rental-grid">
                <section aria-label="Rental pricing" className="space-y-4">
                  <h3 className="text-sm font-bold text-main">Pricing</h3>
                  <Field label="Daily price (USD)" htmlFor="listing-price" error={invalid('price')}>
                    <div className="relative mt-2">
                      <span aria-hidden="true" className="absolute inset-y-0 left-4 flex items-center text-lg font-semibold text-muted">$</span>
                      <input id="listing-price" inputMode="decimal" value={form.price} onChange={(event) => update('price', event.target.value)} className={fieldClass('pl-9 pr-20 text-lg font-semibold tnum')} {...fieldProps('price')} />
                      <span aria-hidden="true" className="absolute inset-y-0 right-4 flex items-center text-sm text-sec">/ day</span>
                    </div>
                    <p className="mt-2 text-xs text-sec">Your regular price for each rental day.</p>
                  </Field>
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-main">Offer weekly and monthly rentals</h4>
                    <p className="mt-1 text-xs leading-relaxed text-sec">You fund the discount; renters get a lower package price. Weekly starts at 20% off 7 days and monthly at 30% off 30 days. Extra days use your daily price.</p>
                    <p className="mt-1 text-xs leading-relaxed text-sec">Changes apply to new bookings only. Existing bookings keep their agreed price.</p>
                    {!durationDiscountFlag.loading && !durationDiscountFlag.enabled && <p className="mt-2 text-xs text-sec">Rental packages are turned off for this test environment.</p>}
                    <fieldset disabled={!durationDiscountFlag.enabled || durationDiscountFlag.loading} className="mt-3 space-y-3">
                      <div className="border-b border-app pb-3">
                        <label className="flex min-h-11 items-center justify-between gap-3 text-sm font-semibold text-main">
                          <span>Offer Weekly rentals</span>
                          <input type="checkbox" role="switch" checked={form.weeklyDiscountEnabled} onChange={event => { if (event.target.checked && Number(form.weeklyDiscount) <= 0) update('weeklyDiscount', '20'); update('weeklyDiscountEnabled', event.target.checked); }} aria-label="Offer Weekly rentals" className="h-5 w-5 accent-[var(--accent)]" />
                        </label>
                        {form.weeklyDiscountEnabled && <div className="mt-3 grid gap-3 sm:grid-cols-2 sm:items-end">
                          <Field label="Weekly discount" htmlFor="listing-weekly-discount">
                            <div className="relative"><input id="listing-weekly-discount" type="number" min={0} max={50} step="0.5" inputMode="decimal" value={form.weeklyDiscount} onChange={event => update('weeklyDiscount', event.target.value)} className={fieldClass('pr-8')} /><span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-sec">%</span></div>
                          </Field>
                          <p className="pb-2 text-xs text-sec">{priceForPreview > 0 ? <>7-day price: <strong className="text-main">${weeklyPreview.subtotal.toFixed(2)}</strong><span className="block mt-1">Save ${weeklyPreview.discountAmount.toFixed(2)}</span></> : 'Enter a daily price to preview your weekly price.'}</p>
                        </div>}
                      </div>
                      <div>
                        <label className="flex min-h-11 items-center justify-between gap-3 text-sm font-semibold text-main">
                          <span>Offer Monthly rentals</span>
                          <input type="checkbox" role="switch" checked={form.monthlyDiscountEnabled} onChange={event => { if (event.target.checked && Number(form.monthlyDiscount) <= 0) update('monthlyDiscount', '30'); update('monthlyDiscountEnabled', event.target.checked); }} aria-label="Offer Monthly rentals" className="h-5 w-5 accent-[var(--accent)]" />
                        </label>
                        {form.monthlyDiscountEnabled && <div className="mt-3 grid gap-3 sm:grid-cols-2 sm:items-end">
                          <Field label="Monthly discount" htmlFor="listing-monthly-discount">
                            <div className="relative"><input id="listing-monthly-discount" type="number" min={0} max={50} step="0.5" inputMode="decimal" value={form.monthlyDiscount} onChange={event => update('monthlyDiscount', event.target.value)} className={fieldClass('pr-8')} /><span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-sec">%</span></div>
                          </Field>
                          <p className="pb-2 text-xs text-sec">{priceForPreview > 0 ? <>30-day price: <strong className="text-main">${monthlyPreview.subtotal.toFixed(2)}</strong><span className="block mt-1">Save ${monthlyPreview.discountAmount.toFixed(2)}</span></> : 'Enter a daily price to preview your monthly price.'}</p>
                        </div>}
                      </div>
                    </fieldset>
                  </div>
                <div id="listing-quantity" tabIndex={-1}><p className="text-sm font-semibold mb-3">Available quantity</p><div className="inline-flex items-center rounded-card border border-strong overflow-hidden bg-card">
                  <IconButton label="Decrease available quantity" disabled={form.quantity <= 1} variant="ghost" onClick={() => update('quantity', form.quantity - 1)}><Minus size={16} aria-hidden="true" /></IconButton>
                  <output aria-label="Available quantity" className="min-w-12 text-center font-semibold tnum">{form.quantity}</output>
                  <IconButton label="Increase available quantity" disabled={form.quantity >= policy.max_quantity} variant="ghost" onClick={() => update('quantity', form.quantity + 1)}><Plus size={16} aria-hidden="true" /></IconButton></div>
                  <p className="text-xs text-sec mt-3 leading-relaxed">Identical units available for concurrent rentals. Maximum {policy.max_quantity}.</p>{invalid('quantity') && <p role="alert" className="text-error text-sm mt-2">{invalid('quantity')}</p>}</div>
                <Field label="Estimated replacement value (USD)" htmlFor="listing-value" error={invalid('value')}>
                  <input id="listing-value" inputMode="decimal" value={form.value} placeholder="What would a comparable replacement cost?"
                    onChange={(event) => update('value', event.target.value)} className={fieldClass()} {...fieldProps('value')} />
                  <p className="text-xs text-sec mt-2">Used to calculate protection and the refundable deposit. Maximum ${policy.max_estimated_value.toLocaleString('en-US')}.</p>
                </Field>
                </section>
                <section aria-label="Booking approval settings" className="space-y-4">
                <fieldset className="space-y-3"><legend className="text-sm font-semibold text-main mb-2">Booking approval</legend>
                  <div className="grid sm:grid-cols-2 gap-3">
                  {[{ value: false, label: 'Owner approval required', detail: 'Review each request before the renter pays.', icon: ShieldCheck }, { value: true, label: 'Instant booking', detail: 'Existing eligibility and payment rules apply.', icon: Zap }].map((option) => <label key={option.label} className={`flex items-start gap-3 rounded-card-lg border p-4 cursor-pointer ${form.instant === option.value ? 'border-accent bg-accent-soft' : 'border-app'}`}>
                    <input type="radio" name="booking-mode" className="mt-1 accent-[var(--accent)]" checked={form.instant === option.value} onChange={() => update('instant', option.value)} />
                    <option.icon size={19} aria-hidden="true" className="mt-0.5 shrink-0 text-accent" />
                    <span><span className="block text-sm font-semibold">{option.label}</span><span className="block text-xs text-sec mt-1">{option.detail}</span></span></label>)}
                  </div>
                </fieldset>
                <p className="text-xs text-sec">Choose whether this listing will accept regular bookings, competitive bids, or both.</p>
                </section>
                <aside aria-label="How booking works" className="rounded-card bg-accent-soft p-4 text-xs text-sec self-start">
                  <h3 className="text-sm font-bold text-main mb-4">How this works</h3>
                  <p>Choose instant booking or owner approval for regular rentals. After publication, you can add competitive bidding for selected dates; other dates stay available for regular bookings.</p>
                </aside>
                </div>
              </>}
              {step === 4 && <>
                <ListingAvailabilityPicker start={form.start} end={form.end} today={availabilityToday}
                  error={invalid('availability')} onChange={(start, end) => { setForm(current => ({ ...current, start, end })); changed(); }} />
                {retainedAvailability && <p className="text-xs text-sec">Your saved listing dates are retained until you select a new range.</p>}
                <div className="flex gap-3 rounded-card bg-subtle p-3 text-xs text-sec"><BellRing size={17} aria-hidden="true" className="shrink-0 text-accent" />
                  <div><p className="font-semibold text-main">We'll remind you</p><p className="mt-1 leading-relaxed">In-app reminders run 7 days and 1 day before published availability begins, when your booking notifications are enabled.</p></div>
                </div>
              </>}
              {step === 5 && <>
                <div className="space-y-4 min-w-0">
                  <PickupLocation showAreaMap value={pickup} onChange={(next) => {
                    setPickup(next);
                    setPickupConfirmed(Boolean(next.formattedAddress && next.city && next.latitude !== null && next.longitude !== null));
                    changed();
                  }} />
                  {invalid('pickup') && <p role="alert" className="text-sm text-error">{invalid('pickup')}</p>}
                  <fieldset className="space-y-3">
                    <legend className="text-sm font-semibold text-main mb-2">Pickup options</legend>
                    <p className="flex items-center gap-2 text-xs text-sec"><CheckCircle2 size={16} aria-hidden="true" className="text-accent" />Local pickup is included. Renters collect from your location.</p>
                    <label className="flex items-center justify-between gap-3 min-h-11"><span><span className="block text-sm font-semibold">Delivery available</span><span className="block text-xs text-sec mt-1">Optional local delivery, arranged separately.</span></span>
                      <input type="checkbox" role="switch" checked={form.delivery} onChange={(event) => update('delivery', event.target.checked)} aria-label="Delivery available" className="h-5 w-5 accent-[var(--accent)]" /></label>
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
                  <fieldset className="space-y-3">
                    <legend className="text-sm font-semibold text-main mb-2">Handoff availability windows</legend>
                    <p className="text-xs text-sec">Renter picks one of these windows on the booking’s pickup and return date.</p>
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-main">Pickup windows</p>
                      <p className="text-xs text-sec">Hours are one-hour handoff start times in your pickup timezone. Renters only see future hours on the booking date.</p>
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
                  </fieldset>
                  <fieldset className="space-y-3">
                    <legend className="text-sm font-semibold text-main mb-2">Return rules</legend>
                    <p className="text-xs text-sec">Tap the expectations renters must follow when returning the item.</p>
                    <div className="flex flex-wrap gap-2">{RETURN_RULE_OPTIONS.map((rule) => <button key={rule} type="button"
                      className={`min-h-11 rounded-full border px-3 text-sm text-left ${form.itemDetails.return_rules.includes(rule)
                        ? 'bg-accent text-accent-text border-accent' : 'bg-card text-sec border-strong'}`}
                      aria-pressed={form.itemDetails.return_rules.includes(rule)}
                      onClick={() => toggleReturnRule(rule)}>{rule}</button>)}
                    </div>
                    <Field label="Return note (optional)" htmlFor="listing-return-note">
                      <textarea id="listing-return-note" value={form.itemDetails.return_note} maxLength={240} rows={2}
                        placeholder="Example: Place lens cap and charger in the case before handoff."
                        onChange={event => updateItemDetails('return_note', event.target.value)} className={textareaClass()} />
                      <p className="text-xs text-sec text-right mt-1">{form.itemDetails.return_note.length}/240</p>
                    </Field>
                  </fieldset>
                </div>
              </>}
              {step === 6 && <>
                {status === 'archived' && <p role="status" className="rounded-card-lg bg-subtle p-4 text-sm text-sec">This listing is archived. Saving changes here will keep it archived; it will not become visible to renters.</p>}
                {status === 'suspended' && <p role="status" className="rounded-card-lg bg-warning-soft p-4 text-sm text-sec">This listing is suspended. You can save corrections, but it will stay hidden until it is reviewed.</p>}
                <div className="owner-listing-review min-w-0 space-y-4">
                {photos[activePreview] && <div><div className="relative"><img src={photos[activePreview]} alt={`Preview of ${form.title || 'your item'}`} className="w-full aspect-[16/10] object-cover rounded-card-lg bg-subtle" />
                  {photos.length > 1 && <div className="absolute inset-0 flex items-center justify-between px-2 pointer-events-none">
                    <IconButton className="pointer-events-auto bg-card" label="Previous preview photo" onClick={() => setPreviewPhoto((activePreview + photos.length - 1) % photos.length)}><ChevronLeft size={17} aria-hidden="true" /></IconButton>
                    <IconButton className="pointer-events-auto bg-card" label="Next preview photo" onClick={() => setPreviewPhoto((activePreview + 1) % photos.length)}><ChevronRight size={17} aria-hidden="true" /></IconButton>
                  </div>}</div>
                  <div className="flex gap-2 overflow-x-auto mt-3 pb-1">{photos.map((photo, index) => <button key={photo} type="button" onClick={() => setPreviewPhoto(index)} aria-label={`Preview photo ${index + 1}`} aria-pressed={activePreview === index} className={`h-16 w-16 shrink-0 rounded-card overflow-hidden border-2 ${activePreview === index ? 'border-accent' : 'border-transparent'}`}><img src={photo} alt="" className="h-full w-full object-cover" /></button>)}</div></div>}
                <div className="min-w-0 space-y-5">
                <div><h3 className="text-xl font-bold text-main">{form.title}</h3><p className="mt-2 text-xl font-bold text-main">${form.price}<span className="text-sm text-sec font-normal"> / day</span></p>
                  <p className="text-sm text-sec mt-2">{categories.find((category) => category.id === form.categoryId)?.name} &middot; {CONDITION_LABELS[form.condition]}</p></div>
                {(form.itemDetails.brand || form.itemDetails.model) && <dl className="grid grid-cols-2 gap-3 text-xs">
                  {form.itemDetails.brand && <div><dt className="text-sec">Brand</dt><dd className="text-main mt-1 font-semibold break-words">{form.itemDetails.brand}</dd></div>}
                  {form.itemDetails.model && <div><dt className="text-sec">Model</dt><dd className="text-main mt-1 font-semibold break-words">{form.itemDetails.model}</dd></div>}
                </dl>}
                <div className="grid gap-4 text-sm text-sec"><p className="flex gap-2"><MapPin aria-hidden="true" size={17} className="shrink-0 text-accent" />{[pickup.city, pickup.state].filter(Boolean).join(', ')} (approximate area)</p>
                  <p className="flex gap-2"><CalendarDays aria-hidden="true" size={17} className="shrink-0 text-accent" />Pickup from {formatListingDate(form.start)}. Return by {formatListingDate(form.end)}.</p>
                  <p className="flex gap-2"><CheckCircle2 aria-hidden="true" size={17} className="shrink-0 text-accent" />Pickup windows: {form.itemDetails.pickup_windows.map(window => HANDOFF_WINDOW_LABELS[window]).join(', ')}</p>
                  <p className="flex gap-2"><CheckCircle2 aria-hidden="true" size={17} className="shrink-0 text-accent" />Return windows: {form.itemDetails.return_windows.map(window => HANDOFF_WINDOW_LABELS[window]).join(', ')}</p>
                  <p className="flex gap-2"><CheckCircle2 aria-hidden="true" size={17} className="shrink-0 text-accent" />{form.quantity} {form.quantity === 1 ? 'unit' : 'units'} available</p>
                  <p className="flex gap-2"><ShieldCheck aria-hidden="true" size={17} className="shrink-0 text-accent" />{form.instant ? 'Instant booking rules apply' : 'Owner approval required'}</p>
                  {form.delivery && <p className="flex gap-2"><Truck aria-hidden="true" size={17} className="shrink-0 text-accent" />Delivery available - ${form.deliveryFee || '0'} per trip{form.itemDetails.delivery_radius_miles ? `, within ${form.itemDetails.delivery_radius_miles} miles (owner-declared)` : ''}, arranged separately</p>}</div>
                </div>
                <section className="border-t border-app pt-5"><h3 className="font-semibold text-main mb-2">About this item</h3><p className="text-sm text-sec whitespace-pre-wrap leading-relaxed">{form.description || 'No additional description.'}</p></section>
                {form.itemDetails.included_items.length > 0 && <section><h3 className="text-sm font-semibold mb-2">What's included</h3><ul className="flex flex-wrap gap-2">
                  {form.itemDetails.included_items.map(item => <li key={item} className="rounded-card bg-subtle px-2 py-1 text-xs text-sec">{item}</li>)}</ul></section>}
                {form.itemDetails.return_rules.length > 0 && <section><h3 className="text-sm font-semibold mb-2">Return expectations</h3><ul className="space-y-1">
                  {form.itemDetails.return_rules.map(rule => <li key={rule} className="text-xs text-sec">• {rule}</li>)}</ul></section>}
                {form.itemDetails.return_note && <section><h3 className="text-sm font-semibold mb-2">Return note</h3><p className="text-xs text-sec whitespace-pre-wrap">{form.itemDetails.return_note}</p></section>}
                {form.itemDetails.additional_details && <section><h3 className="text-sm font-semibold mb-2">Additional details</h3><p className="text-xs text-sec whitespace-pre-wrap">{form.itemDetails.additional_details}</p></section>}
                <Button size="sm" variant="secondary" onClick={() => { setStep(2); setAttempted(false); }}>Edit details</Button>
                <p className="text-xs text-sec">The exact pickup address stays private until an eligible booking is confirmed. Availability, payment verification, return, and deposit rules apply to every rental. Saved offer settings take effect only after publication.</p>
                {blockingFlags.length > 0 && <Alert tone="error" title="Resolve policy concerns before publishing">{blockingFlags.map((flag) => flag.reason).join(' ')} <Button variant="secondary" onClick={() => setStep(2)}>Review details</Button></Alert>}
                <div className="rounded-card-lg border border-app bg-subtle p-4 text-xs text-sec"><ShieldCheck aria-hidden="true" size={18} className="text-accent mb-2" />{policy.high_value_threshold === null || Number(form.value) > policy.high_value_threshold ? 'This declared value requires administrative review. The listing will not be marked live until approved.' : 'Publication is confirmed only after the server checks your photos, content, location and listing policy.'}</div>
                {biddingFlag.error
                  ? <Alert tone="error" title="Bidding settings unavailable">{biddingFlag.error}</Alert>
                  : !biddingFlag.loading && !biddingFlag.enabled
                    ? <p className="text-xs text-sec">Competitive bidding is currently unavailable.</p>
                    : biddingFlag.enabled && status === 'draft'
                      ? <Alert tone="info" title="Bidding is available after publication">
                        {policy.high_value_threshold === null || !form.value.trim() || Number(form.value) > policy.high_value_threshold
                          ? 'This listing needs administrative approval before it can go live. After approval, edit the live listing to configure bidding.'
                          : 'Publish this listing first. Once it is live, edit the listing to configure bidding for selected rental dates.'}
                      </Alert>
                      : biddingFlag.enabled && status === 'pending_approval'
                        ? <Alert tone="info" title="Bidding is available after approval">Once your listing is approved and live, edit it to configure bidding for selected rental dates.</Alert>
                        : null}
                </div>
                  {status === 'published' && <ListingNegotiationSettings listingId={listingId!} />}
              </>}
            </motion.fieldset>
            {publishError && <div role="alert" className="px-5 sm:px-6 pb-4"><Alert tone="error" title="Your listing has not been published">
              <p>{status === 'draft' && version === savedVersion ? 'Your draft is saved. ' : 'Your entries are kept. '}{publishError}</p>
              <Button variant="secondary" className="mt-3" disabled={working || saving} onClick={() => void publish()}>Retry publication</Button>
            </Alert></div>}
            <div className="owner-listing-actions border-t border-app bg-card px-4 sm:px-8 py-4 flex flex-wrap items-center justify-between gap-3">
              <Button variant="ghost" className="max-sm:w-11 max-sm:px-0" disabled={working || saving} icon={<ArrowLeft aria-hidden="true" size={16} />} onClick={() => void goBack()}><span className="sr-only sm:not-sr-only">Back</span></Button>
              <div className="flex min-w-0 flex-wrap gap-2">
                <Button disabled={working || saving || (step === STEPS.length && blockingFlags.length > 0)} loading={working && step === STEPS.length} loadingLabel="Saving..." trailingIcon={step < STEPS.length ? <ArrowRight aria-hidden="true" size={16} /> : <Check aria-hidden="true" size={16} />}
                  onClick={() => step === STEPS.length ? void publish() : continueStep()}>{nextLabel}</Button>
              </div>
            </div>
          </Surface>
        </div>
        {!editId && status === 'draft' && <AlertDialog open={confirmReset} onOpenChange={open => { if (!working && !saving) setConfirmReset(open); }}>
          <AlertDialogContent onCloseAutoFocus={event => { event.preventDefault(); resetButton.current?.focus(); }}>
            <AlertDialogTitle>Reset this listing?</AlertDialogTitle>
            <AlertDialogDescription>This permanently discards this draft, its uploaded photos and all entered details. You will start again with an empty listing.</AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel asChild><Button variant="secondary" disabled={working || saving}>Keep editing</Button></AlertDialogCancel>
              <Button variant="danger" disabled={working || saving} loading={working} loadingLabel="Resetting..." onClick={() => void discardDraft()}>Yes, reset</Button>
            </AlertDialogFooter>
            {saveError && <p role="alert" className="mt-3 text-sm text-error">{saveError}</p>}
          </AlertDialogContent>
        </AlertDialog>}
      </div>
    </div>
  );
}
