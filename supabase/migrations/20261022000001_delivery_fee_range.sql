begin;

update public.app_settings
set value = '99'::jsonb,
    min_value = 1,
    max_value = 99,
    description = 'Maximum delivery fee per trip in USD (1-99). Delivery is arranged separately and is not charged at checkout.'
where key = 'listing_max_delivery_fee';

alter table public.listings add constraint listing_enabled_delivery_fee_range
  check (not delivery_available or delivery_fee between 1 and 99) not valid;

commit;
