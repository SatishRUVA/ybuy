import { useEffect, useRef, useState } from 'react';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import type { Category } from '@/data';
import {
  fetchCategories, toUiCategory, createDraftListing, uploadListingPhoto,
  removeListingImageUrl, updateListingDetails, publishListing,
} from '@/lib/listings';
import { moderateListingContent, type ListingFlag } from '@/lib/listing-ai';
import { Skeleton } from '@/components/skeleton';
import { Button, Alert, Surface, Field, SectionHeader } from '@/components/ui';
import { fieldClass, textareaClass } from '@/components/form-classes';
import { CategoryIcon } from '@/components/category-icon';
import {
  ArrowRight, Camera, CheckCircle2, DollarSign, MapPin, Shield, Sparkles, X,
} from 'lucide-react';

export function CreateListingPage() {
  const { navigate, back } = useRouter();
  const { profile } = useAuth();
  const [photos, setPhotos] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [price, setPrice] = useState(0);
  const [description, setDescription] = useState('');
  const [deposit, setDeposit] = useState(0);
  const [locationLabel, setLocationLabel] = useState('');
  const [instantBooking, setInstantBooking] = useState(false);
  const [deliveryAvailable, setDeliveryAvailable] = useState(false);
  const [protectionEligible, setProtectionEligible] = useState(false);
  const [ownerVerified, setOwnerVerified] = useState(false);
  const [published, setPublished] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [categories, setCategories] = useState<Category[]>([]);
  const [listingId, setListingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiApplied, setAiApplied] = useState(false);
  const [flags, setFlags] = useState<ListingFlag[]>([]);
  const [flagsDismissed, setFlagsDismissed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchCategories()
      .then((rows) => {
        const next = rows.map((r) => toUiCategory(r, new Map()));
        setCategories(next);
        if (next[0]) setCategoryId((prev) => prev || next[0].id);
      })
      .catch(() => setCategories([]));
  }, []);

  /** Creates the draft listing row on first photo add so RLS-scoped storage uploads have an owner-linked id to target. */
  async function ensureDraftListing(): Promise<string> {
    if (listingId) return listingId;
    if (!profile || categories.length === 0) throw new Error('Not ready yet - try again in a moment.');
    const id = await createDraftListing(profile.id, categories[0].id);
    setListingId(id);
    return id;
  }

  // Runs the combined deterministic (contact-info/profanity) + AI (photo+text) moderation check.
  // Called after the first photo, on blur of title/description, and again right before publish
  // (the last one guarantees contact-info auto-masking happens before saving even if the
  // renter never blurs a field, e.g. pastes text and immediately clicks Publish).
  async function runModeration(currentTitle: string, currentDescription: string, photoUrlOverride?: string, listingIdOverride?: string): Promise<{ title: string; description: string }> {
    const id = listingIdOverride ?? listingId;
    if (!id) return { title: currentTitle, description: currentDescription };
    setAiLoading(true);
    try {
      const result = await moderateListingContent({
        listingId: id,
        photoUrl: photoUrlOverride ?? photos[0],
        title: currentTitle,
        description: currentDescription,
      });
      if (!result) return { title: currentTitle, description: currentDescription };
      setTitle(result.masked.title);
      setDescription(result.masked.description);
      setFlags(result.flags);
      if (result.flags.length > 0) setFlagsDismissed(false);
      if (result.suggestion) {
        setAiApplied(true);
        setTitle((t) => t || result.suggestion!.title);
        setDescription((d) => d || result.suggestion!.description);
        if (result.suggestion.categoryId) setCategoryId((c) => (categoryTouched ? c : result.suggestion!.categoryId!));
      }
      return result.masked;
    } finally {
      setAiLoading(false);
    }
  }

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || photos.length >= 6) return;
    setSaveError(null);
    setUploading(true);
    try {
      const id = await ensureDraftListing();
      const url = await uploadListingPhoto(id, file, photos.length);
      const wasFirstPhoto = photos.length === 0;
      setPhotos((p) => [...p, url]);
      if (wasFirstPhoto) void runModeration(title, description, url, id);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to upload photo');
    } finally {
      setUploading(false);
    }
  };

  const handleRemovePhoto = async (url: string, index: number) => {
    setPhotos((p) => p.filter((_, i) => i !== index));
    if (listingId) await removeListingImageUrl(listingId, url).catch(() => {});
  };

  const handlePublish = async () => {
    setSaveError(null);
    setPublishing(true);
    try {
      const id = await ensureDraftListing();
      // Final moderation pass right before saving - guarantees contact-info auto-masking always
      // applies to what actually gets persisted, even if the renter never blurred a field.
      const final = await runModeration(title, description, undefined, id);
      await updateListingDetails(id, {
        title: final.title,
        category_id: categoryId || categories[0]?.id,
        price_per_day: price,
        description: final.description,
        deposit,
        location_label: locationLabel,
        instant_booking: instantBooking,
        protection_eligible: protectionEligible,
        delivery_available: deliveryAvailable,
        owner_verified: ownerVerified,
      });
      await publishListing(id);
      setPublished(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to publish listing');
    } finally {
      setPublishing(false);
    }
  };

  if (published) {
    return (
      <div className="animate-fade-in pb-20 md:pb-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-success-soft grid place-items-center mx-auto mb-4 animate-booking-confirmed">
            <CheckCircle2 size={34} className="text-success" />
          </div>
          <h1 className="text-[26px] sm:text-[32px] font-extrabold text-main font-display leading-tight">Your listing is live</h1>
          <p className="text-sec mt-2">People nearby can find it and send you rental requests now.</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center mt-7">
            <Button onClick={() => navigate({ name: 'dashboard', tab: 'lending' })}>Go to Bookings</Button>
            <Button variant="secondary" onClick={() => { setPublished(false); setStep(1); setPhotos([]); setListingId(null); setTitle(''); setCategoryId(categories[0]?.id ?? ''); setPrice(0); setDescription(''); setDeposit(0); setLocationLabel(''); setInstantBooking(false); setDeliveryAvailable(false); setProtectionEligible(false); setOwnerVerified(false); setCategoryTouched(false); setAiApplied(false); setFlags([]); setFlagsDismissed(false); }}>
              List another item
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const canPublish = !!(title.trim() && categoryId && locationLabel.trim() && price > 0 && photos.length > 0 && !publishing);
  const canContinue = !!(photos.length > 0 && title.trim() && categoryId && !uploading && !aiLoading);
  const missingForItem = [
    photos.length === 0 && 'a photo',
    !title.trim() && 'a title',
    !categoryId && 'a category',
  ].filter(Boolean) as string[];
  const missing = [
    photos.length === 0 && 'a photo',
    !title.trim() && 'a title',
    !locationLabel.trim() && 'a location',
    price <= 0 && 'a daily price',
  ].filter(Boolean) as string[];

  return (
    <div className="animate-fade-in pb-32 md:pb-10">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-5 sm:py-8">
        <button onClick={back} className="text-sm font-medium text-sec hover:text-main transition-colors duration-fast mb-5">Back</button>
        <SectionHeader
          as="h1"
          title="List an item"
          subtitle="Photos, price and location. You can edit everything later."
          className="mb-7"
        />

        <ol className="grid grid-cols-2 gap-2 mb-7" aria-label="Listing progress">
          <li>
            <button
              type="button"
              onClick={() => setStep(1)}
              aria-current={step === 1 ? 'step' : undefined}
              className={`w-full flex items-center gap-3 p-3 rounded-card border text-left transition-colors duration-fast ${step === 1 ? 'border-accent bg-accent-soft' : 'border-app bg-card'}`}
            >
              <span className={`grid place-items-center w-8 h-8 rounded-full text-sm font-bold ${step === 1 ? 'bg-accent text-accent-text' : 'bg-subtle text-sec'}`}>1</span>
              <span><span className="block text-sm font-semibold text-main">Your item</span><span className="block text-xs text-sec">Photos and details</span></span>
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={() => { if (canContinue) setStep(2); }}
              disabled={!canContinue}
              aria-current={step === 2 ? 'step' : undefined}
              className={`w-full flex items-center gap-3 p-3 rounded-card border text-left transition-colors duration-fast disabled:opacity-50 ${step === 2 ? 'border-accent bg-accent-soft' : 'border-app bg-card'}`}
            >
              <span className={`grid place-items-center w-8 h-8 rounded-full text-sm font-bold ${step === 2 ? 'bg-accent text-accent-text' : 'bg-subtle text-sec'}`}>2</span>
              <span><span className="block text-sm font-semibold text-main">Rental details</span><span className="block text-xs text-sec">Pickup and pricing</span></span>
            </button>
          </li>
        </ol>

        <div className="space-y-8">
          {step === 1 && (
            <div className="space-y-8">
          <section>
            <h2 className="text-base font-bold text-main font-display">Photos</h2>
            <p className="text-sm text-sec mt-1">One photo minimum, up to six. The first one is the cover.</p>
            <p className="text-xs text-muted mt-1.5 mb-4 flex items-start gap-1.5">
              <Sparkles size={13} className="shrink-0 mt-0.5" />
              Photos are analysed by AI to suggest listing details and check them against our guidelines.
            </p>
            <div className="grid grid-cols-3 gap-3">
              {photos.map((photo, i) => (
                <div key={photo} className="aspect-square rounded-card overflow-hidden border border-app relative bg-subtle">
                  <img src={photo} alt="" className="w-full h-full object-cover" />
                  {i === 0 && (
                    <span className="absolute bottom-1.5 left-1.5 px-2 py-0.5 rounded-full bg-black/65 text-white text-[10px] font-semibold">
                      Cover
                    </span>
                  )}
                  <button
                    onClick={() => void handleRemovePhoto(photo, i)}
                    className="absolute top-1.5 right-1.5 grid place-items-center w-7 h-7 rounded-full bg-white/90 backdrop-blur-sm text-gray-900 hover:bg-white transition-colors duration-fast"
                    aria-label="Remove photo"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              {photos.length < 6 && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="aspect-square rounded-card border-2 border-dashed border-strong flex flex-col items-center justify-center gap-2 text-sec hover:border-accent hover:text-accent transition-colors duration-fast disabled:opacity-50"
                >
                  <Camera size={22} />
                  <span className="text-xs font-semibold">{uploading ? 'Uploading…' : 'Add photo'}</span>
                </button>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void handleFileSelected(e)} />
            </div>
          </section>

          {saveError && <Alert tone="error" title="Couldn't save this listing">{saveError}</Alert>}

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

          <section className="space-y-5">
            <h2 className="text-base font-bold text-main font-display">{step === 1 ? 'About your item' : 'Set your rental terms'}</h2>

            {step === 1 && (
              <>
            <Field
              label="Title"
              htmlFor="listing-title"
              hint={aiApplied ? <p className="text-xs text-accent flex items-center gap-1 -mt-1 mb-1.5"><Sparkles size={12} /> Suggested from your photo - edit as needed.</p> : undefined}
            >
              <input
                id="listing-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => void runModeration(title, description)}
                placeholder="e.g. Sony A7 IV mirrorless camera"
                className={fieldClass()}
              />
            </Field>

            <div>
              <p className="text-[13px] font-semibold text-main mb-1.5">Category</p>
              <div className="flex flex-wrap gap-2">
                {categories.map((cat) => {
                  const active = categoryId === cat.id;
                  return (
                    <button
                      key={cat.id}
                      onClick={() => { setCategoryId(cat.id); setCategoryTouched(true); }}
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
            </div>
              </>
            )}

            {step === 2 && (
              <>
            <Field label="Pickup location" htmlFor="listing-location">
              <div className="relative">
                <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                <input
                  id="listing-location"
                  value={locationLabel}
                  onChange={(e) => setLocationLabel(e.target.value)}
                  placeholder="City or neighbourhood"
                  className={fieldClass('pl-9')}
                />
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Price per day" htmlFor="listing-price">
                <div className="relative">
                  <DollarSign size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                  <input
                    id="listing-price"
                    type="number"
                    min={1}
                    value={price || ''}
                    onChange={(e) => setPrice(Number(e.target.value))}
                    className={fieldClass('pl-9 tnum')}
                  />
                </div>
              </Field>
              <Field label="Security deposit" htmlFor="listing-deposit">
                <div className="relative">
                  <DollarSign size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                  <input
                    id="listing-deposit"
                    type="number"
                    min={0}
                    value={deposit || ''}
                    onChange={(e) => setDeposit(Number(e.target.value))}
                    className={fieldClass('pl-9 tnum')}
                  />
                </div>
              </Field>
            </div>
              </>
            )}

            {step === 1 && (
            <Field
              label="Description"
              htmlFor="listing-description"
              hint={aiApplied ? <p className="text-xs text-accent flex items-center gap-1 -mt-1 mb-1.5"><Sparkles size={12} /> Suggested from your photo - edit as needed.</p> : undefined}
            >
              <textarea
                id="listing-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={() => void runModeration(title, description)}
                rows={5}
                placeholder="What's included, the condition it's in, and what it's best used for."
                className={textareaClass()}
              />
            </Field>
            )}

            {step === 2 && (
            <div>
              <p className="text-[13px] font-semibold text-main mb-1.5">Options</p>
              <div className="grid sm:grid-cols-2 gap-2">
                <ToggleChip label="Instant booking" checked={instantBooking} onChange={setInstantBooking} />
                <ToggleChip label="Delivery available" checked={deliveryAvailable} onChange={setDeliveryAvailable} />
                <ToggleChip label="Protection eligible" checked={protectionEligible} onChange={setProtectionEligible} />
                <ToggleChip label="Verified owner" checked={ownerVerified} onChange={setOwnerVerified} />
              </div>
            </div>
            )}
          </section>

          {step === 2 && (
            <>
          <Surface className="p-4 flex items-start gap-3">
            <Shield size={17} className="text-accent shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-main">You approve every request</p>
              <p className="text-xs text-sec mt-0.5 leading-relaxed">
                Publishing makes the item visible. Nobody can book it without your approval, and you can block dates any time.
              </p>
            </div>
          </Surface>

          {saveError && <Alert tone="error" title="Couldn't save this listing">{saveError}</Alert>}
            </>
          )}

          <div className="hidden md:block">
            {step === 1 ? (
              <>
                <Button fullWidth size="lg" disabled={!canContinue} trailingIcon={<ArrowRight size={17} />} onClick={() => setStep(2)}>
                  Continue to rental details
                </Button>
                {missingForItem.length > 0 && <p className="text-xs text-sec text-center mt-2.5">Add {missingForItem.join(', ')} to continue.</p>}
              </>
            ) : (
              <>
                <Button fullWidth size="lg" disabled={!canPublish} loading={publishing} loadingLabel="Publishing…" onClick={() => void handlePublish()}>
                  Publish listing
                </Button>
                {missing.length > 0 && <p className="text-xs text-sec text-center mt-2.5">Still needed: {missing.join(', ')}.</p>}
                <button type="button" onClick={() => setStep(1)} className="w-full mt-3 text-sm font-medium text-sec hover:text-main">Back to item details</button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Mobile: publish stays reachable while filling the form */}
      <div className="md:hidden fixed bottom-16 left-0 right-0 z-30 glass-surface border-t border-app px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {step === 1 ? (
          <>
            <Button fullWidth disabled={!canContinue} trailingIcon={<ArrowRight size={17} />} onClick={() => setStep(2)}>Continue to rental details</Button>
            {missingForItem.length > 0 && <p className="text-xs text-sec text-center mt-1.5">Add {missingForItem.join(', ')} to continue.</p>}
          </>
        ) : (
          <>
            <Button fullWidth disabled={!canPublish} loading={publishing} loadingLabel="Publishing…" onClick={() => void handlePublish()}>Publish listing</Button>
            {missing.length > 0 && <p className="text-xs text-sec text-center mt-1.5">Still needed: {missing.join(', ')}.</p>}
            <button type="button" onClick={() => setStep(1)} className="w-full mt-2 text-sm font-medium text-sec">Back to item details</button>
          </>
        )}
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
