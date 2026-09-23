-- Public storage bucket for listing photos (§3.7). Images are public-read (matches
-- listings_select_published_or_own for published listings); writes restricted to the owner's
-- own listing_id-prefixed path.
insert into storage.buckets (id, name, public)
values ('listing-images', 'listing-images', true)
on conflict (id) do nothing;

create policy "listing_images_storage_public_read" on storage.objects
  for select using (bucket_id = 'listing-images');

-- Object path convention: listing-images/<listing_id>/<filename>. Only the listing's owner may
-- write to that prefix.
create policy "listing_images_storage_owner_write" on storage.objects
  for insert with check (
    bucket_id = 'listing-images'
    and exists (
      select 1 from public.listings l
      where l.id::text = (storage.foldername(name))[1] and l.owner_id = auth.uid()
    )
  );

create policy "listing_images_storage_owner_delete" on storage.objects
  for delete using (
    bucket_id = 'listing-images'
    and exists (
      select 1 from public.listings l
      where l.id::text = (storage.foldername(name))[1] and l.owner_id = auth.uid()
    )
  );
