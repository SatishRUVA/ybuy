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
import * as Icons from 'lucide-react';
import {
  Camera, CheckCircle2, DollarSign, MapPin, Shield, Sparkles, AlertTriangle, X,
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
    if (!profile || categories.length === 0) throw new Error('Not ready yet — try again in a moment.');
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
      // Final moderation pass right before saving — guarantees contact-info auto-masking always
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
      <div className="animate-fade-in pb-20 md:pb-8">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 text-center">
          <div className="w-20 h-20 rounded-full bg-success-soft flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={44} className="text-success" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-main font-display mb-2">Listing published!</h1>
          <p className="text-sec mb-6">Your item is now live and available for rent.</p>
          <div className="flex gap-3 justify-center">
            <button onClick={() => navigate({ name: 'owner-dashboard' })} className="px-6 py-3 rounded-card-lg bg-accent text-accent-text font-semibold text-sm">
              Go to dashboard
            </button>
            <button onClick={() => { setPublished(false); setPhotos([]); setListingId(null); setTitle(''); setCategoryId(categories[0]?.id ?? ''); setPrice(0); setDescription(''); setDeposit(0); setLocationLabel(''); setInstantBooking(false); setDeliveryAvailable(false); setProtectionEligible(false); setOwnerVerified(false); setCategoryTouched(false); setAiApplied(false); setFlags([]); setFlagsDismissed(false); }} className="px-6 py-3 rounded-card-lg border border-app text-main font-semibold text-sm hover:bg-subtle transition-colors">
              List another
            </button>
          </div>
        </div>
      </div>
    );
  }

  const canPublish = !!(title.trim() && categoryId && locationLabel.trim() && price > 0 && photos.length > 0 && !publishing);

  return (
    <div className="animate-fade-in pb-20 md:pb-8">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
        <button onClick={back} className="text-sm text-sec hover:text-main transition-colors mb-4">Back</button>
        <h1 className="text-2xl sm:text-3xl font-bold text-main font-display mb-2">Create listing</h1>
        <p className="text-sec text-sm mb-6">Add photos, pricing, location, and details in one page.</p>

        <div className="space-y-6">
          <section>
            <h2 className="text-sm font-semibold text-main mb-2">Photos</h2>
            <p className="text-xs text-sec mb-1">At least 1 photo required. Up to 6.</p>
            <p className="text-xs text-muted mb-3 flex items-center gap-1.5">
              <Sparkles size={13} className="shrink-0" />
              Photos are analyzed by AI to help suggest listing details and check against our guidelines.
            </p>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {photos.map((photo, i) => (
                <div key={photo} className="aspect-square rounded-card-lg overflow-hidden border border-app relative group">
                  <img src={photo} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => void handleRemovePhoto(photo, i)}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-card/80 backdrop-blur-sm flex items-center justify-center text-xs text-main"
                    aria-label="Remove photo"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {photos.length < 6 && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="aspect-square rounded-card-lg border-2 border-dashed border-app flex flex-col items-center justify-center gap-2 text-sec hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
                >
                  <Camera size={24} />
                  <span className="text-xs font-medium">{uploading ? 'Uploading…' : 'Add photo'}</span>
                </button>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void handleFileSelected(e)} />
            </div>
          </section>

          {aiLoading && (
            <section className="p-4 rounded-card-xl bg-card border border-app space-y-2">
              <p className="text-xs font-medium text-sec flex items-center gap-1.5"><Sparkles size={13} /> Checking your listing…</p>
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
            </section>
          )}

          {flags.length > 0 && !flagsDismissed && (
            <section className="p-4 rounded-card-xl bg-warning-soft border border-app flex items-start gap-3">
              <AlertTriangle size={18} className="text-warning shrink-0 mt-0.5" />
              <div className="flex-1 text-sm text-main space-y-1">
                <p className="font-medium">This may not meet our community guidelines:</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  {flags.map((f, i) => <li key={i}>{f.reason}</li>)}
                </ul>
                <p>
                  You can still publish, but please{' '}
                  <button onClick={() => navigate({ name: 'guidelines' })} className="text-accent font-medium hover:underline">
                    review our guidelines
                  </button>{' '}
                  first.
                </p>
              </div>
              <button onClick={() => setFlagsDismissed(true)} className="shrink-0 p-1 rounded-card hover:bg-subtle" aria-label="Dismiss">
                <X size={16} className="text-sec" />
              </button>
            </section>
          )}

          <section>
            <h2 className="text-sm font-semibold text-main mb-2">Details</h2>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-sec uppercase tracking-wide">Title</label>
                {aiApplied && <p className="text-xs text-accent flex items-center gap-1 mt-1 mb-0.5"><Sparkles size={12} /> Suggested from your photo — edit as needed.</p>}
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => void runModeration(title, description)}
                  placeholder="e.g. Sony A7 IV Mirrorless Camera"
                  className="w-full mt-1 px-3 py-2 rounded-card-lg border border-app bg-card text-sm text-main outline-none focus:border-accent"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-sec uppercase tracking-wide">Category</label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {categories.map((cat) => {
                    const Icon = (Icons as unknown as Record<string, typeof Icons.Camera>)[cat.icon] ?? Icons.Box;
                    return (
                      <button
                        key={cat.id}
                        onClick={() => { setCategoryId(cat.id); setCategoryTouched(true); }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-card-lg text-xs font-medium border transition-colors ${
                          categoryId === cat.id ? 'border-accent text-accent bg-accent-soft' : 'border-app text-sec hover:bg-subtle'
                        }`}
                      >
                        <Icon size={14} /> {cat.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-sec uppercase tracking-wide">Location</label>
                <div className="mt-1 flex items-center gap-2 px-3 py-2 rounded-card-lg border border-app bg-card">
                  <MapPin size={16} className="text-muted" />
                  <input value={locationLabel} onChange={(e) => setLocationLabel(e.target.value)} placeholder="City or neighborhood" className="w-full bg-transparent text-sm text-main outline-none" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-sec uppercase tracking-wide">Price / day</label>
                  <div className="flex items-center gap-1 mt-1 px-3 py-2 rounded-card-lg border border-app bg-card">
                    <DollarSign size={16} className="text-muted" />
                    <input type="number" min={1} value={price || ''} onChange={(e) => setPrice(Number(e.target.value))} className="flex-1 bg-transparent text-sm text-main outline-none" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-sec uppercase tracking-wide">Deposit</label>
                  <div className="flex items-center gap-1 mt-1 px-3 py-2 rounded-card-lg border border-app bg-card">
                    <DollarSign size={16} className="text-muted" />
                    <input type="number" min={0} value={deposit || ''} onChange={(e) => setDeposit(Number(e.target.value))} className="flex-1 bg-transparent text-sm text-main outline-none" />
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-sec uppercase tracking-wide">Description</label>
                {aiApplied && <p className="text-xs text-accent flex items-center gap-1 mt-1 mb-0.5"><Sparkles size={12} /> Suggested from your photo — edit as needed.</p>}
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onBlur={() => void runModeration(title, description)}
                  rows={4}
                  placeholder="Tell renters what is included, condition, and best use."
                  className="w-full mt-1 px-3 py-2 rounded-card-lg border border-app bg-card text-sm text-main outline-none focus:border-accent resize-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-sec uppercase tracking-wide">Features</label>
                <div className="grid sm:grid-cols-2 gap-2 mt-2">
                  <ToggleChip label="Instant booking" checked={instantBooking} onChange={setInstantBooking} />
                  <ToggleChip label="Delivery available" checked={deliveryAvailable} onChange={setDeliveryAvailable} />
                  <ToggleChip label="Protection eligible" checked={protectionEligible} onChange={setProtectionEligible} />
                  <ToggleChip label="Verified owner" checked={ownerVerified} onChange={setOwnerVerified} />
                </div>
              </div>
            </div>
          </section>

          <section className="p-4 rounded-card-xl bg-card border border-app">
            <div className="flex items-center gap-2 text-sm font-semibold text-main mb-2">
              <Shield size={16} className="text-accent" /> Ready to publish
            </div>
            <p className="text-xs text-sec">Your listing will be visible as soon as you publish. You can edit details later from your dashboard.</p>
          </section>

          {saveError && <p className="text-sm text-error">{saveError}</p>}

          <button onClick={() => void handlePublish()} disabled={!canPublish} className="w-full py-3 rounded-card-lg bg-accent text-accent-text font-bold text-sm disabled:opacity-40">
            {publishing ? 'Publishing…' : 'Publish listing'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ToggleChip({ label, checked, onChange }: { label: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`px-3 py-2 rounded-card-lg text-xs font-medium border text-left transition-colors ${
        checked ? 'border-accent text-accent bg-accent-soft' : 'border-app text-sec hover:bg-subtle'
      }`}
    >
      {label}
    </button>
  );
}
