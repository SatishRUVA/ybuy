import { useEffect, useState } from 'react';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import { authProviderLabel } from '@/lib/auth-providers';
import { supabase } from '@/lib/supabase';
import { fetchBookingsAsRenter, type UiBooking } from '@/lib/bookings';
import { fetchReviewsForUser } from '@/lib/reviews';
import { Rating } from '@/components/trust';
import { Alert, Button, Surface, Badge } from '@/components/ui';
import { Dropdown } from '@/components/shadcn/select';
import { WorkspaceHeader } from '@/components/account-workspace';
import { CheckCircle2, Clock, Shield, TrendingUp, Package, ArrowRight, LogOut, Heart } from 'lucide-react';

export function TrustProfilePage() {
  const { navigate } = useRouter();
  const { user, profile, error: authError, authBusy, openSignIn, signOut } = useAuth();

  const [completedRentals, setCompletedRentals] = useState<UiBooking[]>([]);
  const [listingCount, setListingCount] = useState(0);
  const [rating, setRating] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'profile' | 'notifications' | 'security'>('profile');

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
        setCompletedRentals(bookings.filter((b) => b.status === 'completed'));
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
    <div className="p1-work-page p1-account">
      <div>
        <WorkspaceHeader title="A little more about you." description="Help the people you rent from and lend to get to know you." />

        {error && <Alert tone="error" className="mb-4">{error}</Alert>}
        <div className="p1-profile-layout">
          <aside aria-label="Account identity">
            {profile.avatar_url ? <img className="p1-avatar account-profile-avatar" src={profile.avatar_url} alt="" /> : <span aria-hidden="true" className="p1-avatar account-profile-avatar account-chat-avatar">{profile.full_name?.charAt(0) || 'Y'}</span>}
            <h2>{profile.full_name}</h2>
            <p className="mt-2 text-sm text-sec break-words">{profile.email}</p>
            <div className="mt-3"><Badge tone="neutral">Member since {joinedYear}</Badge></div>
            {profile.customer_id && <p className="mt-3 text-xs text-sec break-all">Customer ID: <span className="select-all">{profile.customer_id}</span></p>}
            {!loading && !error && <div className="mt-3"><Rating value={rating} count={reviewCount} size="sm" /></div>}
            <div className="p1-profile-counts" aria-busy={loading}>
              <span><b>{loading || error ? '—' : completedRentals.length}</b> completed rentals</span>
              <span><b>{loading || error ? '—' : listingCount}</b> listings owned</span>
            </div>
          </aside>
          <div>
          <nav className="p1-tabs p1-space-bottom" aria-label="Account sections">
            <button type="button" aria-pressed={tab === 'profile'} onClick={() => setTab('profile')}>Profile</button>
            <button type="button" aria-pressed={tab === 'notifications'} onClick={() => setTab('notifications')}>Notifications</button>
            <button type="button" aria-pressed={tab === 'security'} onClick={() => setTab('security')}>Security</button>
          </nav>
          <section hidden={tab !== 'profile'} aria-label="Profile and activity">
            <div className="p1-section-head"><div><h2>Your profile</h2><p>Account information comes from your sign-in provider. Country and region are optional, self-reported details.</p></div></div>
            <div className="p1-form-two p1-space-bottom">
              <label className="p1-field">Full name<input readOnly value={profile.full_name ?? ''} aria-describedby="account-provider-note" /></label>
              <label className="p1-field">Email<input readOnly value={profile.email ?? ''} aria-describedby="account-provider-note" /></label>
            </div>
            <p id="account-provider-note" className="p1-muted">Name and email are managed by your sign-in provider.</p>

        <ProfileGeography key={profile.id} userId={profile.id} initialCountry={profile.country_code??''} initialRegion={profile.state_region_code??''}/>

        <div className="p1-owner-metrics account-profile-metrics" aria-label="Account activity" aria-busy={loading}>
          <StatCard icon={Package} label="Completed rentals" value={loading || error ? '-' : completedRentals.length} />
          <StatCard icon={Clock} label="Listings owned" value={loading || error ? '-' : listingCount} />
          <StatCard icon={Shield} label="Reviews received" value={loading || error ? '-' : reviewCount} />
          <StatCard icon={TrendingUp} label="Average rating" value={loading || error || reviewCount === 0 ? '-' : rating.toFixed(1)} />
        </div>

        {completedRentals.length > 0 && (
          <Surface className="p1-panel account-panel p1-space-bottom">
            <h3 className="font-semibold text-main font-display mb-4">Recent rentals</h3>
            <div className="space-y-1">
              {completedRentals.slice(0, 3).map((booking) => (
                <button
                  key={booking.id}
                  onClick={() => navigate({ name: 'listing', id: booking.listingId })}
                  className="w-full flex items-center gap-3 -mx-2 px-2 py-2 rounded-card text-left hover:bg-subtle transition-colors duration-fast"
                >
                  <img src={booking.listingImage} alt="" className="w-11 h-11 rounded-card object-cover shrink-0 bg-subtle" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-main truncate">{booking.listingTitle}</p>
                    <p className="text-xs text-sec">
                      Completed {new Date(booking.endDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                    </p>
                  </div>
                  <ArrowRight size={15} className="text-muted shrink-0" />
                </button>
              ))}
            </div>
          </Surface>
        )}

          </section>
          <section hidden={tab !== 'notifications'} aria-label="Notification settings">
            <div className="p1-section-head"><div><h2>Keep the useful updates.</h2><p>Choose rental, message, request and community updates independently for email and in-app notifications.</p></div></div>
            <Button variant="secondary" onClick={() => navigate({ name: 'notifications' })}>Open notifications & preferences</Button>
          </section>
          <section hidden={tab !== 'security'} aria-label="Account security">
            <div className="p1-section-head"><div><h2>Trust and verification</h2><p>Your real authentication provider and verified email status. These are not identity or item-safety guarantees.</p></div></div>
            {authError && <Alert tone="error" className="mb-4">{authError}</Alert>}
            <div className="space-y-3 mb-5">
              <TrustRow label={`Signed in with ${authProviderLabel(user?.app_metadata.provider)}`} verified={Boolean(user?.app_metadata.provider)} />
              <TrustRow label="Email verified" verified={Boolean(user?.email_confirmed_at)} />
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" onClick={openSignIn}>Switch account</Button>
              <Button variant="secondary" loading={authBusy === 'sign-out'} icon={<LogOut size={15} />} onClick={() => void signOut()}>Sign out</Button>
            </div>
            <p className="text-sm text-sec mt-4">Signing out of YBuy does not sign you out of {authProviderLabel(user?.app_metadata.provider)}.</p>
          </section>
          <section className="mt-8 border-t border-app pt-6" aria-label="Account shortcuts">
          <div className="grid sm:grid-cols-2 gap-2">
          <Button fullWidth variant="secondary" icon={<Heart size={16} />} trailingIcon={<ArrowRight size={16} />} onClick={() => navigate({ name: 'favorites' })}>
            Saved items
          </Button>
          <Button fullWidth trailingIcon={<ArrowRight size={16} />} onClick={() => navigate({ name: 'dashboard', tab: 'renting' })}>
            Bookings
          </Button>
          <Button variant="secondary" onClick={() => navigate({ name: 'support' })}>Support tickets</Button>
          <Button variant="secondary" onClick={() => navigate({ name: 'claims' })}>Disputes & claims</Button>
          <Button variant="ghost" onClick={() => navigate({ name: 'wallet' })}>Test wallet · not cash</Button>
        </div>
          </section>
          </div>
        </div>
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
  return <Surface className="p1-panel account-panel p1-space-bottom">
    <h2 className="font-semibold text-main font-display">Country and region</h2>
    <p className="text-xs text-sec mt-1">Optional self-reported account information, also saved with future rentals. This does not verify identity, change your Customer ID, or determine payment currency. Existing rentals keep their original records.</p>
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
      <fieldset disabled={loading||saving} className="p1-form-two">
        <label className="p1-field">Country (optional)
          <Dropdown aria-label="Country (optional)" disabled={loading||saving} value={country||'not-provided'} onChange={value=>{setCountry(value==='not-provided'?'':value);setRegion('');setSaved(false);}}
            options={[{value:'not-provided',label:'Not provided'},...countries.map(item=>({value:item.code,label:item.name}))]} />
        </label>
        <label className="p1-field">State / region (optional)
          <Dropdown aria-label="State / region (optional)" disabled={loading||saving||!country||regionsLoading} value={region||'not-provided'} onChange={value=>{setRegion(value==='not-provided'?'':value);setSaved(false);}}
            options={[{value:'not-provided',label:'Not provided'},...regions.map(item=>({value:item.code,label:item.name}))]} />
        </label>
      </fieldset>
      {error&&<Alert tone="error">{error}</Alert>}
      {saved&&<Alert tone="success">Country and region saved.</Alert>}
      <Button type="submit" variant="secondary" size="sm" loading={saving} disabled={loading||regionsLoading||countries.length===0}>Save country and region</Button>
    </form>
  </Surface>;
}

function StatCard({ label, value }: { icon: typeof Package; label: string; value: string | number }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
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
