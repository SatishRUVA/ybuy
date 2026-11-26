import { useEffect, useState } from 'react';
import { useAuth } from '@/auth-context';
import { authProviderLabel } from '@/lib/auth-providers';
import { LOCAL_PROFILE_LOGIN } from '@/lib/local-profile-login';
import { supabase } from '@/lib/supabase';
import { fetchBookingsAsRenter } from '@/lib/bookings';
import { fetchReviewsForUser } from '@/lib/reviews';
import { Rating } from '@/main-site/components/trust';
import { Alert, Button, Surface, Badge } from '@/main-site/components/ui';
import { CheckCircle2, LogOut, UserRound } from 'lucide-react';
import { fieldClass } from '@/main-site/components/form-classes';

type ColorScheme = 'system' | 'light' | 'dark';

function readColorScheme(): ColorScheme {
  try {
    const saved = localStorage.getItem('ybuy-color-scheme');
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}

function applyColorScheme(scheme: ColorScheme, persist = true) {
  document.documentElement.dataset.colorScheme = scheme;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (meta) meta.content = scheme === 'system' ? 'light dark' : scheme;
  if (!persist) return;
  try {
    if (scheme === 'system') localStorage.removeItem('ybuy-color-scheme');
    else localStorage.setItem('ybuy-color-scheme', scheme);
  } catch {
    // The preference still applies for this session when storage is unavailable.
  }
}

export function TrustProfilePage() {
  const { user, profile, error: authError, authBusy, openSignIn, signOut } = useAuth();

  const [completedRentalCount, setCompletedRentalCount] = useState(0);
  const [listingCount, setListingCount] = useState(0);
  const [rating, setRating] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [colorScheme, setColorScheme] = useState<ColorScheme>(readColorScheme);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== 'ybuy-color-scheme') return;
      setColorScheme(event.newValue === 'light' || event.newValue === 'dark' ? event.newValue : 'system');
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchBookingsAsRenter(profile.id),
      fetchReviewsForUser(profile.id),
      supabase.from('listings').select('id', { count: 'exact', head: true }).eq('owner_id', profile.id),
    ])
      .then(([bookings, reviews, listingsResult]) => {
        if (cancelled) return;
        if (listingsResult.error) throw listingsResult.error;
        setCompletedRentalCount(bookings.filter((b) => b.status === 'completed').length);
        setRating(reviews.rating);
        setReviewCount(reviews.reviewCount);
        setListingCount(listingsResult.count ?? 0);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load your activity. Please refresh to retry.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  if (!profile) return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">
      <p role="status" className="text-sec">{authError ? 'Your profile is unavailable. Please refresh to retry.' : 'Loading your profile...'}</p>
      <Button variant="secondary" loading={authBusy === 'sign-out'} onClick={() => void signOut()}>Sign out</Button>
    </div>
  );

  const joinedYear = new Date(profile.created_at).getFullYear();

  return (
    <div className="animate-fade-in pb-20 md:pb-10">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-main font-display">Profile & settings</h1>
            <p className="mt-2 max-w-prose text-sm text-sec">Review your account details and verification.</p>
          </div>
          {!LOCAL_PROFILE_LOGIN && <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={openSignIn}>{LOCAL_PROFILE_LOGIN ? 'Switch profile' : 'Switch account'}</Button>
            <Button variant="ghost" size="sm" loading={authBusy === 'sign-out'} icon={<LogOut size={15} />} onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>}
        </header>

        {error && <Alert tone="error">{error}</Alert>}

        <Surface className="p-5 sm:p-6">
          <h2 className="font-semibold text-main font-display">Display preferences</h2>
          <p className="mt-1 text-sm text-sec">Choose a color scheme, or follow your device settings.</p>
          <fieldset className="mt-4 flex flex-wrap gap-2">
            <legend className="mb-2 text-sm font-semibold text-sec">Color scheme</legend>
            {(['system', 'light', 'dark'] as const).map((scheme) => (
              <label key={scheme} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${colorScheme === scheme ? 'border-accent bg-accent-soft text-main' : 'border-app bg-card text-sec hover:bg-subtle'}`}>
                <input
                  className="accent-[var(--accent)]"
                  type="radio"
                  name="color-scheme"
                  value={scheme}
                  checked={colorScheme === scheme}
                  onChange={() => {
                    setColorScheme(scheme);
                    applyColorScheme(scheme);
                  }}
                />
                {scheme === 'system' ? 'System' : scheme === 'light' ? 'Light' : 'Dark'}
              </label>
            ))}
          </fieldset>
        </Surface>

        <Surface className="p-5 sm:p-6">
          <p className="mb-4 text-xs font-bold uppercase tracking-wider text-muted">Account identity</p>
          <div className="flex flex-col sm:flex-row sm:items-center gap-5">
            {profile.avatar_url
              ? <img src={profile.avatar_url} alt="" className="w-20 h-20 rounded-full object-cover shrink-0 bg-subtle" />
              : <div aria-hidden="true" className="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-subtle text-2xl font-semibold text-sec">{profile.full_name.trim().charAt(0).toUpperCase() || <UserRound size={24} />}</div>}
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-main font-display">{profile.full_name}</h2>
              <p className="mt-1 break-all text-sm text-sec">{profile.email}</p>
              <div className="flex items-center gap-2 flex-wrap mt-1.5">
                <Rating value={rating} count={reviewCount} size="sm" />
                <Badge tone="neutral">Member since {joinedYear}</Badge>
              </div>
            </div>
            {profile.customer_id && <p className="text-xs text-sec sm:ml-auto">Customer ID <span className="ml-1 font-mono select-all font-semibold text-main">{profile.customer_id}</span></p>}
          </div>
        </Surface>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,.8fr)]">
          <ProfileGeography key={profile.id} userId={profile.id} initialCountry={profile.country_code ?? ''} initialRegion={profile.state_region_code ?? ''} />

          <Surface className="p-5 sm:p-6">
            <h2 className="font-semibold text-main font-display">Trust and verification</h2>
            <p className="mt-1 mb-4 text-sm text-sec">Help others rent with confidence.</p>
            <div className="space-y-2.5">
              <TrustRow label={`Signed in with ${authProviderLabel(user?.app_metadata.provider)}`} verified={Boolean(user?.app_metadata.provider)} />
              <TrustRow label="Email verified" verified={Boolean(user?.email_confirmed_at)} />
            </div>
            <p className="mt-4 text-xs leading-relaxed text-sec">Signing out only ends your YBuy session.</p>
          </Surface>
        </div>

        <section aria-labelledby="profile-activity-title">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 id="profile-activity-title" className="font-semibold text-main font-display">Your activity</h2>
            <span className="text-xs text-sec">{loading ? 'Updating…' : error ? 'Unavailable' : 'Across renting and lending'}</span>
          </div>
          <Surface className="grid grid-cols-2 divide-x divide-app p-0">
            <ActivityStat label="Completed rentals" value={loading || error ? '—' : completedRentalCount} />
            <ActivityStat label="Listings owned" value={loading || error ? '—' : listingCount} />
          </Surface>
        </section>
      </div>
    </div>
  );
}

function ProfileGeography({userId,initialCountry,initialRegion}:{userId:string;initialCountry:string;initialRegion:string}){
  const [countries,setCountries]=useState<{code:string;name:string}[]>([]);
  const [regions,setRegions]=useState<{code:string;name:string}[]>([]);
  const [country,setCountry]=useState(initialCountry);
  const [region,setRegion]=useState(initialRegion);
  const [loading,setLoading]=useState(true);
  const [regionsLoading,setRegionsLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [saved,setSaved]=useState(false);
  useEffect(()=>{
    let active=true;
    void supabase.from('reference_countries').select('code,name').order('name').then(({data,error})=>{
      if(!active)return;
      if(error)setError(error.message);
      else setCountries(data??[]);
      setLoading(false);
    });
    return()=>{active=false;};
  },[]);
  useEffect(()=>{
    let active=true;
    setRegions([]);
    if(!country){setRegionsLoading(false);return;}
    setRegionsLoading(true);
    void supabase.from('reference_regions').select('code,name').eq('country_code',country).order('name').then(({data,error})=>{
      if(!active)return;
      if(error)setError(error.message);
      else setRegions(data??[]);
      setRegionsLoading(false);
    });
    return()=>{active=false;};
  },[country]);
  return <Surface className="p-5 mb-4">
    <h2 className="font-semibold text-main font-display">Country and region</h2>
    <p className="mt-1 text-sm text-sec">Optional details for future rentals. These don't verify your identity or change existing rentals.</p>
    <form className="mt-3 space-y-3" onSubmit={async event=>{
      event.preventDefault();setError(null);setSaved(false);setSaving(true);
      try{
        const result=await supabase.from('profiles').update({country_code:country||null,state_region_code:region||null}).eq('id',userId);
        if(result.error)throw new Error(result.error.message);
        const verified=await supabase.rpc('get_my_profile').single<{country_code:string|null;state_region_code:string|null}>();
        if(verified.error)throw new Error(verified.error.message);
        if(verified.data.country_code!==(country||null)||verified.data.state_region_code!==(region||null))throw new Error('The saved country and region could not be verified. Reload before retrying.');
        setSaved(true);
      }catch(error){setError(error instanceof Error?error.message:'Could not save country and region.');}
      finally{setSaving(false);}
    }}>
      <fieldset disabled={loading||saving} className="grid sm:grid-cols-2 gap-3">
        <label className="text-sm font-semibold text-sec">Country (optional)
          <select className={fieldClass('mt-1')} value={country} onChange={event=>{setCountry(event.target.value);setRegion('');setSaved(false);}}>
            <option value="">Not provided</option>{countries.map(item=><option key={item.code} value={item.code}>{item.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold text-sec">State / region (optional)
          <select className={fieldClass('mt-1')} disabled={!country||regionsLoading} value={region} onChange={event=>{setRegion(event.target.value);setSaved(false);}}>
            <option value="">Not provided</option>{regions.map(item=><option key={item.code} value={item.code}>{item.name}</option>)}
          </select>
        </label>
      </fieldset>
      {error&&<Alert tone="error">{error}</Alert>}
      {saved&&<Alert tone="success">Country and region saved.</Alert>}
      <Button type="submit" variant="secondary" size="sm" loading={saving} disabled={loading||regionsLoading||countries.length===0}>Save country and region</Button>
    </form>
  </Surface>;
}

function ActivityStat({ label, value }: { label: string; value: string | number }) {
  return <div className="p-4 sm:px-5 sm:py-4">
    <p className="text-xl font-semibold text-main font-display tnum">{value}</p>
    <p className="mt-1 text-xs text-sec">{label}</p>
  </div>;
}

function TrustRow({ label, verified }: { label: string; verified: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 min-h-11 rounded-card bg-subtle">
      <span className="text-sm text-main [overflow-wrap:anywhere]">{label}</span>
      {verified ? (
        <span className="flex items-center gap-1.5 text-sm font-semibold text-success">
          <CheckCircle2 size={15} /> Verified
        </span>
      ) : (
        <span className="text-sm text-muted">Pending</span>
      )}
    </div>
  );
}
