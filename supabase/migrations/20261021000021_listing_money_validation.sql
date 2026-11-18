begin;
alter table public.listings add constraint listing_prices_finite check (
  price_per_day::text not in ('NaN','Infinity','-Infinity')
  and (price_per_week is null or price_per_week::text not in ('NaN','Infinity','-Infinity'))
  and deposit::text not in ('NaN','Infinity','-Infinity'));
commit;
