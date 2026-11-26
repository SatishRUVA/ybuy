import type { ListingPriceQuote } from '@/lib/listing-pricing';

function formatMoney(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function Row({ label, value }: { label: string; value: number }) {
  const isCredit = value < 0;
  return (
    <div className={`flex justify-between ${isCredit ? 'text-success' : 'text-sec'}`}>
      <span>{label}</span>
      <span className={`font-medium tnum ${isCredit ? 'text-success' : 'text-main'}`}>{isCredit ? '-' : ''}${formatMoney(Math.abs(value))}</span>
    </div>
  );
}

type RentalQuote = Pick<ListingPriceQuote, 'package_kind' | 'package_days' | 'package_amount' |
  'extra_days' | 'extra_days_amount' | 'discount_amount'>;

export function CheckoutRentalPrice({ quantity, days, dailyRate, rental, createdBooking, quote }: {
  quantity: number; days: number; dailyRate: number; rental: number; createdBooking: boolean;
  quote: RentalQuote | null;
}) {
  return <>
    <Row label={createdBooking ? `Rental · ${quantity} ${quantity === 1 ? 'unit' : 'units'}`
      : quote?.package_kind
        ? `${quote.package_kind === 'monthly' ? 'Monthly' : 'Weekly'} package · ${quote.package_days} days · ${quantity} ${quantity === 1 ? 'unit' : 'units'}`
        : `Rental · $${formatMoney(dailyRate)} × ${days} ${days === 1 ? 'day' : 'days'} × ${quantity} ${quantity === 1 ? 'unit' : 'units'}`}
      value={!createdBooking && quote?.package_kind ? quote.package_amount : rental} />
    {!createdBooking && quote?.package_kind && quote.discount_amount > 0
      && <Row label="Package savings" value={-(quote?.discount_amount ?? 0)} />}
    {!createdBooking && quote?.package_kind && quote.extra_days > 0
      && <Row label={`${quote.extra_days} extra ${quote.extra_days === 1 ? 'day' : 'days'} at the daily rate`} value={quote.extra_days_amount} />}
  </>;
}
