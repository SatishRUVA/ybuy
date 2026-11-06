import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { podman } from './podman.mjs';

const source = ts.transpileModule(readFileSync(new URL('../src/data.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const { listings } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const templates = ['l1', 'l11', 'l3', 'l8', 'l2', 'l4', 'l6', 'l7', 'l9', 'l12'].map(id => listings.find(item => item.id === id));
assert.equal(templates.filter(Boolean).length, 10, 'All ten existing listing templates are required.');
const cities = [
  { name: 'Dallas', state: 'TX', zip: '75201', lat: 32.7767, lng: -96.7970 },
  { name: 'Irving', state: 'TX', zip: '75039', lat: 32.9247, lng: -96.9598 },
  { name: 'Omaha', state: 'NE', zip: '68102', lat: 41.2565, lng: -95.9345 },
];
const categoryNames = {
  Cameras: 'Electronics', Electronics: 'Electronics', Tools: 'Tools & Equipment',
  Camping: 'Outdoor & Camping', Sports: 'Sports & Fitness', Garden: 'Home & Garden',
  Baby: 'Other', Music: 'Electronics', Home: 'Home & Garden',
};
const data = cities.flatMap(city => templates.map((item, index) => ({
  ...city, index, template: item.id, title: item.title, description: item.description,
  category: categoryNames[item.category], price: item.pricePerDay, value: item.declaredValue,
  images: item.images, included: item.whatsIncluded, instant: index < 2 || item.instantBooking,
  delivery: item.deliveryAvailable,
})));
const literal = value => `'${value.replaceAll("'", "''")}'`;
const sql = `
begin;
do $seed$
declare
  row jsonb; listing_id uuid; owner_id uuid; category_id uuid; admin_id uuid;
  image jsonb; position integer; inserted integer:=0;
begin
  select user_id into admin_id from public.admin_users
    where active and role='super_admin' and user_id in (
      select id from auth.users where email='super-admin@profiles.ybuy.test'
      and raw_app_meta_data->>'local_test_fixture'='ybuy-local-profile-picker-v1');
  if admin_id is null then raise exception 'Isolated local profiles are required. Start npm run dev:local first.'; end if;
  for row in select value from jsonb_array_elements(${literal(JSON.stringify(data))}::jsonb) loop
    listing_id:=md5('ybuy-local-city-listings-v1:'||(row->>'name')||':'||(row->>'template'))::uuid;
    if exists(select 1 from public.listings where id=listing_id) then continue; end if;
    select id into owner_id from auth.users
      where email='owner'||((row->>'index')::integer+1)||'@profiles.ybuy.test'
      and raw_app_meta_data->>'local_test_fixture'='ybuy-local-profile-picker-v1';
    select id into category_id from public.categories where name=row->>'category' and active;
    if owner_id is null or category_id is null then raise exception 'Missing local owner or category'; end if;
    insert into public.listings(id,owner_id,category_id,title,description,price_per_day,
      location_lat,location_lng,location_label,estimated_value,item_condition,
      availability_start,availability_end,instant_booking,delivery_available,delivery_fee,included_items,status)
    values(listing_id,owner_id,category_id,row->>'title',row->>'description',(row->>'price')::numeric,
      (row->>'lat')::double precision+0.001*(row->>'index')::integer,
      (row->>'lng')::double precision+0.001*(row->>'index')::integer,
      (row->>'name')||', '||(row->>'state'),(row->>'value')::numeric,'good',
      current_date,current_date+30,(row->>'instant')::boolean,(row->>'delivery')::boolean,
      case when (row->>'delivery')::boolean then 15 else 0 end,
      array(select jsonb_array_elements_text(row->'included')),'draft');
    position:=0;
    for image in select value from jsonb_array_elements(row->'images') loop
      insert into public.listing_images(listing_id,url,sort_order) values(listing_id,image#>>'{}',position);
      position:=position+1;
    end loop;
    insert into public.listing_pickup_locations(listing_id,owner_id,address,street_address,city,state,postal_code,country,latitude,longitude)
      values(listing_id,owner_id,'Synthetic local pickup - arrange in messages','Synthetic local pickup',
        row->>'name',row->>'state',row->>'zip','US',(row->>'lat')::double precision,(row->>'lng')::double precision);
    insert into public.listing_publication_approvals(listing_id,revision,approved_by,reason)
      select listing_id,l.revision+1,admin_id,'Authorized local synthetic marketplace seed; existing preview images.'
      from public.listings l where l.id=listing_id;
    update public.listings set status='published' where id=listing_id;
    if not exists(select 1 from public.listings where id=listing_id and status='published') then
      raise exception 'Local listing publication was not confirmed';
    end if;
    inserted:=inserted+1;
  end loop;
  raise notice 'Inserted % local listings (existing seed IDs are left unchanged).',inserted;
end;
$seed$;
commit;
select location_label,count(*) listings from public.listings
where id in (select md5('ybuy-local-city-listings-v1:'||(value->>'name')||':'||(value->>'template'))::uuid
  from jsonb_array_elements(${literal(JSON.stringify(data))}::jsonb))
group by location_label order by location_label;
`;
const result = spawnSync(podman, ['exec', '-i', 'supabase_db_YBuy', 'psql', '-X',
  '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-P', 'pager=off'], {
  input: sql, encoding: 'utf8',
});
if (result.error) throw result.error;
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
assert.equal(result.status, 0, 'Local marketplace seeding failed; the transaction was rolled back.');
