-- Extends listing_flags (from 20260923000003) to support the combined text+photo moderation
-- pass: deterministic contact-info/profanity flags (Task 1) alongside AI-detected guideline
-- flags (Task 2). Still service-role-write-only, zero client-facing RLS policies.
alter table public.listing_flags
  add column type text not null default 'other_guideline',
  add column source text,
  add column auto_masked boolean not null default false;

alter table public.listing_flags
  add constraint listing_flags_type_check
    check (type in ('contact_info', 'profanity', 'prohibited_item', 'drug_related', 'other_guideline'));

alter table public.listing_flags
  add constraint listing_flags_source_check
    check (source is null or source in ('photo', 'text', 'both'));

alter table public.listing_flags alter column type drop default;
