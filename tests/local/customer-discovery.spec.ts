import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { loadTestActors } from './test-accounts';

const hosted = process.env.YBUY_E2E_HOSTED === 'true';
const cliOptions = { encoding: 'utf8' as const, stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'] };
const hostedApiUrl = 'https://jzyjmsixfuwzfnntewqn.supabase.co';
const localApiUrl = 'http://localhost:54321';
const keys = hosted ? JSON.parse(execSync('pnpm exec supabase projects api-keys --project-ref jzyjmsixfuwzfnntewqn --output json', cliOptions)) as { name: string; api_key: string }[] : [];
const localStatus = hosted ? null : JSON.parse(execSync('node dev\\supabase-local.mjs status --output json', cliOptions));
if (localStatus && new URL(localStatus.API_URL).port !== '54321') throw new Error('These fixtures require the isolated local backend.');
const status = hosted ? {
  API_URL: hostedApiUrl,
  ANON_KEY: keys.find((key) => key.name === 'anon')?.api_key,
  SERVICE_ROLE_KEY: keys.find((key) => key.name === 'service_role')?.api_key,
} : { ...localStatus, API_URL: localApiUrl };
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
const actors = loadTestActors(hosted);

async function signIn(page: Page, actor: { email: string; password: string }) {
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Sign in or create an account' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email', { exact: true }).fill(actor.email);
  await dialog.getByLabel('Password', { exact: true }).fill(actor.password);
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

test('concurrent genuine local signups receive distinct immutable Customer IDs', async ({ page }) => {
  test.skip(hosted, 'Hosted Auth rate-limits public signups; run this concurrency check against local Auth.');
  const run = randomUUID();
  const clients = Array.from({ length: 6 }, () => createClient(status.API_URL, status.ANON_KEY, options));
  const created: string[] = [];
  try {
    const signups = await Promise.all(clients.map(async (client,index) => {
      const credentials = { email: `identity-${run}-${index}@example.test`, password: `Qa-${randomUUID()}!` };
      const response = await client.auth.signUp(credentials);
      if (response.data.user) created.push(response.data.user.id);
      return { response, credentials };
    }));
    signups.forEach(({ response }) => {
      expect(response.error).toBeNull();
      expect(response.data.session).not.toBeNull();
    });
    const profiles = await Promise.all(clients.map(async (client) => {
      let profile: { id:string;customer_id:string }|undefined;
      await expect.poll(async()=>{
        const result=await client.rpc('get_my_profile');
        if(result.error?.code==='PGRST303'&&result.error.message==='JWT issued at future')return false;
        expect(result.error).toBeNull();
        profile=Array.isArray(result.data)?result.data[0]:result.data;
        return true;
      },{message:'New local Auth token becomes valid at the REST clock boundary',timeout:5000}).toBe(true);
      if(!profile)throw new Error('Profile was not returned.');
      return profile;
    }));
    const identifiers = profiles.map((profile) => profile.customer_id);
    expect(new Set(identifiers).size).toBe(6);
    identifiers.forEach((identifier) => expect(identifier).toMatch(/^YB-\d{10}$/));
    const edited = await clients[0].from('profiles').update({ full_name: 'Renamed QA Customer', location: 'Toronto, Canada', phone: '5551234567' }).eq('id',profiles[0].id);
    expect(edited.error).toBeNull();
    const tamper = await clients[0].from('profiles').update({ customer_id: 'YB-9999999999' }).eq('id',profiles[0].id);
    expect(tamper.error?.message).toContain('immutable');
    await signIn(page,signups[0].credentials);
    await expect(page.getByText(identifiers[0], { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(identifiers[0], { exact: true })).toBeVisible();
    await page.getByRole('combobox',{name:'Country (optional)',exact:true}).selectOption('US');
    await page.getByRole('combobox',{name:'State / region (optional)',exact:true}).selectOption('US-TX');
    await page.getByRole('button',{name:'Save country and region',exact:true}).click();
    await expect(page.getByText('Country and region saved.',{exact:true})).toBeVisible();
    await page.reload();
    await expect(page.getByRole('combobox',{name:'Country (optional)',exact:true})).toHaveValue('US');
    await expect(page.getByRole('combobox',{name:'State / region (optional)',exact:true})).toHaveValue('US-TX');
    await expect(page.getByText(identifiers[0],{exact:true})).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('stable-customer-id.png') });
  } finally {
    for (const id of created) {
      const deleted = await admin.auth.admin.deleteUser(id);
      expect(deleted.error).toBeNull();
    }
  }
});

test('real coordinate search honors five-mile default, optional dates, expansion and persisted coordinates', async ({ page }) => {
  const owner = actors.find((actor) => actor.email === 'owner2@example.test')!;
  const ownerApi = createClient(status.API_URL, status.ANON_KEY, options);
  expect((await ownerApi.auth.signInWithPassword(owner)).error).toBeNull();
  const category = await ownerApi.from('categories').select('id').limit(1).single();
  expect(category.error).toBeNull();
  const keyword = `Geo-${randomUUID()}`;
  const listingIds: string[] = [];
  const start = new Date(Date.now()+10*86400000).toISOString().slice(0,10);
  const end = new Date(Date.now()+12*86400000).toISOString().slice(0,10);
  try {
    for (const [label,latitude] of [['Near',32.85],['Far',32.90]] as const) {
      const listing = await ownerApi.from('listings').insert({
        owner_id: owner.id,category_id: category.data!.id,title: `${keyword} ${label}`,price_per_day: 10,
        description: 'Isolated coordinate discovery fixture.',status: 'draft',location_label: 'Different city labels',
        location_lat: latitude,location_lng: -96.8,available_quantity: 1,estimated_value:200,item_condition:'good',
        availability_start: start,availability_end: end,
      }).select('id').single();
      expect(listing.error).toBeNull();
      listingIds.push(listing.data!.id);
      expect((await ownerApi.from('listing_images').insert({
        listing_id: listing.data!.id, url: `https://example.test/${label.toLowerCase()}-geo-fixture.jpg`, sort_order: 0,
      })).error).toBeNull();
      expect((await ownerApi.from('listing_pickup_locations').insert({
        listing_id: listing.data!.id, owner_id: owner.id, address: 'Private test pickup', city: 'Test city',
        state: 'TX', postal_code: '75001', country: 'US', latitude, longitude: -96.8,
      })).error).toBeNull();
      expect((await ownerApi.from('listings').update({ status: 'published' }).eq('id',listing.data!.id)).error).toBeNull();
    }
    expect((await ownerApi.from('listing_availability').insert({ listing_id: listingIds[0], date: start, is_available: false })).error).toBeNull();
    await page.goto(`/search?q=${keyword}&lat=32.8&lng=-96.8`);
    await expect(page.locator(`a[href="/listing/${listingIds[0]}"]`)).toBeVisible();
    await expect(page.locator(`a[href="/listing/${listingIds[1]}"]`)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Within 5 mi' })).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ybuy-marketplace-location')!).latitude)).toBe(32.8);
    await page.reload();
    await expect(page.locator(`a[href="/listing/${listingIds[0]}"]`)).toBeVisible();
    await page.getByRole('button', { name: /^Filters/ }).click();
    await page.getByLabel(/^Max distance:/).click();
    await page.getByRole('option', { name: 'Within 10 miles', exact: true }).click();
    await expect(page.locator(`a[href="/listing/${listingIds[1]}"]`)).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('real-radius-expanded.png') });
    await page.goto(`/search?q=${keyword}&lat=32.8&lng=-96.8&start=${start}&end=${end}&radius=5`);
    await expect(page.getByRole('heading', { name: "Couldn't find what you need?" })).toBeVisible();
    await expect(page.locator(`a[href="/listing/${listingIds[0]}"]`)).toHaveCount(0);
    await page.getByRole('button', { name: 'Search 10 miles', exact: true }).click();
    await expect(page.locator(`a[href="/listing/${listingIds[1]}"]`)).toBeVisible();
    await expect(page.locator(`a[href="/listing/${listingIds[0]}"]`)).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('real-date-availability.png') });
  } finally {
    if (listingIds.length) {
      expect((await ownerApi.from('listing_availability').delete().in('listing_id',listingIds)).error).toBeNull();
      expect((await ownerApi.from('listings').delete().in('id',listingIds)).error).toBeNull();
    }
  }
});

test('real investigation UI requires its own permission and audits CSV lookups', async ({ page }) => {
  const credentials = { email: `investigator-${randomUUID()}@example.test`, password: `Qa-${randomUUID()}!` };
  const actor = await admin.auth.admin.createUser({ ...credentials, email_confirm: true, user_metadata: { full_name: 'QA Investigator' } });
  expect(actor.error).toBeNull();
  const userId = actor.data.user!.id;
  try {
    expect((await admin.from('profiles').update({country_code:'US',state_region_code:'US-TX'}).eq('id',userId)).error).toBeNull();
    expect((await admin.from('admin_users').insert({ user_id: userId,role: 'admin',permissions: ['users.manage'] })).error).toBeNull();
    await signIn(page,credentials);
    const investigatorApi = createClient(status.API_URL,status.ANON_KEY,options);
    expect((await investigatorApi.auth.signInWithPassword(credentials)).error).toBeNull();
    const profile = await investigatorApi.rpc('get_my_profile');
    expect(profile.error).toBeNull();
    const customerId = (Array.isArray(profile.data) ? profile.data[0] : profile.data).customer_id;
    const denied = await investigatorApi.rpc('admin_investigate_customers', {
      p_customer_ids: [customerId],p_from: new Date(Date.now()-86400000).toISOString(),p_to: new Date(Date.now()+86400000).toISOString(),p_reason: 'QA permission validation',
    });

    expect(denied.error?.code).toBe('42501');
    await page.goto('/admin/investigations');
    await expect(page.getByRole('navigation', { name: 'Admin', exact: true }).getByRole('button', { name: 'Customer investigations', exact: true })).toHaveCount(0);
    expect((await admin.from('admin_users').update({ permissions: ['fraud.investigate'] }).eq('user_id',userId)).error).toBeNull();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Customer investigations',exact: true })).toBeVisible();
    await page.getByLabel('Import CSV').setInputFiles({
      name: 'customer-ids.csv',mimeType: 'text/csv',
      buffer: Buffer.from(`customer_id\n"${customerId.toLowerCase()}"\n${customerId}\ninvalid\nYB-9999999999\n`),
    });
    await expect(page.getByRole('status').filter({ hasText: 'Imported 3 distinct identifiers' })).toBeVisible();
    await page.getByLabel('Investigation reason').fill('QA repeatable CSV investigation');
    await page.getByRole('button', { name: 'Investigate customers',exact: true }).click();
    const table = page.getByRole('table');
    await expect(table.getByRole('cell', { name: customerId,exact: true })).toBeVisible();
    await expect(table.getByRole('cell', { name: 'found',exact: true })).toBeVisible();
    await expect(table.getByRole('cell', { name: 'invalid',exact: true })).toBeVisible();
    await expect(table.getByRole('cell', { name: 'unknown',exact: true })).toBeVisible();
    const audit = await admin.from('admin_audit_log').select('reason,new_value').eq('actor_id',userId).eq('action','customer.investigate')
      .eq('reason','QA repeatable CSV investigation').order('created_at',{ascending:false}).limit(1).single();
    expect(audit.error).toBeNull();
    expect(audit.data!.reason).toBe('QA repeatable CSV investigation');
    expect(audit.data!.new_value.customer_ids).toContain(customerId);
    await page.getByLabel('Country code (optional)',{exact:true}).fill('CA');
    await page.getByRole('combobox',{name:'Group results',exact:true}).selectOption('country');
    await page.getByLabel('Investigation reason').fill('QA geographic filter');
    await page.getByRole('button',{name:'Investigate customers',exact:true}).click();
    await expect(table.getByRole('cell',{name:customerId,exact:true})).toHaveCount(0);
    await expect(table.getByRole('cell',{name:'invalid',exact:true})).toBeVisible();
    await expect(table.getByRole('cell',{name:'unknown',exact:true})).toBeVisible();
    await page.getByLabel('Country code (optional)',{exact:true}).fill('US');
    await page.getByLabel('Subdivision code (optional)',{exact:true}).fill('US-TX');
    await page.getByRole('combobox',{name:'Group results',exact:true}).selectOption('region');
    await page.getByRole('button',{name:'Investigate customers',exact:true}).click();
    await expect(table.getByRole('cell',{name:customerId,exact:true})).toBeVisible();
    await expect(table.getByText('US / US-TX',{exact:true})).toBeVisible();
    const geographyAudit=await admin.from('admin_audit_log').select('new_value').eq('actor_id',userId)
      .eq('action','customer.investigate.geography').eq('reason','QA geographic filter')
      .order('created_at',{ascending:false}).limit(1).single();
    expect(geographyAudit.error).toBeNull();
    expect(geographyAudit.data!.new_value).toMatchObject({country_code:'US',region_code:'US-TX',group_by:'region'});
    await page.setViewportSize({ width: 375,height: 812 });
    await expect(page.getByRole('button', { name: 'Investigate customers',exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('authorized-investigation-mobile.png'),fullPage: true });
    expect((await admin.from('admin_users').update({ active: false }).eq('user_id',userId)).error).toBeNull();
    const revoked = await investigatorApi.rpc('admin_investigate_customers_geography', {
      p_customer_ids: [customerId],p_from: new Date(Date.now()-86400000).toISOString(),p_to: new Date(Date.now()+86400000).toISOString(),p_reason: 'QA revoked permission',
    });
    expect(revoked.error?.code).toBe('42501');
  } finally {
    expect((await admin.auth.admin.deleteUser(userId)).error).toBeNull();
  }
});

test('real request form suggests existing nearby listings and persists a located request',async({page})=>{
      const owner=actors.find(actor=>actor.email==='owner4@example.test')!;
      const renter=actors.find(actor=>actor.email==='renter4@example.test')!;
      const ownerApi=createClient(status.API_URL,status.ANON_KEY,options);
      const renterApi=createClient(status.API_URL,status.ANON_KEY,options);
      expect((await ownerApi.auth.signInWithPassword(owner)).error).toBeNull();
      expect((await renterApi.auth.signInWithPassword(renter)).error).toBeNull();
      const flag=await admin.from('feature_flags').select('enabled').eq('key','item_requests').single();
      expect(flag.error).toBeNull();
      const category=await ownerApi.from('categories').select('id').limit(1).single();
      expect(category.error).toBeNull();
      const title=`RequestQA ${randomUUID()}`;
      const availabilityStart=new Date(Date.now()+86400000).toISOString().slice(0,10);
      const availabilityEnd=new Date(Date.now()+90*86400000).toISOString().slice(0,10);
      let listingId:string|undefined;
      let requestId:string|undefined;
      try{
        expect((await admin.from('feature_flags').update({enabled:true}).eq('key','item_requests')).error).toBeNull();
        await page.routeWebSocket('**/realtime/v1/websocket**', socket => {
          socket.onMessage(message => {
            const [joinRef, ref, topic, event, payload] = JSON.parse(String(message));
            if (event === 'phx_join') {
              socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', {
                status: 'ok', response: { postgres_changes: payload.config.postgres_changes.map((filter: object) => ({ ...filter, id: 1 })) },
              }]));
            } else if (event === 'heartbeat' || event === 'phx_leave') {
              socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]));
            }
          });
        });
        const listing=await ownerApi.from('listings').insert({
          owner_id:owner.id,category_id:category.data!.id,title,description:'Isolated nearby request matching fixture.',
          price_per_day:10,deposit:0,estimated_value:200,item_condition:'good',status:'draft',
          availability_start:availabilityStart,availability_end:availabilityEnd,
          location_label:'Dallas, Texas',location_lat:32.8,location_lng:-96.8,
        }).select('id').single();
        expect(listing.error).toBeNull();
        listingId=listing.data!.id;
        expect((await ownerApi.from('listing_images').insert({ listing_id:listingId,url:'https://example.test/request-fixture.jpg',sort_order:0 })).error).toBeNull();
        expect((await ownerApi.from('listing_pickup_locations').insert({
          listing_id:listingId,owner_id:owner.id,address:'Private test pickup',city:'Dallas',state:'TX',postal_code:'75201',country:'US',latitude:32.8,longitude:-96.8,
        })).error).toBeNull();
        const published=await ownerApi.from('listings').update({ status:'published' }).eq('id',listingId).select('status').single();
        expect(published.error).toBeNull();
        expect(published.data!.status).toBe('published');
        await page.route('**/src/lib/geo.ts*',async route=>{
          const response=await route.fetch();
          await route.fulfill({response,body:(await response.text()).replace(/const key = [^\n]+;/g,'const key = "test-map-key";')});
        });
        await page.route('**/api.maptiler.com/geocoding/**',route=>route.fulfill({
          contentType:'application/json',body:JSON.stringify({features:[{
            text:'Dallas',center:[-96.8,32.8],place_type:['municipality'],
            context:[{id:'region.1',text:'Texas'},{id:'country.1',text:'United States'}],
          }]}),
        }));
        await signIn(page,renter);
        await page.goto('/need-something',{waitUntil:'domcontentloaded'});
        await page.getByRole('textbox',{name:/^Item name/}).fill(title);
        await page.getByRole('combobox',{name:/^Category/}).selectOption(category.data!.id);
        await page.getByRole('textbox',{name:/^Description/}).fill('A camera needed for an isolated geographic matching test.');
        await page.getByRole('textbox',{name:/^Preferred area/}).fill('Dallas');
        await page.getByRole('button',{name:'Find area',exact:true}).click();
        await page.getByRole('group',{name:'Choose request area'}).getByRole('button',{name:'Dallas, Texas',exact:true}).click();
        await page.getByRole('checkbox',{name:/I understand this request/}).check();
        await page.getByRole('button',{name:'Post request',exact:true}).click();
        await expect(page.getByText('Existing listings may meet your request.',{exact:false})).toBeVisible();
        await expect(page.getByRole('link',{name:new RegExp(title)})).toHaveAttribute('href',`/listing/${listingId}`);
        expect((await renterApi.from('item_requests').select('id').eq('title',title)).data).toHaveLength(0);
        await page.getByRole('checkbox',{name:/I reviewed these listings/}).check();
        await page.getByRole('button',{name:'Post request',exact:true}).click();
        await expect(page.getByRole('heading',{name:'Your request is posted'})).toBeVisible();
        const request=await renterApi.from('item_requests').select('id,location_lat,location_lng,radius_miles').eq('title',title).single();
        expect(request.error).toBeNull();
        requestId=request.data!.id;
        expect(request.data).toMatchObject({location_lat:32.8,location_lng:-96.8,radius_miles:5});
        await expect(page.getByRole('button',{name:'Continue exploring',exact:true})).toBeVisible();
        await page.getByRole('button',{name:'View my requests',exact:true}).click();
        await page.getByRole('tab',{name:'My requests',exact:true}).click();
        await page.locator(`[aria-controls="request-details-${requestId}"]`).click();
        await expect(page.getByRole('link',{name:title,exact:true})).toHaveAttribute('href',`/listing/${listingId}`);
        await expect(page.getByText('Estimated rental before fees and deposit: $10.00. Availability is rechecked when you book.',{exact:true}).first()).toBeVisible();
        await expect(page.getByText('Request created',{exact:true})).toBeVisible();
        await page.setViewportSize({width:375,height:812});
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        await page.screenshot({path:test.info().outputPath('located-request-nearby-match.png')});
      }finally{
        if(!requestId){
          const created=await renterApi.from('item_requests').select('id').eq('title',title);
          expect(created.error).toBeNull();
          requestId=created.data?.[0]?.id;
        }
        if(requestId)expect((await renterApi.rpc('close_item_request',{p_request_id:requestId,p_action:'cancel'})).error).toBeNull();
        if(listingId)expect((await ownerApi.from('listings').delete().eq('id',listingId)).error).toBeNull();
        expect((await admin.from('feature_flags').update({enabled:flag.data!.enabled}).eq('key','item_requests')).error).toBeNull();
      }
    });
