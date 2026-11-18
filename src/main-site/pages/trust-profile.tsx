import { useEffect, useState } from 'react';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import { authProviderLabel } from '@/lib/auth-providers';
import { supabase } from '@/lib/supabase';
import { fetchBookingsAsRenter, type UiBooking } from '@/lib/bookings';
import { fetchReviewsForUser } from '@/lib/reviews';
import { Rating } from '@/main-site/components/trust';
import { Alert, Button, Surface, SectionHeader, Badge } from '@/main-site/components/ui';
import { CheckCircle2, Clock, Shield, TrendingUp, Package, ArrowRight, LogOut, Heart } from 'lucide-react';
import { fieldClass } from '@/main-site/components/form-classes';

export function TrustProfilePage() {
  const { navigate } = useRouter();
  const { user, profile, error: authError, authBusy, openSignIn, signOut } = useAuth();

  const [completedRentals, setCompletedRentals] = useState<UiBooking[]>([]);
  const [listingCount, setListingCount] = useState(0);
  const [rating, setRating] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    <div className="animate-fade-in pb-20 md:pb-10">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5 sm:py-8">
        <SectionHeader as="h1" title="Your profile" subtitle={`Signed in as ${profile.email}`} className="mb-6" action={
          <Button variant="secondary" size="sm" loading={authBusy === 'sign-out'} icon={<LogOut size={15} />} onClick={() => void signOut()}>
            Sign out
          </Button>
        } />

        {error && <Alert tone="error" className="mb-4">{error}</Alert>}
        <div className="mb-5">
          <Button variant="ghost" size="sm" onClick={openSignIn}>Switch account</Button>
          <Button variant="ghost" size="sm" onClick={() => navigate({ name: 'support' })}>Support tickets</Button>
          <Button variant="ghost" size="sm" onClick={() => navigate({ name: 'claims' })}>Disputes & claims</Button>
          <Button variant="ghost" size="sm" onClick={() => navigate({ name: 'wallet' })}>Test wallet</Button>
          <Button variant="ghost" size="sm" onClick={() => navigate({ name: 'notifications' })}>Notifications</Button>
          <p className="text-xs text-sec mt-1">Signing out of YBuy does not sign you out of {authProviderLabel(user?.app_metadata.provider)}.</p>
        </div>

        {/* Profile card */}
        <Surface className="p-6 mb-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-5">
            <img
              src={profile.avatar_url ?? undefined}
              alt=""
              className="w-20 h-20 rounded-full object-cover shrink-0 bg-subtle"
            />
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-main font-display">{profile.full_name}</h2>
              {profile.customer_id && <p className="mt-1 text-sm text-sec">Customer ID: <span className="font-mono select-all">{profile.customer_id}</span></p>}
              <div className="flex items-center gap-2 flex-wrap mt-1.5">
                <Rating value={rating} count={reviewCount} size="sm" />
                <Badge tone="neutral">Member since {joinedYear}</Badge>
              </div>
            </div>
          </div>
        </Surface>

        <ProfileGeography key={profile.id} userId={profile.id} initialCountry={profile.country_code??''} initialRegion={profile.state_region_code??''}/>

        {/* Trust stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <StatCard icon={Package} label="Completed rentals" value={loading || error ? '-' : completedRentals.length} />
          <StatCard icon={Clock} label="Listings owned" value={loading || error ? '-' : listingCount} />
          <StatCard icon={Shield} label="Reviews received" value={loading || error ? '-' : reviewCount} />
          <StatCard icon={TrendingUp} label="Average rating" value={loading || error || reviewCount === 0 ? '-' : rating.toFixed(1)} />
        </div>

        {/* Trust details */}
        <Surface className="p-5 mb-4">
          <h3 className="font-semibold text-main font-display mb-4">Trust and verification</h3>
          <div className="space-y-2.5">
            <TrustRow label={`Signed in with ${authProviderLabel(user?.app_metadata.provider)}`} verified={Boolean(user?.app_metadata.provider)} />
            <TrustRow label="Email verified" verified={Boolean(user?.email_confirmed_at)} />
          </div>
        </Surface>

        {/* Rental history */}
        {completedRentals.length > 0 && (
          <Surface className="p-5 mb-6">
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

        <div className="grid sm:grid-cols-2 gap-2">
          <Button fullWidth variant="secondary" icon={<Heart size={16} />} trailingIcon={<ArrowRight size={16} />} onClick={() => navigate({ name: 'favorites' })}>
            Saved items
          </Button>
          <Button fullWidth trailingIcon={<ArrowRight size={16} />} onClick={() => navigate({ name: 'dashboard', tab: 'renting' })}>
            Bookings
          </Button>
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
  return <Surface className="p-5 mb-4">
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

function StatCard({ icon: Icon, label, value }: { icon: typeof Package; label: string; value: string | number }) {
  return (
    <div className="p-4 rounded-card-lg bg-card border border-app">
      <Icon size={18} className="text-sec" />
      <p className="text-2xl font-bold text-main font-display mt-2.5 tnum">{value}</p>
      <p className="text-xs text-sec mt-0.5">{label}</p>
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
