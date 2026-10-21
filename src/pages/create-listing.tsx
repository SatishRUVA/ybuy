import { useEffect, useRef, useState } from 'react';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import type { Category } from '@/data';
import {
  fetchCategories, toUiCategory, createDraftListing, uploadListingPhoto,
  removeListingImageUrl, saveListingImageOrder, updateListingDetails, saveListingPickupLocation, publishListing, deleteOwnerListing,
  fetchListingById, fetchOwnerPickup, saveOwnerListing, fetchDepositRules, type CategoryDepositRule,
} from '@/lib/listings';
import { moderateListingContent, type ListingFlag } from '@/lib/listing-ai';
import {
  ITEM_STEP_FIELDS, LISTING_FIELD_IDS, LISTING_RULES, TERMS_STEP_FIELDS, parseMoney, validateListing, type ListingField,
} from '@/lib/listing-rules';
import { Skeleton } from '@/components/skeleton';
import { Button, Alert, Surface, Field, SectionHeader } from '@/components/ui';
import { fieldClass, textareaClass } from '@/components/form-classes';
import { CategoryIcon } from '@/components/category-icon';
import { PickupLocation, type PickupLocationValue } from '@/components/pickup-location';
import { SuccessFeedback } from '@/components/success-feedback';
import {
  ArrowDown, ArrowRight, ArrowUp, Camera, CheckCircle2, DollarSign, RotateCcw, Shield, Sparkles, X,
} from 'lucide-react';

export function CreateListingPage({ editId }: { editId?: string }) {
  const { navigate, back } = useRouter();
  const { profile } = useAuth();
  const [photos, setPhotos] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [priceText, setPriceText] = useState('');
  const [description, setDescription] = useState('');
  const [depositText, setDepositText] = useState('');
  const [valueText, setValueText] = useState('');
  const [condition, setCondition] = useState('');
  const [depositEdited, setDepositEdited] = useState(false);
  const [depositRules, setDepositRules] = useState<CategoryDepositRule[]>([]);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [revision, setRevision] = useState<number | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(Boolean(editId));
  const [editingDraft,setEditingDraft]=useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [pickupChanged, setPickupChanged] = useState(false);
  const [locationLabel, setLocationLabel] = useState('');
  const [pickupLocation, setPickupLocation] = useState<PickupLocationValue>({ formattedAddress: '', streetAddress: '', city: '', state: '', postalCode: '', country: '', latitude: null, longitude: null, placeId: '' });
  const [pickupConfirmed, setPickupConfirmed] = useState(false);
  const [instantBooking, setInstantBooking] = useState(false);
  const [deliveryAvailable, setDeliveryAvailable] = useState(false);
  const [protectionEligible, setProtectionEligible] = useState(false);
  const [negotiationEnabled, setNegotiationEnabled] = useState(false);
  const [availableQuantity, setAvailableQuantity] = useState(1);
  const [offerMinimum,setOfferMinimum] = useState('');
  const [offerTarget,setOfferTarget] = useState('');
  const [offerGuardrail,setOfferGuardrail] = useState(false);
  const [offerGuardrailPercent,setOfferGuardrailPercent] = useState('30');
  const [offerStart,setOfferStart] = useState('');
  const [offerEnd,setOfferEnd] = useState('');
  const [offerHours,setOfferHours] = useState('');
  const [published, setPublished] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [categories, setCategories] = useState<Category[]>([]);
  const [listingId, setListingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiApplied, setAiApplied] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<{ title: string; description: string; categoryId: string | null } | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [photoErrors, setPhotoErrors] = useState<string[]>([]);
  const [photoWarnings, setPhotoWarnings] = useState<Record<string, string>>({});
  const [photoQualityWarnings, setPhotoQualityWarnings] = useState<Record<string, string>>({});
  const [uploadProgress, setUploadProgress] = useState('');
  const [draggingPhotos, setDraggingPhotos] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<number | null>(null);
  const [flags, setFlags] = useState<ListingFlag[]>([]);
  const [flagsDismissed, setFlagsDismissed] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [attempted, setAttempted] = useState({ item: false, terms: false });
  const [focusField, setFocusField] = useState<{ field: ListingField; nonce: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const pickupFields = [pickupLocation.formattedAddress, pickupLocation.streetAddress, pickupLocation.city, pickupLocation.state, pickupLocation.postalCode, pickupLocation.country];
  const formErrors = validateListing({ photoCount: photos.length, title, categoryId, description, pickupConfirmed, pickupFields, priceText, depositText, valueText, condition });
  const depositRule = depositRules.find((rule) => rule.category_id === categoryId);
  const suggestedPct = Number(depositRule?.suggested_pct ?? 0.30);
  const parsedValue = parseMoney(valueText);
  const suggestedDeposit = parsedValue === null ? null : Math.min(Number(depositRule?.maximum_amount ?? 10000),
    Math.max(Number(depositRule?.minimum_amount ?? 0),Math.round(parsedValue*suggestedPct*100)/100));

  useEffect(() => {
    if (!depositEdited && suggestedDeposit !== null) setDepositText(suggestedDeposit.toFixed(2));
  }, [depositEdited,suggestedDeposit]);

  useEffect(() => {
    let active = true;
    fetchDepositRules().then((rules) => { if (active) setDepositRules(rules); })
      .catch((error: unknown) => { if (active) setRulesError(error instanceof Error ? error.message : 'Could not load category deposit rules.'); });
    return () => { active=false; };
  }, []);

  useEffect(() => {
    if (!editId || !profile) return;
    let active=true;
    void Promise.all([fetchListingById(editId),fetchOwnerPickup(editId)]).then(([row,pickup]) => {
      if (!active) return;
      if (!row || row.owner_id!==profile.id) throw new Error('Listing not found or not owned by your account.');
      if (typeof row.revision!=='number'||!Number.isSafeInteger(row.revision)) throw new Error('Listing editing requires the latest database migration.');
      setEditingDraft(row.status==='draft');
      setListingId(row.id); setRevision(row.revision); setTitle(row.title); setDescription(row.description ?? '');
      setCategoryId(row.category_id); setPriceText(String(row.price_per_day)); setDepositText(String(row.deposit));
      setDepositEdited(true); setValueText(row.estimated_value == null ? '' : String(row.estimated_value));
      setCondition(row.item_condition ?? ''); setPhotos([...row.listing_images].sort((a,b) => a.sort_order-b.sort_order).map((image) => image.url));
      setLocationLabel(row.location_label ?? ''); setInstantBooking(row.instant_booking);
      setDeliveryAvailable(row.delivery_available); setProtectionEligible(row.protection_eligible);
      setAvailableQuantity(row.available_quantity); setNegotiationEnabled(row.negotiation_enabled);
      setOfferMinimum(row.offer_minimum_daily==null?'':String(row.offer_minimum_daily));
      setOfferTarget(row.offer_target_daily==null?'':String(row.offer_target_daily));
      setOfferGuardrail(row.offer_guardrail_pct!=null);
      setOfferGuardrailPercent(String(Number(row.offer_guardrail_pct??0.30)*100));
      setOfferStart(row.offer_start_date??'');setOfferEnd(row.offer_end_date??'');
      setOfferHours(row.offer_expiration_hours==null?'':String(row.offer_expiration_hours));
      if (pickup) { setPickupLocation(pickup); setPickupConfirmed(true); }
    }).catch((error: unknown) => { if (active) setEditError(error instanceof Error ? error.message : 'Could not load this listing.'); })
      .finally(() => { if (active) setLoadingEdit(false); });
    return () => { active=false; };
  }, [editId,profile]);
  // Errors appear only after that step's first attempt, then update live as the owner fixes them.
  const stepFields = step === 3 ? ITEM_STEP_FIELDS : step === 4 ? TERMS_STEP_FIELDS : [];
  const errors = step === 1 && attempted.item ? { photos: formErrors.photos }
    : step === 3 && attempted.item ? formErrors
    : step === 4 && attempted.terms ? formErrors : {};
  const errorFields = stepFields.filter((f) => errors[f]);

  // Focus after the step re-renders, since the target field may only exist on the other step.
  useEffect(() => {
    if (!focusField) return;
    const targetId = focusField.field === 'pickup' && !pickupConfirmed
      ? (document.getElementById('pickup-confirm')?.hasAttribute('disabled') ? 'pickup-city' : 'pickup-confirm')
      : LISTING_FIELD_IDS[focusField.field];
    const target = document.getElementById(targetId);
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target?.focus({ preventScroll: true });
  }, [focusField, pickupConfirmed]);

  function showFirstError(fields: ListingField[], failing: Partial<Record<ListingField, string>>) {
    const first = fields.find((f) => failing[f]);
    if (!first) return false;
    setStep(first === 'photos' ? 1 : ITEM_STEP_FIELDS.includes(first) ? 3 : 4);
    setFocusField({ field: first, nonce: Date.now() });
    return true;
  }

  async function generateListingDetails() {
    setSaveError(null);
    setAiError(null);
    setAiLoading(true);
    try {
      const id = await ensureDraftListing();
      const result = await moderateListingContent({
        listingId: id,
        photoUrls: photos,
        title,
        description,
      });
      if (!result) throw new Error('AI details are unavailable right now. You can enter everything manually.');
      setFlags(result.flags);
      setFlagsDismissed(false);
      setAiSuggestion(result.suggestion);
      setPhotoQualityWarnings(Object.fromEntries(result.photoQualitySuggestions
        .filter(({ photoIndex }) => photoIndex < photos.length)
        .map(({ photoIndex, reason, recommendation }) => [
          photos[photoIndex],
          `${reason} ${recommendation}`,
        ])));
      if (!result.suggestion) throw new Error('AI could not suggest details from these photos. You can enter everything manually.');
    } catch (error) {
      setAiSuggestion(null);
      setAiError(error instanceof Error ? error.message : 'AI details are unavailable. You can enter everything manually.');
    } finally {
      setAiLoading(false);
    }
  }

  function handleContinue() {
    if (step === 1) {
      if (photos.length === 0) {
        setAttempted((a) => ({ ...a, item: true }));
        setFocusField({ field: 'photos', nonce: Date.now() });
        return;
      }
      setStep(2);
      return;
    }
    if (step === 2) {
      setStep(3);
      return;
    }
    if (step === 4) {
      setAttempted((a) => ({ ...a, terms: true }));
      if (!showFirstError(TERMS_STEP_FIELDS, formErrors)) setStep(5);
      return;
    }
    if (step !== 3) return;
    setAttempted((a) => ({ ...a, item: true }));
    if (!showFirstError(ITEM_STEP_FIELDS, formErrors)) setStep(4);
  }

  useEffect(() => {
    fetchCategories()
      .then((rows) => {
        const next = rows.map((r) => toUiCategory(r, new Map()));
        setCategories(next);
        if (next[0]) setCategoryId((prev) => prev || next[0].id);
      })
      .catch((error: unknown) => setSaveError(error instanceof Error ? error.message : 'Could not load categories.'));
  }, []);

  /** Creates the draft listing row on first photo add so RLS-scoped storage uploads have an owner-linked id to target. */
  async function ensureDraftListing(): Promise<string> {
    if (listingId) return listingId;
    if (!profile || categories.length === 0) throw new Error('Not ready yet - try again in a moment.');
    const id = await createDraftListing(profile.id, categories[0].id);
    setListingId(id);
    return id;
  }

  // Rechecks content at publication so deterministic contact masking and guideline checks
  // still run even when an owner skips the optional AI suggestion step.
  async function runModeration(currentTitle: string, currentDescription: string, listingIdOverride?: string): Promise<{ title: string; description: string }> {
    const id = listingIdOverride ?? listingId;
    if (!id) return { title: currentTitle, description: currentDescription };
    setAiLoading(true);
    try {
      const result = await moderateListingContent({
        listingId: id,
        photoUrls: photos,
        title: currentTitle,
        description: currentDescription,
      });
      if (!result) return { title: currentTitle, description: currentDescription };
      setTitle(result.masked.title);
      setDescription(result.masked.description);
      setFlags(result.flags);
      if (result.flags.length > 0) setFlagsDismissed(false);
      return result.masked;
    } finally {
      setAiLoading(false);
    }
  }

  async function inspectPhoto(file: File): Promise<{ width: number; height: number }> {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      throw new Error('Choose a JPEG, PNG, or WebP image.');
    }
    if (file.size > 10 * 1024 * 1024) throw new Error('Images must be 10 MB or smaller.');
    const bitmap = await createImageBitmap(file);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    if (dimensions.width < 320 || dimensions.height < 320) {
      throw new Error('Image must be at least 320 × 320 pixels.');
    }
    return dimensions;
  }

  async function uploadPhotos(files: File[], replaceIndex?: number) {
    setSaveError(null);
    setPhotoErrors([]);
    const errorsFound: string[] = [];
    const availableSlots = replaceIndex === undefined ? Math.max(0, 6 - photos.length) : 1;
    if (files.length > availableSlots) {
      errorsFound.push(`You can add ${availableSlots} more ${availableSlots === 1 ? 'photo' : 'photos'} (6 maximum).`);
    }
    const acceptedFiles = files.slice(0, availableSlots);
    if (acceptedFiles.length === 0) {
      setPhotoErrors(errorsFound);
      return;
    }
    setUploading(true);
    try {
      const id = await ensureDraftListing();
      for (let index = 0; index < acceptedFiles.length; index += 1) {
        const file = acceptedFiles[index];
        setUploadProgress(`Checking photo ${index + 1} of ${acceptedFiles.length}…`);
        try {
          const dimensions = await inspectPhoto(file);
          setUploadProgress(`Uploading photo ${index + 1} of ${acceptedFiles.length}…`);
          const order = replaceIndex === undefined ? photos.length + index : replaceIndex;
          const oldUrl = replaceIndex === undefined ? undefined : photos[replaceIndex];
          const result = await uploadListingPhoto(id, file, order, oldUrl);
          const { url } = result;
          if (replaceIndex === undefined) setPhotos((current) => [...current, url]);
          else {
            setPhotos((current) => current.map((value, at) => at === replaceIndex ? url : value));
            if (oldUrl) setPhotoWarnings((current) => { const next = { ...current }; delete next[oldUrl]; return next; });
            if (oldUrl) setPhotoQualityWarnings((current) => { const next = { ...current }; delete next[oldUrl]; return next; });
          }
          if (result.warning || dimensions.width < 1000 || dimensions.height < 1000) {
            setPhotoWarnings((current) => ({
              ...current,
              [url]: result.warning ?? 'This image is a little small. A sharper, well-lit photo can help renters inspect the item.',
            }));
          }
          if (editId) setRevision((current) => current === null ? null : current + 1);
        } catch (error) {
          errorsFound.push(`${file.name}: ${error instanceof Error ? error.message : 'Upload failed.'}`);
        }
      }
    } catch (error) {
      errorsFound.push(error instanceof Error ? error.message : 'Could not prepare the listing draft.');
    } finally {
      setUploading(false);
      setUploadProgress('');
      setPhotoErrors(errorsFound);
    }
  }

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    const target = replaceTarget;
    setReplaceTarget(null);
    void uploadPhotos(files, target ?? undefined);
  };

  async function saveDraft() {
    setSaveError(null);
    setDraftNotice(null);
    setSavingDraft(true);
    try {
      const id = await ensureDraftListing();
      const draftCategoryId = categoryId || categories[0]?.id;
      if (!draftCategoryId) throw new Error('No listing category is available yet. Try again in a moment.');
      const draftPrice = priceText.trim() ? parseMoney(priceText) : 1;
      const draftDeposit = depositText.trim() ? parseMoney(depositText) : 0;
      const draftValue = valueText.trim() ? parseMoney(valueText) : null;
      if (draftPrice === null || draftPrice < LISTING_RULES.price.min || draftPrice > LISTING_RULES.price.max) {
        throw new Error('Enter a valid daily price before saving the draft. Your current entry is still here.');
      }
      if (draftDeposit === null || draftDeposit < LISTING_RULES.deposit.min || draftDeposit > LISTING_RULES.deposit.max) {
        throw new Error('Enter a valid deposit before saving the draft. Your current entry is still here.');
      }
      if (valueText.trim() && (draftValue === null || draftValue <= 0 || draftValue > 1000000)) {
        throw new Error('Enter a valid replacement value before saving the draft. Your current entry is still here.');
      }
      const draftOfferMinimum = offerMinimum.trim() ? parseMoney(offerMinimum) : null;
      const draftOfferTarget = offerTarget.trim() ? parseMoney(offerTarget) : null;
      const draftOfferHours = offerHours.trim() ? Number(offerHours) : null;
      const draftGuardrail = parseMoney(offerGuardrailPercent);
      if ((offerMinimum.trim() && draftOfferMinimum === null) || (offerTarget.trim() && draftOfferTarget === null)
        || (offerHours.trim() && (!Number.isInteger(draftOfferHours) || Number(draftOfferHours) < 1 || Number(draftOfferHours) > 168))
        || (offerGuardrail && (draftGuardrail === null || draftGuardrail < 0 || draftGuardrail > 100))) {
        throw new Error('Enter valid offer settings before saving the draft. Your current entries are still here.');
      }
      const details = {
        title: title.trim(),
        category_id: draftCategoryId,
        price_per_day: draftPrice,
        description: description.trim(),
        deposit: draftDeposit,
        estimated_value: draftValue,
        item_condition: condition || null,
        location_label: locationLabel,
        instant_booking: instantBooking,
        protection_eligible: protectionEligible,
        delivery_available: deliveryAvailable,
        available_quantity: availableQuantity,
        negotiation_enabled: negotiationEnabled,
        offer_minimum_daily: draftOfferMinimum,
        offer_target_daily: draftOfferTarget,
        offer_guardrail_pct: offerGuardrail ? Number(draftGuardrail) / 100 : null,
        offer_start_date: offerStart || null,
        offer_end_date: offerEnd || null,
        offer_expiration_hours: draftOfferHours,
      };
      await updateListingDetails(id, details);
      if (pickupConfirmed && pickupLocation.latitude !== null && pickupLocation.longitude !== null) {
        await saveListingPickupLocation(id, profile!.id, {
          ...pickupLocation,
          latitude: pickupLocation.latitude,
          longitude: pickupLocation.longitude,
        });
      }
      if (editId) setRevision((current) => current === null ? current : current + 1);
      setDraftNotice('Draft saved. Resume it from My listings.');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save your draft. Your entries are still here; try again.');
    } finally {
      setSavingDraft(false);
    }
  }

  async function movePhoto(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= photos.length) return;
    const next = [...photos];
    [next[index], next[target]] = [next[target], next[index]];
    setPhotos(next);
    if (!listingId) return;
    try {
      await saveListingImageOrder(listingId, next);
      if (editId) setRevision((current) => current === null ? current : current + 1);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save the photo order.');
    }
  }

  function applySuggestion(field: 'title' | 'description' | 'category') {
    if (!aiSuggestion) return;
    if (field === 'title') setTitle(aiSuggestion.title);
    if (field === 'description') setDescription(aiSuggestion.description);
    if (field === 'category' && aiSuggestion.categoryId) {
      setCategoryId(aiSuggestion.categoryId);
    }
    setAiApplied(true);
  }

  async function shareListing() {
    const url = `${window.location.origin}/listing/${listingId}`;
    try {
      if (navigator.share) await navigator.share({ title, url });
      else {
        await navigator.clipboard.writeText(url);
        setShareMessage('Listing link copied.');
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setShareMessage('Sharing is unavailable here. You can copy the listing URL from your browser.');
    }
  }

  const handleRemovePhoto = async (url: string, index: number) => {
    setSaveError(null);
    setUploading(true);
    try {
      if (listingId) await removeListingImageUrl(listingId, url);
      const nextPhotos = photos.filter((_, i) => i !== index);
      setPhotos(nextPhotos);
      if (listingId) await saveListingImageOrder(listingId, nextPhotos);
      setPhotoWarnings((current) => {
        const next = { ...current };
        delete next[url];
        return next;
      });
      setPhotoQualityWarnings((current) => {
        const next = { ...current };
        delete next[url];
        return next;
      });
      if (editId) setRevision((current) => current === null ? null : current+1);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not remove that photo.');
    } finally {
      setUploading(false);
    }
  };

  /** Returns every field to its starting value. Shared by "List another item" and "Reset form". */
  function resetForm() {
    setPublished(false); setStep(1); setPhotos([]); setListingId(null); setTitle('');
    setCategoryId(categories[0]?.id ?? ''); setPriceText(''); setDescription(''); setDepositText('');
    setValueText(''); setCondition(''); setDepositEdited(false);
    setAttempted({ item: false, terms: false }); setFocusField(null); setLocationLabel('');
    setPickupLocation({ formattedAddress: '', streetAddress: '', city: '', state: '', postalCode: '', country: '', latitude: null, longitude: null, placeId: '' });
    setPickupConfirmed(false); setInstantBooking(false); setDeliveryAvailable(false); setProtectionEligible(false);
    setNegotiationEnabled(false); setAvailableQuantity(1);
    setOfferMinimum('');setOfferTarget('');setOfferGuardrail(false);setOfferGuardrailPercent('30');setOfferStart('');setOfferEnd('');setOfferHours('');
    setAiApplied(false); setFlags([]); setFlagsDismissed(false);
    setSaveError(null); setDraftNotice(null); setShareMessage(null); setAiSuggestion(null); setAiError(null); setPhotoWarnings({}); setPhotoQualityWarnings({});
    setPhotoErrors([]); setConfirmReset(false);
  }

  // Discards the unpublished draft too, so its uploaded photos don't linger in storage or show up
  // as an unfinished listing. If that fails the form is kept, so nothing is lost silently.
  async function handleReset() {
    setResetting(true);
    setSaveError(null);
    try {
      if (listingId && profile) await deleteOwnerListing(profile.id, listingId);
      resetForm();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setConfirmReset(false);
      setSaveError(err instanceof Error ? `Couldn't discard your draft: ${err.message}` : "Couldn't discard your draft. Try again.");
    } finally {
      setResetting(false);
    }
  }

  const handlePublish = async () => {
    setSaveError(null);
    setAttempted({ item: true, terms: true });
    if (showFirstError([...ITEM_STEP_FIELDS, ...TERMS_STEP_FIELDS], formErrors)) return;
    const price = parseMoney(priceText)!;
    const deposit = parseMoney(depositText) ?? 0;
    setPublishing(true);
    try {
      const id = await ensureDraftListing();
      // Final moderation pass right before saving - guarantees contact-info auto-masking always
      // applies to what actually gets persisted, even if the renter never blurred a field.
      const final = await runModeration(title, description, id);
      const moderatedErrors = validateListing({ photoCount: photos.length, title: final.title, categoryId, description: final.description, pickupConfirmed, pickupFields, priceText, depositText, valueText, condition });
      if (showFirstError([...ITEM_STEP_FIELDS, ...TERMS_STEP_FIELDS], moderatedErrors)) return;
      const details = {
        title: final.title,
        category_id: categoryId || categories[0]?.id,
        price_per_day: price,
        description: final.description,
        deposit,
        estimated_value: parseMoney(valueText),
        item_condition: condition,
        location_label: locationLabel,
        instant_booking: instantBooking,
        protection_eligible: protectionEligible,
        delivery_available: deliveryAvailable,
        available_quantity: availableQuantity,
        negotiation_enabled: negotiationEnabled,
        offer_minimum_daily: offerMinimum.trim()?parseMoney(offerMinimum):null,
        offer_target_daily: offerTarget.trim()?parseMoney(offerTarget):null,
        offer_guardrail_pct: offerGuardrail?Number(offerGuardrailPercent)/100:null,
        offer_start_date: offerStart||null,offer_end_date:offerEnd||null,
        offer_expiration_hours:offerHours.trim()?Number(offerHours):null,
      };
      if((offerMinimum.trim()&&details.offer_minimum_daily===null)||(offerTarget.trim()&&details.offer_target_daily===null)
        ||(offerHours.trim()&&(!Number.isInteger(details.offer_expiration_hours)||Number(details.offer_expiration_hours)<1||Number(details.offer_expiration_hours)>168))
        ||(offerGuardrail&&(parseMoney(offerGuardrailPercent)===null||Number(offerGuardrailPercent)>100))) {
        throw new Error('Use valid offer prices and an expiry between 1 and 168 whole hours.');
      }
      const pickup = { ...pickupLocation, latitude: pickupLocation.latitude!, longitude: pickupLocation.longitude! };
      if (editId) {
        if (revision===null) throw new Error('Reload the listing before saving.');
        setRevision(await saveOwnerListing(id,revision,details,pickupChanged ? pickup : undefined));
        if(editingDraft)await publishListing(id);
      } else {
        await updateListingDetails(id,details);
        await saveListingPickupLocation(id, profile!.id,pickup);
        await publishListing(id);
      }
      setPublished(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to publish listing');
    } finally {
      setPublishing(false);
    }
  };

  if (loadingEdit) return <div className="max-w-2xl mx-auto p-6" aria-busy="true"><Skeleton className="h-64 w-full" /></div>;
  if (editError) return <div className="max-w-2xl mx-auto p-6"><Alert tone="error" title="Could not edit listing">{editError}</Alert><Button className="mt-4" onClick={() => window.location.reload()}>Reload</Button></div>;
  if (published) {
    return (
      <div className="animate-fade-in pb-20 md:pb-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
          <ol aria-label="Listing progress" className="grid grid-cols-6 gap-1.5 mb-6">
            {['Photos', 'AI details', 'Item details', 'Rental terms', 'Preview', 'Live'].map((label, index) => (
              <li key={label} className={`rounded-card border p-2 text-center text-[10px] sm:text-xs font-semibold ${index === 5 ? 'border-accent bg-accent-soft text-accent' : 'border-app bg-card text-sec'}`} aria-current={index === 5 ? 'step' : undefined}>
                <span className="block">{index + 1}</span><span>{label}</span>
              </li>
            ))}
          </ol>
          <h1 className="text-2xl font-bold text-main mb-6">Your listing is live!</h1>
          {shareMessage && <p role="status" className="text-sm text-sec mb-3">{shareMessage}</p>}
          <SuccessFeedback kind="listing" id={listingId!} title={title} image={photos[0]}
            primary={{ label: 'View listing', onClick: () => navigate({ name: 'listing', id: listingId! }) }}
            secondary={{ label: 'Manage listing', onClick: () => navigate({ name: 'edit-listing', id: listingId! }) }}
            tertiary={{ label: 'Share listing', onClick: () => void shareListing() }} />
        </div>
        <Surface className="p-4">
          <h3 className="text-sm font-semibold text-main">Availability</h3>
          <p className="text-xs text-sec mt-1">Your item is available for requests. Manage blocked dates from your owner dashboard after publishing.</p>
        </Surface>
      </div>
    );
  }

  const busyReason = uploading ? 'Waiting for your photo to finish uploading…' : aiLoading ? 'Checking your listing against our guidelines…' : null;
  const busy = Boolean(busyReason) || publishing;
  const errorSummary = errorFields.length > 0 && (
    <div role="alert">
      <Alert tone="error" title={`Fix ${errorFields.length === 1 ? 'this' : 'these'} to ${step === 3 ? 'continue' : 'review'}`}>
        <ul className="list-disc pl-4 space-y-1 mt-1">
          {errorFields.map((f) => (
            <li key={f}>
              <button type="button" className="text-left underline" onClick={() => setFocusField({ field: f, nonce: Date.now() })}>{errors[f]}</button>
            </li>
          ))}
        </ul>
      </Alert>
    </div>
  );
  // Offered when the listing doesn't meet requirements: field errors, guideline warnings or a failed save.
  const showReset = !editId && (errorFields.length > 0 || (flags.length > 0 && !flagsDismissed) || Boolean(saveError));
  const resetControl = showReset && (
    <div className="flex flex-wrap items-center gap-2.5" role="group" aria-label="Start over">
      {confirmReset ? (
        <>
          <p className="text-sm text-sec">Discard everything you've entered{photos.length > 0 ? ', including uploaded photos' : ''}?</p>
          <Button size="sm" variant="danger" loading={resetting} loadingLabel="Resetting…" onClick={() => void handleReset()}>Yes, reset</Button>
          <Button size="sm" variant="ghost" disabled={resetting} onClick={() => setConfirmReset(false)}>Keep editing</Button>
        </>
      ) : (
        <Button size="sm" variant="secondary" icon={<RotateCcw size={15} />} disabled={busy} onClick={() => setConfirmReset(true)}>Reset form</Button>
      )}
    </div>
  );
  const fieldProps = (field: ListingField, id: string) => ({
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': errors[field] ? `${id}-error` : undefined,
  });

  return (
    <div className="animate-fade-in pb-32 md:pb-10">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-5 sm:py-8">
        <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 mb-3 flex items-center justify-between gap-3 bg-card-blur backdrop-blur-md border-b border-app">
          <button onClick={back} className="text-sm font-medium text-sec hover:text-main transition-colors duration-fast">Back</button>
          <Button size="sm" variant="secondary" disabled={busy || savingDraft} loading={savingDraft} loadingLabel="Saving…" onClick={() => editId && !editingDraft ? void handlePublish() : void saveDraft()}>{editId && !editingDraft ? 'Save changes' : 'Save draft'}</Button>
        </div>
        <SectionHeader
          as="h1"
          title={editId ? 'Edit your listing' : 'List an item'}
          subtitle={editId ? 'Future pricing can change. Item, pickup and photo changes are blocked while approved rentals are outstanding. Existing booking totals stay unchanged.' : 'Add photos, set your pickup location and rental details. Availability can be managed later from your owner dashboard.'}
          className="mb-7"
        />

        <ol className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 sm:gap-2 mb-7" aria-label="Listing progress">
          {[
            ['Photos', 'Upload photos'],
            ['AI details', 'Generate details'],
            ['Item details', 'Confirm item'],
            ['Rental terms', 'Set pricing'],
            ['Preview', 'Review listing'],
          ].map(([label, description], index) => {
            const number = index + 1;
            return (
              <li key={label}>
                <button
                  type="button"
                  onClick={() => {
                    if (number < step) setStep(number as 1 | 2 | 3 | 4 | 5);
                    else if (number === step + 1) handleContinue();
                  }}
                  disabled={uploading || aiLoading || number > step + 1}
                  aria-current={step === number ? 'step' : undefined}
                  className={`w-full min-h-16 flex flex-col sm:flex-row items-center sm:items-start justify-center sm:justify-start gap-1 sm:gap-2 p-2 sm:p-2.5 rounded-card border text-center sm:text-left transition-colors duration-fast disabled:opacity-50 ${step === number ? 'border-accent bg-accent-soft' : 'border-app bg-card'}`}
                >
                  <span className={`grid place-items-center w-7 h-7 shrink-0 rounded-full text-xs font-bold ${step === number ? 'bg-accent text-accent-text' : 'bg-subtle text-sec'}`}>{number}</span>
                  <span className="min-w-0">
                    <span className="block text-[11px] sm:text-xs font-semibold text-main">{label}</span>
                    <span className="hidden sm:block text-[10px] text-sec">{description}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        <div className="space-y-8">
          {errorSummary}
          {rulesError && <Alert tone="error" title="Deposit rules unavailable">{rulesError} Reload before saving.</Alert>}
          {editId && <Alert tone="info">Photo changes are saved immediately. Other changes are saved together when you select Save changes.</Alert>}
          {resetControl}
          {saveError && <Alert tone="error" title="Listing not saved">{saveError}</Alert>}
          {draftNotice && <p role="status" className="text-sm text-success">{draftNotice}</p>}
          {step === 1 && (
            <div className="space-y-8">
          <section>
            <h2 className="text-base font-bold text-main font-display">Photos</h2>
            <p className="text-sm text-sec mt-1">One photo minimum, up to six. The first one is the cover.</p>
            <p className="text-xs text-muted mt-1.5 mb-4">Choose up to six clear photos. You can add, replace, reorder, or remove them at any time.</p>
            <div
              onDragOver={(event) => { event.preventDefault(); setDraggingPhotos(true); }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingPhotos(false); }}
              onDrop={(event) => { event.preventDefault(); setDraggingPhotos(false); void uploadPhotos(Array.from(event.dataTransfer.files)); }}
              className={`grid grid-cols-2 sm:grid-cols-3 gap-3 rounded-card-lg transition-colors ${draggingPhotos ? 'bg-accent-soft ring-2 ring-accent' : ''}`}
              aria-label="Listing photos"
            >
              {photos.map((photo, i) => (
                <div key={photo} className="aspect-square rounded-card overflow-hidden border border-app relative bg-subtle group">
                  <img src={photo} alt={`Listing photo ${i + 1}`} className="w-full h-full object-cover" />
                  {i === 0 && (
                    <span className="absolute bottom-1.5 left-1.5 px-2 py-0.5 rounded-full bg-black/65 text-white text-[10px] font-semibold">
                      Cover
                    </span>
                  )}
                  {(photoWarnings[photo] || photoQualityWarnings[photo]) && <span className="absolute inset-x-0 bottom-0 p-2 bg-warning-soft text-warning text-[10px] leading-snug">{[photoWarnings[photo], photoQualityWarnings[photo]].filter(Boolean).join(' ')}</span>}
                  <div className="absolute top-1 left-1 flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button type="button" disabled={i === 0 || uploading} onClick={() => void movePhoto(i, -1)} aria-label={`Move photo ${i + 1} earlier`} className="grid place-items-center min-w-9 h-9 rounded-full bg-white/95 text-gray-900 disabled:opacity-50"><ArrowUp size={16} /></button>
                    <button type="button" disabled={i === photos.length - 1 || uploading} onClick={() => void movePhoto(i, 1)} aria-label={`Move photo ${i + 1} later`} className="grid place-items-center min-w-9 h-9 rounded-full bg-white/95 text-gray-900 disabled:opacity-50"><ArrowDown size={16} /></button>
                  </div>
                  <div className="absolute top-1 right-1 flex gap-1">
                    <button type="button" onClick={() => { setReplaceTarget(i); fileInputRef.current?.click(); }} disabled={uploading} aria-label={`Replace photo ${i + 1}`} className="grid place-items-center min-w-9 h-9 rounded-full bg-white/95 text-gray-900"><RotateCcw size={14} /></button>
                  <button
                    type="button"
                    onClick={() => void handleRemovePhoto(photo, i)}
                    disabled={uploading || publishing}
                    className="grid place-items-center min-w-9 h-9 rounded-full bg-white/95 text-gray-900 hover:bg-white transition-colors duration-fast"
                    aria-label={`Remove photo ${i + 1}`}
                  >
                    <X size={14} />
                  </button>
                  </div>
                </div>
              ))}
              {photos.length < 6 && (
                <button
                  id="listing-add-photo"
                  onClick={() => { setReplaceTarget(null); fileInputRef.current?.click(); }}
                  disabled={uploading}
                  aria-describedby={errors.photos ? 'listing-photos-error' : undefined}
                  className={`min-h-36 rounded-card border-2 border-dashed flex flex-col items-center justify-center gap-2 text-sec hover:border-accent hover:text-accent transition-colors duration-fast disabled:opacity-50 ${errors.photos ? 'border-error' : 'border-strong'}`}
                >
                  <Camera size={22} />
                  <span className="text-xs font-semibold">{uploading ? 'Uploading…' : 'Add photos'}</span>
                </button>
              )}
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={handleFileSelected} />
            </div>
            <p className="mt-2 text-xs text-sec">Drop image files here or choose files. JPEG, PNG, or WebP; 10 MB max each.</p>
            {uploadProgress && <p role="status" className="text-sm text-accent mt-2">{uploadProgress}</p>}
            {photoErrors.length > 0 && <Alert tone="error" title="Some photos need attention"><ul className="list-disc pl-4">{photoErrors.map((message) => <li key={message}>{message}</li>)}</ul>Failed files were not added; select them again to retry.</Alert>}
            {errors.photos && <p id="listing-photos-error" className="text-xs text-error mt-2">{errors.photos}</p>}
          </section>

          {aiLoading && (
            <Surface className="p-4 space-y-2">
              <p className="text-xs font-semibold text-sec flex items-center gap-1.5"><Sparkles size={13} /> Checking your listing…</p>
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
            </Surface>
          )}

          {flags.length > 0 && !flagsDismissed && (
            <div className="relative">
              <Alert tone="warning" title="This may not meet our community guidelines">
                <ul className="list-disc pl-4 space-y-0.5 mt-1">
                  {flags.map((f, i) => <li key={i}>{f.reason}</li>)}
                </ul>
                <p className="mt-2">
                  You can still publish, but please{' '}
                  <button onClick={() => navigate({ name: 'guidelines' })} className="font-semibold underline">review our guidelines</button>{' '}
                  first.
                </p>
              </Alert>
              <button
                onClick={() => setFlagsDismissed(true)}
                className="absolute top-2 right-2 grid place-items-center w-7 h-7 rounded-full hover:bg-black/5"
                aria-label="Dismiss"
              >
                <X size={15} className="text-warning" />
              </button>
            </div>
          )}
            </div>
          )}

          {step === 2 && (
            <section className="space-y-5">
              <div>
                <h2 className="text-base font-bold text-main font-display">Generate listing details with AI</h2>
                <p className="text-sm text-sec mt-1">AI suggestions are optional. Review every detail and confirm or edit it on the next step. Nothing is applied automatically.</p>
              </div>
              <Button disabled={photos.length === 0 || aiLoading || uploading} loading={aiLoading} loadingLabel="Generating suggestions…" icon={<Sparkles size={16} />} onClick={() => void generateListingDetails()}>
                {aiSuggestion ? 'Regenerate details' : 'Generate listing details with AI'}
              </Button>
              {aiSuggestion && (
                <Surface className="p-4 space-y-4">
                  <p className="text-sm font-semibold text-main">Suggested from your photos. Confirm only what you can verify.</p>
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div><p className="text-xs font-semibold text-sec">Title</p><p className="text-sm text-main mt-1">{aiSuggestion.title}</p></div>
                      <Button size="sm" variant="secondary" onClick={() => applySuggestion('title')}>Use title</Button>
                    </div>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1"><p className="text-xs font-semibold text-sec">Description</p><p className="text-sm text-main mt-1 whitespace-pre-wrap">{aiSuggestion.description}</p></div>
                      <Button size="sm" variant="secondary" onClick={() => applySuggestion('description')}>Use description</Button>
                    </div>
                    {aiSuggestion.categoryId && <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-sec">Suggested category: {categories.find((category) => category.id === aiSuggestion.categoryId)?.name}</p>
                      <Button size="sm" variant="secondary" onClick={() => applySuggestion('category')}>Use category</Button>
                    </div>}
                  </div>
                  <p className="text-xs text-muted">AI does not verify the item, brand, model, condition, or included accessories. Confirm those yourself.</p>
                </Surface>
              )}
              {Object.entries(photoQualityWarnings).map(([photo, warning]) => (
                <Alert key={photo} tone="warning" title={`Photo ${photos.indexOf(photo) + 1} suggestion`}>{warning}</Alert>
              ))}
              {aiError && <Alert tone="warning" title="AI suggestions unavailable">{aiError} Continue with manual entry.</Alert>}
              {flags.length > 0 && !flagsDismissed && (
                <Alert tone="warning" title="Review these photo or listing concerns">
                  <ul className="list-disc pl-4 space-y-1">{flags.map((flag, index) => <li key={`${flag.type}-${index}`}>{flag.reason}</li>)}</ul>
                </Alert>
              )}
              {photos.length === 0 && <p className="text-sm text-sec">Add at least one photo before asking for suggestions. Manual details are always available.</p>}
            </section>
          )}

          {(step === 3 || step === 4) && <section className="space-y-5">
            <h2 className="text-base font-bold text-main font-display">{step === 3 ? 'Confirm item details' : 'Set your rental terms'}</h2>

            {step === 3 && (
              <>
            <Field
              label="Title"
              htmlFor="listing-title"
              error={errors.title}
              hint={aiApplied ? <p className="text-xs text-accent flex items-center gap-1 -mt-1 mb-1.5"><Sparkles size={12} /> Suggested from your photo - edit as needed.</p> : undefined}
            >
              <input
                id="listing-title"
                value={title}
                maxLength={LISTING_RULES.title.max + 20}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Sony A7 IV mirrorless camera"
                className={fieldClass()}
                {...fieldProps('title', 'listing-title')}
              />
            </Field>

            <div>
              <p id="listing-category-label" className="text-[13px] font-semibold text-main mb-1.5">Category</p>
              <div id="listing-category-group" role="group" aria-labelledby="listing-category-label" tabIndex={-1} className="flex flex-wrap gap-2 outline-none">
                {categories.map((cat) => {
                  const active = categoryId === cat.id;
                  return (
                    <button
                      key={cat.id}
                      onClick={() => setCategoryId(cat.id)}
                      aria-pressed={active}
                      className={`inline-flex items-center gap-1.5 px-3 h-9 rounded-full text-xs font-semibold border transition-colors duration-fast ${
                        active ? 'border-accent text-accent bg-accent-soft' : 'border-app text-sec hover:bg-subtle'
                      }`}
                    >
                      <CategoryIcon category={cat} size={14} /> {cat.name}
                    </button>
                  );
                })}
              </div>
              {errors.category && <p className="text-xs text-error mt-1.5">{errors.category}</p>}
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Estimated replacement value (USD)" htmlFor="listing-value" error={errors.value}>
                <input id="listing-value" inputMode="decimal" value={valueText} onChange={(event) => setValueText(event.target.value)} className={fieldClass()} {...fieldProps('value','listing-value')} />
                <p className="text-xs text-muted mt-1">Owner-declared, not independently verified.</p>
              </Field>
              <Field label="Item condition" htmlFor="listing-condition" error={errors.condition}>
                <select id="listing-condition" value={condition} onChange={(event) => setCondition(event.target.value)} className={fieldClass()} {...fieldProps('condition','listing-condition')}>
                  <option value="">Choose condition</option><option value="new">New</option><option value="like_new">Like new</option><option value="good">Good</option><option value="fair">Fair</option>
                </select>
              </Field>
            </div>
              </>
            )}

            {step === 4 && (
              <>
            <PickupLocation
              value={pickupLocation}
              onChange={(next) => { setPickupChanged(true); setPickupLocation(next); setLocationLabel([next.city, next.state].filter(Boolean).join(', ')); setPickupConfirmed(false); }}
              onConfirm={() => setPickupConfirmed(true)}
            />
            {pickupConfirmed
              ? <p role="status" className="text-xs text-success -mt-2">Pickup location confirmed.</p>
              : errors.pickup && <p className="text-xs text-error -mt-2">{errors.pickup}</p>}

            <div className="grid grid-cols-2 gap-3">
              <Field label={`Price per day (${LISTING_RULES.currency})`} htmlFor="listing-price" error={errors.price}>
                <div className="relative">
                  <DollarSign size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                  <input
                    id="listing-price"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={priceText}
                    onChange={(e) => setPriceText(e.target.value)}
                    placeholder="25"
                    className={fieldClass('pl-9 tnum')}
                    {...fieldProps('price', 'listing-price')}
                  />
                </div>
              </Field>
              <Field label={`Security deposit (${LISTING_RULES.currency})`} htmlFor="listing-deposit" error={errors.deposit}>
                <div className="relative">
                  <DollarSign size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                  <input
                    id="listing-deposit"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={depositText}
                    onChange={(e) => { setDepositEdited(true); setDepositText(e.target.value); }}
                    placeholder={LISTING_RULES.deposit.min > 0 ? String(LISTING_RULES.deposit.min) : '0'}
                    className={fieldClass('pl-9 tnum')}
                    {...fieldProps('deposit', 'listing-deposit')}
                  />
                </div>
                <p className="text-xs text-muted mt-1.5">Suggested {(suggestedPct*100).toLocaleString()}% of declared value, within category limits. Charged separately and refunded after an eligible return. Not full-value insurance.</p>
                {suggestedDeposit !== null && <button type="button" className="text-xs text-accent underline mt-1" onClick={() => { setDepositEdited(false); setDepositText(suggestedDeposit.toFixed(2)); }}>Use suggested ${suggestedDeposit.toFixed(2)}</button>}
              </Field>
            </div>
              </>
            )}

            {step === 3 && (
            <Field
              label={LISTING_RULES.description.required ? 'Description' : 'Description (optional)'}
              htmlFor="listing-description"
              error={errors.description}
              hint={aiApplied ? <p className="text-xs text-accent flex items-center gap-1 -mt-1 mb-1.5"><Sparkles size={12} /> Suggested from your photo - edit as needed.</p> : undefined}
            >
              <textarea
                id="listing-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                maxLength={LISTING_RULES.description.max + 200}
                placeholder="What's included, the condition it's in, and what it's best used for."
                className={textareaClass()}
                {...fieldProps('description', 'listing-description')}
              />
              <p className="text-xs text-muted mt-1.5">Plain text only. {description.trim().length}/{LISTING_RULES.description.max.toLocaleString('en-US')}</p>
            </Field>
            )}

            {step === 4 && (
            <div>
              <p className="text-[13px] font-semibold text-main mb-1.5">Options</p>
              <div className="grid sm:grid-cols-2 gap-2">
                <ToggleChip label="Instant booking" checked={instantBooking} onChange={setInstantBooking} />
                <ToggleChip label="Delivery available" checked={deliveryAvailable} onChange={setDeliveryAvailable} />
                <ToggleChip label="Protection eligible" checked={protectionEligible} onChange={setProtectionEligible} />
                <ToggleChip label="Allow rental offers" checked={negotiationEnabled} onChange={setNegotiationEnabled} />
              </div>
              {negotiationEnabled&&<Surface className="p-4 mt-3 space-y-3">
                <h3 className="text-sm font-semibold">Listing offer rules</h3>
                <p className="text-xs text-sec">Fixed-price requests stay available. Eligible renter offer prices and dates may appear in the public top-five ticker; bidder identities stay private. An offer never automatically confirms a booking.</p>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Minimum daily offer (USD, optional)" htmlFor="offer-minimum"><input id="offer-minimum" value={offerMinimum} onChange={event=>setOfferMinimum(event.target.value)} inputMode="decimal" className={fieldClass()}/></Field>
                  <Field label="Target daily price (USD, optional)" htmlFor="offer-target"><input id="offer-target" value={offerTarget} onChange={event=>setOfferTarget(event.target.value)} inputMode="decimal" className={fieldClass()}/></Field>
                  <Field label="Earliest rental start (optional)" htmlFor="offer-start"><input id="offer-start" type="date" value={offerStart} onChange={event=>setOfferStart(event.target.value)} className={fieldClass()}/></Field>
                  <Field label="Latest rental end (optional)" htmlFor="offer-end"><input id="offer-end" type="date" min={offerStart} value={offerEnd} onChange={event=>setOfferEnd(event.target.value)} className={fieldClass()}/></Field>
                  <Field label="Offer expiry in hours (optional)" htmlFor="offer-hours"><input id="offer-hours" inputMode="numeric" value={offerHours} onChange={event=>setOfferHours(event.target.value)} placeholder="Platform default" className={fieldClass()}/></Field>
                </div>
                <label className="flex gap-2 text-sm text-sec"><input type="checkbox" checked={offerGuardrail} onChange={event=>setOfferGuardrail(event.target.checked)}/>Limit offers around the asking daily price</label>
                {offerGuardrail&&<Field label="Allowed percentage below or above asking price" htmlFor="offer-guardrail"><input id="offer-guardrail" inputMode="decimal" value={offerGuardrailPercent} onChange={event=>setOfferGuardrailPercent(event.target.value)} className={fieldClass()}/></Field>}
              </Surface>}
              <div className="mt-3">
                <Field label="Available quantity" htmlFor="listing-quantity">
                  <input
                    id="listing-quantity"
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    value={availableQuantity}
                    onChange={(e) => setAvailableQuantity(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                    className={fieldClass('w-28')}
                  />
                  <p className="text-xs text-muted mt-1.5">How many identical units can be rented on the same dates.</p>
                </Field>
              </div>
            </div>
            )}
          {step === 4 && (
            <>
          <Surface className="p-4 flex items-start gap-3">
            <Shield size={17} className="text-accent shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-main">{instantBooking ? 'Instant booking is on' : 'You approve every request'}</p>
              <p className="text-xs text-sec mt-0.5 leading-relaxed">
                {instantBooking
                  ? 'Eligible requests can book instantly when your item is available. You can block dates from your owner dashboard.'
                  : 'Publishing makes the item visible. You approve each request, and you can block dates from your owner dashboard.'}
              </p>
            </div>
          </Surface>

            </>
          )}
          </section>}

          {step === 5 && (
            <section className="space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div><h2 className="text-base font-bold text-main font-display">Preview your listing</h2><p className="text-sm text-sec mt-1">This is what renters will see. Review all details before publishing.</p></div>
                <Button size="sm" variant="secondary" onClick={() => setStep(3)}>Edit details</Button>
              </div>
              {Object.keys(formErrors).length > 0 && <Alert tone="error" title="Complete required information before publishing">
                <ul className="list-disc pl-4 space-y-1">{Object.entries(formErrors).map(([field, message]) => <li key={field}><button type="button" className="underline text-left" onClick={() => {
                  const target = field === 'photos' ? 1 : ['pickup', 'price', 'deposit'].includes(field) ? 4 : 3;
                  setStep(target);
                }}>{message}</button></li>)}</ul>
              </Alert>}
              {photoErrors.length > 0 && <Alert tone="warning" title="Some selected photos were not added">{photoErrors.join(' ')}</Alert>}
              <Surface className="overflow-hidden">
                {photos[0] && <img src={photos[0]} alt={`Preview of ${title || 'your item'}`} className="w-full max-h-[420px] object-cover bg-subtle" />}
                <div className="p-5 space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0"><h3 className="text-lg font-bold text-main break-words">{title || 'Your item title'}</h3><p className="text-sm text-sec mt-1">{categories.find((category) => category.id === categoryId)?.name || 'Choose a category'} · {condition ? condition.replace('_', ' ') : 'Condition not confirmed'}</p></div>
                      <p className="text-lg font-bold text-main whitespace-nowrap">${priceText || '—'}<span className="text-xs font-normal text-sec"> / day</span></p>
                  </div>
                  <p className="text-sm text-sec whitespace-pre-wrap">{description || 'Add an item description.'}</p>
                  <div className="grid sm:grid-cols-2 gap-3 border-t border-app pt-4 text-sm">
                    <p><span className="font-semibold">Estimated value:</span> {valueText ? `$${valueText}` : 'Not entered'}</p>
                    <p><span className="font-semibold">Security deposit:</span> {depositText ? `$${depositText}` : 'Not entered'}</p>
                    <p><span className="font-semibold">Pickup area:</span> {locationLabel || 'Not selected'} <span className="block text-xs text-muted">Exact address stays private until a rental is approved.</span></p>
                    <p><span className="font-semibold">Availability:</span> Available for renter requests</p>
                  </div>
                </div>
              </Surface>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setStep(1)}>Edit photos</Button>
                <Button variant="secondary" onClick={() => setStep(4)}>Edit rental terms</Button>
              </div>
            </section>
          )}

          <div className="hidden md:block">
            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" disabled={busy || savingDraft} loading={savingDraft} loadingLabel="Saving draft…" onClick={() => void saveDraft()}>Save draft</Button>
              {step < 5 ? (
                <Button className="flex-1" size="lg" disabled={busy || savingDraft} trailingIcon={<ArrowRight size={17} />} onClick={handleContinue}>
                  Continue
                </Button>
              ) : (
                <Button className="flex-1" size="lg" disabled={uploading || aiLoading || Boolean(rulesError)} loading={publishing} loadingLabel="Publishing…" onClick={() => void handlePublish()}>
                  {editId && !editingDraft ? 'Save changes' : 'Publish listing'}
                </Button>
              )}
            </div>
            {step > 1 && <button type="button" onClick={() => setStep((current) => (current - 1) as 1 | 2 | 3 | 4)} className="w-full mt-3 text-sm font-medium text-sec hover:text-main">Back</button>}
            {busyReason && <p role="status" className="text-xs text-sec text-center mt-2.5">{busyReason}</p>}
          </div>
        </div>
      </div>

      {/* Mobile: publish stays reachable while filling the form */}
      <div className="md:hidden fixed bottom-[calc(4rem_+_env(safe-area-inset-bottom))] left-0 right-0 z-30 glass-surface border-t border-app px-4 py-3">
        <div className="flex gap-2">
          <Button className="flex-1" size="sm" variant="secondary" disabled={busy || savingDraft} loading={savingDraft} loadingLabel="Saving…" onClick={() => editId && !editingDraft ? void handlePublish() : void saveDraft()}>{editId && !editingDraft ? 'Save changes' : 'Save draft'}</Button>
          {step < 5 ? <Button className="flex-1" size="sm" disabled={busy || savingDraft} trailingIcon={<ArrowRight size={16} />} onClick={handleContinue}>Continue</Button>
            : <Button className="flex-1" size="sm" disabled={uploading || aiLoading || Boolean(rulesError)} loading={publishing} loadingLabel="Publishing…" onClick={() => void handlePublish()}>{editId && !editingDraft ? 'Save changes' : 'Publish listing'}</Button>}
        </div>
        {step > 1 && <button type="button" onClick={() => setStep((current) => (current - 1) as 1 | 2 | 3 | 4)} className="w-full mt-2 text-sm font-medium text-sec">Back</button>}
        {busyReason && <p role="status" className="text-xs text-sec text-center mt-1.5">{busyReason}</p>}
      </div>
    </div>
  );
}

function ToggleChip({ label, checked, onChange }: { label: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className={`flex items-center justify-between gap-2 px-3 h-11 rounded-card text-sm font-medium border text-left transition-colors duration-fast ${
        checked ? 'border-accent text-accent bg-accent-soft' : 'border-app text-sec hover:bg-subtle'
      }`}
    >
      {label}
      {checked && <CheckCircle2 size={15} className="shrink-0" />}
    </button>
  );
}
