import { useId, useState } from 'react';
import { Alert, Button, Surface } from '@/main-site/components/ui';
import { Skeleton } from '@/main-site/components/skeleton';
import { fmtDate, money, useLoad } from '@/main-site/components/operations/query-utils';
import { getMyRewards, redeemTestRewardPoints } from '@/lib/rewards';
import { useAuth } from '@/auth-context';
import { useRouter } from '@/router';

export function RewardsPanel({ compact = false }: { compact?: boolean }) {
  const { user } = useAuth();
  const { navigate } = useRouter();
  const { data, loading, error, reload } = useLoad(getMyRewards, [user?.id]);
  return <Surface className="p-5 space-y-3">
    <h2 className="font-semibold font-display text-main">YBuy Points <span className="text-xs font-normal text-sec">Test only</span></h2>
    {loading && <Skeleton className="h-16 w-full" />}
    {error && <Alert tone="error">{error}<Button variant="secondary" onClick={reload}>Retry rewards</Button></Alert>}
    {!loading && data && <>
      <p className="text-3xl font-bold text-main tnum">{data.balance.toLocaleString()} <span className="text-sm font-normal text-sec">points</span></p>
      <p className="text-sm text-sec">500 PTS = $5. Free to join. No subscription.</p>
      {!data.enabled ? <Alert tone="info">Test rewards are disabled. No points can be earned or redeemed until local financial testing is enabled.</Alert>
        : !data.signup_enabled ? <p className="text-sm text-sec">Signup rewards are paused. Existing points remain available for testing.</p>
        : data.awarded ? <p className="text-sm text-sec">Your signup reward has been added.</p>
        : !data.eligible ? <p className="text-sm text-sec">Signup rewards are for accounts created after the rewards launch.</p>
        : !data.verified ? <p className="text-sm text-sec">Get {data.signup_points.toLocaleString()} points after email and phone verification. SMS verification is not enabled in this test build.</p>
        : <p className="text-sm text-sec">This account is not eligible for another signup reward.</p>}
      {compact ? <Button variant="secondary" size="sm" onClick={() => navigate({ name: 'wallet' })}>View rewards wallet</Button> : <>
        <Alert tone="warning">Simulation only. Points do not reduce Stripe payments or represent cash.</Alert>
        <p className="text-sm text-sec">100 points = $1. Redeem 500 points for a simulated $5 rental discount per booking with at least $5 in rental charges. Fees and security deposits are excluded. No cash withdrawals, transfers or expiration.</p>
        <p className="text-xs text-sec">One signup reward per verified account and verified email/phone identity. Latest 100 transactions shown.</p>
        {data.transactions.length === 0 ? <p className="text-sm text-sec">No points transactions yet.</p> : <ul className="divide-y divide-[var(--border)]">
          {data.transactions.map(entry => <li key={entry.id} className="py-3 text-sm text-main">
            <div className="flex justify-between gap-3">
              <span>{entry.kind === 'signup' ? 'Signup reward' : entry.kind === 'redemption' ? 'Test rental redemption' : 'Cancelled rental points returned'}</span>
              <span className="tnum shrink-0">{entry.points > 0 ? '+' : ''}{entry.points} PTS</span>
            </div>
            <p className="text-xs text-sec mt-1">{fmtDate(entry.created_at)}</p>
          </li>)}
        </ul>}
      </>}
    </>}
  </Surface>;
}

export function CheckoutRewards({ bookingId, rentalSubtotal }: { bookingId: string; rentalSubtotal: number }) {
  const { user } = useAuth();
  const rewards = useLoad(getMyRewards, [user?.id, bookingId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const redeemed = rewards.data?.transactions.some(entry => entry.booking_id === bookingId && entry.kind === 'redemption');
  async function redeem() {
    setBusy(true);
    setError(null);
    try {
      await redeemTestRewardPoints(bookingId);
      rewards.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not redeem test points.');
    } finally {
      setBusy(false);
    }
  }
  return <Surface className="p-5 mb-5 space-y-3">
    <h2 className="font-semibold text-main font-display">Try YBuy Points</h2>
    <p className="text-sm text-sec">Simulation only. Your actual payment total below does not change.</p>
    {rewards.loading && <Skeleton className="h-11 w-full" />}
    {(rewards.error || error) && <Alert tone="error">{rewards.error || error}
      {rewards.error && <Button variant="secondary" onClick={rewards.reload}>Retry rewards</Button>}
    </Alert>}
    {!rewards.loading && rewards.data && (redeemed
      ? <p role="status" className="text-sm text-main">500 test points redeemed: simulated rental discount $5.00. No discount is applied to Stripe.</p>
      : <>
        <p className="text-sm text-sec">{rewards.data.balance.toLocaleString()} points available. Minimum 500 points; maximum $5 per booking. Rental charges only, not fees or deposits.</p>
        {!rewards.data.enabled && <p className="text-sm text-sec">Local financial testing is disabled.</p>}
        {rentalSubtotal < 5 && <p className="text-sm text-sec">Rental charges must be at least $5 to redeem.</p>}
        <Button variant="secondary" loading={busy} loadingLabel="Redeeming test points..."
          disabled={!rewards.data.enabled || rewards.data.balance < 500 || rentalSubtotal < 5}
          onClick={redeem}>Simulate redeeming 500 points ($5)</Button>
      </>)}
  </Surface>;
}

export function CheckoutPointsPicker({
  selected, applied, onSelectionChange, rentalSubtotal, total, disabled,
}: {
  selected: boolean;
  applied: boolean;
  onSelectionChange: (selected: boolean) => void;
  rentalSubtotal: number;
  total: number;
  disabled: boolean;
}) {
  const { user } = useAuth();
  const rewards = useLoad(getMyRewards, [user?.id]);
  const sliderId = useId();
  const eligible = rewards.data?.enabled && rewards.data.balance >= 500 && rentalSubtotal >= 5;
  return <section aria-label="Apply YBuy Points" className="mt-4 pt-4 border-t border-app space-y-2">
    <div className="flex flex-wrap justify-between gap-2 text-sm">
      <label htmlFor={sliderId} className="font-semibold text-main">Apply YBuy Points</label>
      <span className="text-sec">Test only · 500 PTS = $5</span>
    </div>
    {rewards.loading && <p className="text-xs text-sec">Checking your points balance...</p>}
    {rewards.error && <Alert tone="error">{rewards.error}
      <Button variant="secondary" size="sm" onClick={rewards.reload}>Retry rewards</Button>
    </Alert>}
    {!rewards.loading && rewards.data && <p className="text-sm text-sec">
      {applied ? '500 points applied to this test booking.' : `${rewards.data.balance.toLocaleString()} points available`}
    </p>}
    <input id={sliderId} type="range" min={0} max={500} step={500} value={selected ? 500 : 0}
      disabled={disabled || applied || rewards.loading || Boolean(rewards.error) || !eligible}
      onChange={event => onSelectionChange(event.currentTarget.value === '500')}
      aria-valuetext={selected ? '500 points, $5 test discount' : '0 points, no discount'}
      aria-describedby={`${sliderId}-rules`}
      className="w-full min-h-11 accent-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" />
    <div className="flex justify-between text-xs text-sec"><span>0 points</span><span>500 points ($5)</span></div>
    {!rewards.loading && rewards.data && !applied && <>
      {!rewards.data.enabled ? <p className="text-xs text-sec">Local financial testing is disabled.</p>
        : rewards.data.balance < 500 && <p className="text-xs text-sec">At least 500 points are required.</p>}
      {rentalSubtotal < 5 && <p className="text-xs text-sec">Rental charges must be at least $5 to apply points.</p>}
    </>}
    {selected && <div className="space-y-2 text-sm text-main pt-2" aria-live="polite">
      <div className="flex justify-between gap-3"><span>Points discount (simulation)</span><span className="tnum">-$5.00</span></div>
      <div className="flex justify-between gap-3 font-semibold"><span>Simulated total after points</span><span className="tnum">{money(total - 5)}</span></div>
    </div>}
    <p id={`${sliderId}-rules`} className="text-xs text-sec">
      Minimum and maximum: 500 points per booking. Rental charges only, not fees or deposits.
      {' '}{applied ? 'Points have been spent in the test ledger.' : 'Points are spent only after your booking is saved.'}
      {' '}Simulation only: your actual payment remains {money(total)}. No discount is applied to Stripe.
    </p>
  </section>;
}
