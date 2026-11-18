import { expect, test, type Page } from '@playwright/test';
import type { Session } from '@supabase/supabase-js';
import type { BookingHandoff, HandoffInspection, HandoffKind, HandoffWorkflow } from '../src/lib/booking-handoff';
import { mockSupabaseModule } from './mock-supabase';
import { appUrl } from './test-url';

const ownerId = '10000000-0000-4000-8000-000000000001';
const renterId = '10000000-0000-4000-8000-000000000002';
const bookingId = '40000000-0000-4000-8000-000000000001';
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH9sAAAAASUVORK5CYII=';
const initialTime = new Date('2026-11-17T15:30:00Z');
test.setTimeout(300000);
test.use({ actionTimeout: 15000 });

function sessionFor(id: string): Session {
  const expiresAt = Math.floor(initialTime.getTime() / 1000) + 7 * 86400;
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: id, aud: 'authenticated', role: 'authenticated', exp: expiresAt })}.test`,
    refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 7 * 86400, expires_at: expiresAt,
    user: { id, aud: 'authenticated', role: 'authenticated', email: 'handoff@example.test',
      app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
  };
}

function scenario() {
  const booking = {
    id: bookingId, listing_id: '30000000-0000-4000-8000-000000000001', renter_id: renterId, owner_id: ownerId,
    start_date: '2026-11-17', end_date: '2026-11-18', status: 'confirmed',
    quantity: 1, daily_rate: 20, days: 1, subtotal: 20, service_fee_amount: 2, deposit: 0, total: 22,
    deposit_collection_model: 'authorization', payment_first: true,
    listing: { id: '30000000-0000-4000-8000-000000000001', title: 'Handoff camera', listing_images: [{ url: image, sort_order: 0 }] },
    owner: { id: ownerId, full_name: 'Camera Owner', avatar_url: null },
    renter: { id: renterId, full_name: 'Camera Renter', avatar_url: null },
  };
  const handoff: BookingHandoff = {
    booking_id: bookingId, booking_status: 'confirmed', start_date: booking.start_date, end_date: booking.end_date,
    is_owner: false, status: null, pickup_arrived_at: null, actual_pickup_at: null, actual_return_at: null,
    return_initiated_at: null, pickup: null, return: null, events: [], cases: [],
  };
  const slots: Partial<Record<HandoffKind, {
    kind: HandoffKind; selected_date: string; slot_window: string; status: string;
    hour: number; starts_at: string; ends_at: string; time_zone: string; note: string; updated_at: string;
  }>> = {};
  const proposals: Partial<Record<HandoffKind, NonNullable<typeof slots.pickup> & { proposed_by_is_owner: boolean; version: number }>> = {};
  const state = { ready: false, failRefresh: false, otpAttempts: 0, generation: 1, version: 1,
    failRegistration: false, failEvidence: false, uploads: 0, registrationPaths: [] as string[],
    blockers: [] as string[], serverNow: initialTime.toISOString() };
  const decisions: Record<HandoffKind, HandoffWorkflow['condition_status']> = { pickup: 'pending', return: 'pending' };
  const reasons: Partial<Record<HandoffKind, string>> = {};
  function workflow(kind: HandoffKind, isOwner: boolean): HandoffWorkflow {
    const record = handoff[kind]?.inspection;
    const done = kind === 'pickup' ? Boolean(handoff.actual_pickup_at) : Boolean(handoff.actual_return_at);
    const started = kind === 'pickup' ? handoff.status !== null : ['return_initiated', 'return_inspection', 'return_otp_pending'].includes(handoff.status ?? '');
    const stage = done ? kind === 'pickup' ? 'active' : 'returned'
      : !started ? 'arrange' : record?.publication_status !== 'published' ? 'inspection'
        : ['agreed', 'disputed'].includes(decisions[kind]) ? 'verify' : 'review';
    const allowed = done ? [] : stage === 'arrange'
      ? state.ready && slots[kind]?.status === 'approved' && (kind === 'return' || isOwner) ? [kind === 'pickup' ? 'start_pickup' : 'start_return'] : []
      : stage === 'inspection' ? isOwner ? ['save_draft', ...(record?.publication_status === 'draft' ? ['publish_inspection'] : [])] : []
        : stage === 'review' ? isOwner ? [] : ['agree_inspection', 'request_correction', ...(kind === 'return' ? ['dispute_condition'] : [])]
          : isOwner ? ['verify_code'] : ['view_code'];
    return {
      version: state.version, kind, stage,
      next_actor: done ? null : stage === 'inspection' || stage === 'arrange' ? 'owner' : stage === 'review' ? 'renter' : 'owner',
      action: allowed[0] ?? null, allowed_actions: allowed, blockers: state.blockers, payment_ready: true,
      deposit_ready: true, scheduling_ready: state.ready && slots[kind]?.status === 'approved',
      condition_status: decisions[kind], physical_return_verified: Boolean(handoff.actual_return_at), financially_closed: false,
    };
  }
  async function setup(page: Page, isOwner: boolean) {
    const session = sessionFor(isOwner ? ownerId : renterId);
    await page.clock.install({ time: initialTime });
    await page.addInitScript(value => localStorage.setItem('sb-localhost-auth-token', JSON.stringify(value)), session);
    await page.route('**/src/lib/supabase.ts*', mockSupabaseModule);
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
    await page.route('http://localhost:54321/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const name = url.pathname.split('/').pop();
      const input = url.pathname.includes('/rpc/') && request.postData() ? request.postDataJSON() : {};
      const timestamp = new Date().toISOString();
      const kind: HandoffKind = input.p_kind === 'return' ? 'return' : 'pickup';
      let body: unknown = [];
      if (url.pathname === '/auth/v1/user') body = session.user;
      if (name === 'has_active_session') body = true;
      if (name === 'profiles' || name === 'get_my_profile') body = { id: session.user.id, full_name: isOwner ? 'Camera Owner' : 'Camera Renter' };
      if (name === 'bookings') body = booking;
      if (name === 'booking_deposit_authorizations' || name === 'booking_deposit_claims' || name === 'rental_settlements') body = null;
      if (name === 'get_booking_pickup') body = { address: 'Synthetic pickup', city: 'Dallas', state: 'TX', postalCode: '75201' };
      if (name === 'get_booking_handoff_workflow') {
        if (state.failRefresh) return route.fulfill({ status: 503, json: { message: 'Handoff connection lost' } });
        const detail = handoff[kind];
        body = { ...handoff, [kind]: !isOwner && detail?.inspection?.publication_status === 'draft' ? null
          : detail ? { ...detail, review_reason: reasons[kind] ?? null } : null,
        is_owner: isOwner, booking_status: booking.status, workflow: workflow(kind, isOwner) };
      }
      if (name === 'get_booking_precheckin') body = {
        payment_first: true, slot: slots.pickup ?? null, pickup_slot: slots.pickup ?? null, return_slot: slots.return ?? null,
        pickup_windows: ['morning'], return_windows: ['morning'], return_rules: ['Return all accessories'], return_note: '',
        time_zone: 'America/Chicago', server_now: state.serverNow,
        can_authorize: true, deposit_ready: true, consented: true, delivery_mode: 'pickup',
        handoff_ready: state.ready && slots.pickup?.status === 'approved',
        return_handoff_ready: state.ready && slots.return?.status === 'approved',
        workflow_version: state.version, pickup_proposal: proposals.pickup ?? null, return_proposal: proposals.return ?? null,
      };
      if (['propose_booking_handoff_replacement', 'respond_booking_handoff_replacement',
        'begin_booking_handoff', 'save_booking_inspection_draft', 'publish_booking_inspection',
        'review_booking_inspection'].includes(name ?? '') && input.p_expected_version !== state.version) {
        return route.fulfill({ status: 409, json: { message: 'Booking changed. Refresh before continuing.' } });
      }
      if (name === 'propose_booking_handoff_replacement') {
        state.version++;
        const selectedDate = kind === 'pickup' ? booking.start_date : booking.end_date;
        const hour = input.p_hour;
        const startsAt = new Date(`${selectedDate}T${String(hour).padStart(2, '0')}:00:00-06:00`).toISOString();
        proposals[kind] = {
          kind, selected_date: selectedDate, slot_window: input.p_slot_window, hour,
          status: 'proposed', time_zone: 'America/Chicago', note: input.p_note,
          starts_at: startsAt, ends_at: new Date(Date.parse(startsAt) + 60 * 60 * 1000).toISOString(), updated_at: timestamp,
          proposed_by_is_owner: isOwner, version: state.version,
        };
        handoff.events.push({ id: handoff.events.length + 1, event_type: `${kind}_replacement_proposed`, created_at: timestamp });
        body = null;
      }
      if (name === 'respond_booking_handoff_replacement') {
        if (input.p_approve) slots[kind] = { ...proposals[kind]!, status: 'approved' };
        handoff.events.push({
          id: handoff.events.length + 1,
          event_type: `${kind}_replacement_${input.p_approve ? 'approved' : 'declined'}`,
          created_at: timestamp,
        });
        delete proposals[kind];
        state.version++;
        body = null;
      }
      if (name === 'begin_booking_handoff') {
        if (kind === 'pickup') handoff.status = 'pickup_checkin_started';
        else { booking.status = 'return_pending'; handoff.status = 'return_inspection'; }
        state.version++;
      }
      if (name === 'save_booking_inspection_draft') {
        const previous = handoff[kind]?.inspection;
        state.version++;
        const inspection: HandoffInspection = {
          id: `50000000-0000-4000-8000-00000000000${kind === 'pickup' ? '1' : '2'}`,
          booking_id: bookingId, kind, appearance_condition: input.p_appearance_condition,
          existing_damage: input.p_existing_damage, included_accessories: input.p_included_accessories,
          functional_condition: input.p_functional_condition, serial_number: input.p_serial_number,
          submitted_at: timestamp, owner_acknowledged_at: null, renter_acknowledged_at: null,
          revision: previous?.revision ?? 1, publication_status: 'draft', published_at: null, workflow_version: state.version,
        };
        handoff[kind] = { inspection, photos: handoff[kind]?.photos ?? [] };
        if (kind === 'pickup') handoff.status = 'pickup_inspection';
        body = inspection;
      }
      if (url.pathname.startsWith('/storage/v1/object/booking-inspection-evidence/')) { state.uploads++; body = { Key: url.pathname }; }
      if (name === 'register_booking_inspection_photo') {
        state.registrationPaths.push(input.p_object_path);
        if (state.failRegistration) {
          state.failRegistration = false;
          return route.fulfill({ status: 503, json: { message: 'Photo registration temporarily unavailable' } });
        }
        const detail = input.p_inspection_id.endsWith('1') ? handoff.pickup! : handoff.return!;
        detail.photos.push({ id: crypto.randomUUID(), object_path: input.p_object_path, created_at: timestamp });
      }
      if (url.pathname.startsWith('/storage/v1/object/sign/')) body = { signedURL: '/object/public/test-photo.png' };
      if (url.pathname === '/storage/v1/object/public/test-photo.png') return state.failEvidence
        ? route.fulfill({ status: 503, body: 'Evidence temporarily unavailable' })
        : route.fulfill({ contentType: 'image/png', body: Buffer.from(image.split(',')[1], 'base64') });
      if (name === 'publish_booking_inspection') {
        const record = handoff[kind]!.inspection!;
        record.owner_acknowledged_at = timestamp;
        record.publication_status = 'published'; record.published_at = timestamp;
        state.version++;
      }
      if (name === 'review_booking_inspection') {
        const detail = handoff[kind]!;
        const record = detail.inspection!;
        decisions[kind] = input.p_decision === 'agree' ? 'agreed'
          : input.p_decision === 'dispute' ? 'disputed' : 'correction_requested';
        if (input.p_decision === 'request_correction') {
          detail.history = [...(detail.history ?? []), { inspection: { ...record }, photos: [...detail.photos] }];
          record.revision = (record.revision ?? 1) + 1;
          record.publication_status = 'draft'; record.owner_acknowledged_at = null; record.renter_acknowledged_at = null;
        } else {
          if (input.p_decision === 'agree') record.renter_acknowledged_at = timestamp;
          handoff.status = kind === 'pickup' ? 'pickup_otp_pending' : 'return_otp_pending';
        }
        reasons[kind] = input.p_reason;
        state.version++;
      }
      if (name === 'get_booking_handoff_otp' || name === 'regenerate_booking_handoff_otp') {
        if (name === 'regenerate_booking_handoff_otp') state.generation++;
        body = { code: '123456', expires_at: new Date((await page.evaluate(() => Date.now())) + 300000).toISOString(), generation: state.generation };
      }
      if (name === 'verify_booking_handoff_otp') {
        state.otpAttempts++;
        if (input.p_code !== '123456') body = { verified: false, error: 'Incorrect code.', attempts_remaining: 4 };
        else {
          handoff.status = kind === 'pickup' ? 'rental_active' : 'returned';
          if (kind === 'pickup') { handoff.actual_pickup_at = timestamp; booking.status = 'active'; }
          else { handoff.actual_return_at = timestamp; booking.status = 'completed'; }
          body = { verified: true, status: handoff.status };
        }
      }
      return route.fulfill({ json: body });
    });
    await page.goto(`${appUrl}/check-in/${bookingId}`);
    await expect(page.getByRole('heading', { name: isOwner ? 'Owner flow' : 'Renter flow' })).toBeVisible({ timeout: 60000 });
  }
  return { setup, booking, handoff, state, slots, proposals };
}

async function sync(page: Page) {
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/rpc/get_booking_handoff_workflow'), { timeout: 15000 }),
    page.clock.fastForward(15001),
  ]);
}

test('pickup opens two hours early in the pickup timezone for the owner only', async ({ browser }, testInfo) => {
  const s = scenario();
  s.state.serverNow = '2026-11-17T13:59:59Z';
  s.state.blockers = ['approved_window_required'];
  s.slots.pickup = {
    kind: 'pickup', selected_date: '2026-11-17', slot_window: 'morning', hour: 10, status: 'approved',
    starts_at: '2026-11-17T16:00:00Z', ends_at: '2026-11-17T17:00:00Z',
    time_zone: 'America/Chicago', note: '', updated_at: initialTime.toISOString(),
  };
  const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Tokyo' });
  const renterContext = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Los_Angeles' });
  const owner = await ownerContext.newPage();
  const renter = await renterContext.newPage();
  const mutations: string[] = [];
  for (const page of [owner, renter]) page.on('request', request => {
    if (/begin_booking_handoff|functions\/v1\/create-/.test(request.url())) mutations.push(request.url());
  });

  try {
    await s.setup(owner, true);
    await s.setup(renter, false);
    for (const page of [owner, renter]) {
      const guidance = page.getByRole('region', { name: 'What happens next' });
      await expect(guidance.getByRole('heading', { name: /Pickup opens.*8:00 AM CST/ })).toBeVisible();
      await expect(guidance).toContainText('No action is needed yet.');
      await expect(guidance).toContainText('Rental payment: confirmed');
      await expect(page.getByText('approved_window_required', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Begin pickup', exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await expect(owner.getByRole('region', { name: 'What happens next' })).toContainText('Meet Camera Renter');
    await expect(renter.getByRole('region', { name: 'What happens next' })).toContainText('Meet Camera Owner');
    await owner.screenshot({ path: testInfo.outputPath('owner-before-pickup.png'), fullPage: true });
    await renter.screenshot({ path: testInfo.outputPath('renter-before-pickup-mobile.png'), fullPage: true });
    s.state.ready = true;
    s.state.serverNow = '2026-11-17T14:00:00Z';
    s.state.blockers = [];
    await sync(owner);
    await sync(renter);
    await expect(owner.getByRole('heading', { name: 'Start pickup when you are together' })).toBeVisible();
    await expect(owner.getByRole('button', { name: 'Begin pickup', exact: true })).toBeVisible();
    await expect(renter.getByRole('heading', { name: 'Waiting for Camera Owner to start pickup' })).toBeVisible();
    await expect(renter.getByRole('button', { name: 'Begin pickup', exact: true })).toHaveCount(0);
    expect(mutations).toEqual([]);
  } finally {
    await ownerContext.close();
    await renterContext.close();
  }
});

test('declined pickup proposal remains in history and the owner can propose an alternative', async ({ browser }) => {
  const s = scenario();
  const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const renterContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const owner = await ownerContext.newPage();
  const renter = await renterContext.newPage();
  try {
    await s.setup(owner, true);
    await s.setup(renter, false);
    await renter.getByRole('button', { name: '10 am', exact: true }).click();
    await renter.getByRole('button', { name: 'Send proposal', exact: true }).click();
    await sync(owner);
    await owner.getByRole('button', { name: 'Decline time', exact: true }).click();
    await sync(renter);
    await owner.getByRole('button', { name: '11 am', exact: true }).click();
    await owner.getByRole('button', { name: 'Send proposal', exact: true }).click();
    await sync(renter);
    await renter.getByRole('button', { name: 'Approve time', exact: true }).click();
    await sync(owner);

    expect(s.slots.pickup?.hour).toBe(11);
    await owner.getByText('Handoff history', { exact: true }).click();
    await expect(owner.getByText('pickup replacement declined', { exact: true })).toBeVisible();
    await expect(owner.getByText('pickup replacement approved', { exact: true })).toBeVisible();
  } finally {
    await ownerContext.close();
    await renterContext.close();
  }
});

for (const width of [1440, 390]) {
  test(`renter and owner complete pickup and return without reloading at ${width}px`, async ({ browser }) => {
    const s = scenario();
    const ownerContext = await browser.newContext({ viewport: { width, height: 900 } });
    const renterContext = await browser.newContext({ viewport: { width, height: 900 } });
    const owner = await ownerContext.newPage();
    const renter = await renterContext.newPage();
    try {
      await s.setup(owner, true);
      await s.setup(renter, false);
      await expect(owner.getByRole('button', { name: 'Begin pickup', exact: true })).toHaveCount(0);
      await renter.getByRole('button', { name: '10 am', exact: true }).click();
      await renter.getByRole('button', { name: 'Send proposal' }).click();
      await sync(owner);
      await owner.getByRole('button', { name: 'Approve time', exact: true }).click();
      await sync(renter);
      await expect(renter.getByRole('button', { name: 'Begin pickup', exact: true })).toHaveCount(0);
      s.state.ready = true;
      await sync(owner);
      await owner.getByRole('button', { name: 'Begin pickup', exact: true }).click();
      await sync(renter);
      await expect(renter.getByText('Waiting for owner inspection', { exact: true })).toBeVisible();

      for (const kind of ['pickup', 'return'] as const) {
        await owner.getByLabel(/^Item appearance and condition/).fill('Clean camera with minor signs of normal use.');
        await owner.getByLabel(/Existing scratches or damage/).fill('None observed');
        await owner.getByLabel(/Included accessories/).fill('Charger\nCarrying case');
        await owner.getByLabel(/Functional condition/).fill('Powers on and takes photographs.');
        if (kind === 'return') {
          await owner.getByRole('button', { name: 'Save draft', exact: true }).click();
          await expect(owner.getByText('Private draft', { exact: true })).toBeVisible();
        }
        await expect(owner.getByRole('button', { name: 'Publish & confirm', exact: true })).toBeEnabled();
        await sync(renter);
        await expect(renter.getByRole('heading', { name: /inspection record/, exact: false })).toHaveCount(0);
        await owner.getByRole('button', { name: 'Publish & confirm', exact: true }).click();
        await expect(owner.getByText('Add at least two condition photos before publishing the inspection.')).toBeVisible();
        await owner.getByLabel(/Condition photos/).setInputFiles(['front.png', 'back.png'].map(name => ({
          name, mimeType: 'image/png', buffer: Buffer.from(image.split(',')[1], 'base64'),
        })));
        if (kind === 'pickup') s.state.failRegistration = true;
        await owner.getByRole('button', { name: 'Publish & confirm', exact: true }).click();
        if (kind === 'pickup') {
          await expect(owner.getByText(/Photo registration temporarily unavailable/)).toBeVisible();
          await owner.getByRole('button', { name: 'Publish & confirm', exact: true }).click();
        }
        await expect(owner.getByText('Published', { exact: true })).toBeVisible();
        if (kind === 'pickup') {
          expect(s.state.uploads).toBe(2);
          expect(s.state.registrationPaths[0]).toBe(s.state.registrationPaths[1]);
        }
        await expect(owner.getByRole('heading', { name: `${kind === 'pickup' ? 'Pickup' : 'Return'} inspection record` })).toBeVisible();
        if (kind === 'pickup') s.state.failEvidence = true;
        await sync(renter);
        if (kind === 'pickup') {
          await expect(renter.getByText('Evidence photo is unavailable. Refresh the handoff before agreeing.').first()).toBeVisible();
          await expect(renter.getByRole('button', { name: 'Agree to condition', exact: true })).toBeDisabled();
          s.state.failEvidence = false;
          await renter.getByRole('button', { name: 'Reload evidence', exact: true }).click();
        }
        await expect(renter.getByRole('img', { name: `${kind === 'pickup' ? 'Pickup' : 'Return'} inspection record photo 1`, exact: true })).toBeVisible();
        if (kind === 'pickup') {
          await renter.getByRole('button', { name: 'Request correction', exact: true }).click();
          await renter.getByLabel('Correction details').fill('Please clarify the charger condition before exchange.');
          await renter.getByRole('button', { name: 'Send correction request' }).click();
          await expect(renter.getByLabel('Six-digit handoff code')).toHaveCount(0);
          await sync(owner);
          await owner.getByLabel(/^Item appearance and condition/).fill('Clean camera and charger; correction remains unsaved.');
          s.state.version++;
          await sync(owner);
          await expect(owner.getByLabel(/^Item appearance and condition/)).toHaveValue('Clean camera and charger; correction remains unsaved.');
          await expect(owner.getByRole('button', { name: 'Publish & confirm', exact: true })).toBeDisabled();
          await owner.getByRole('button', { name: 'Keep my edits for this version', exact: true }).click();
          await owner.getByRole('button', { name: 'Publish & confirm', exact: true }).click();
          await sync(renter);
        }
        if (kind === 'return' && width === 390) {
          await renter.getByRole('button', { name: 'Dispute condition', exact: true }).click();
          await renter.getByLabel('Dispute reason').fill('The photographed scratch was present before this rental.');
          await renter.getByRole('button', { name: 'Send dispute', exact: true }).click();
        } else await renter.getByRole('button', { name: 'Agree to condition', exact: true }).click();
        await expect(renter.getByLabel('Six-digit handoff code')).toHaveText('123456');
        await sync(owner);
        const code = owner.getByLabel('Enter the renter’s six-digit code', { exact: true });
        if (kind === 'pickup') {
          await code.fill('000000');
          await owner.getByRole('button', { name: 'Verify and start rental' }).click();
          await expect(owner.getByText('Incorrect code. 4 attempts remaining.')).toBeVisible();
        }
        await code.fill('123456');
        await owner.getByRole('button', { name: kind === 'pickup' ? 'Verify and start rental' : 'Verify and confirm receipt' }).click();
        await expect(owner.getByRole('heading', { name: kind === 'pickup' ? 'Pickup verified' : 'Return verified', exact: true })).toBeVisible();
        await sync(renter);
        await expect(renter.getByRole('heading', { name: kind === 'pickup' ? 'Pickup verified' : 'Return verified', exact: true })).toBeVisible();
        if (kind === 'pickup') {
          await owner.getByRole('button', { name: 'View return details' }).click();
          await renter.getByRole('button', { name: 'View return details' }).click();
          await expect(renter.getByRole('button', { name: 'Begin return', exact: true })).toHaveCount(0);
          s.state.ready = false;
          await renter.getByRole('button', { name: '10 am', exact: true }).click();
          await renter.getByRole('button', { name: 'Send proposal' }).click();
          await sync(owner);
          await owner.getByRole('button', { name: 'Approve time', exact: true }).click();
          s.state.ready = true;
          await sync(renter);
          await sync(owner);
          await owner.getByRole('button', { name: 'Begin return inspection', exact: true }).click();
          await expect(owner.getByLabel(/^Item appearance and condition/)).toBeVisible();
        }
      }
      expect(s.booking.status).toBe('completed');
      expect(s.state.otpAttempts).toBe(3);
      if (width === 390) await expect(renter.getByText(/Item returned - condition under review/)).toBeVisible();
      await expect(renter.getByText('Booking completed', { exact: true })).toHaveCount(0);
      for (const page of [owner, renter]) {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expect(page.getByRole('heading', { name: 'Review & rating' })).toBeVisible();
      }
    } finally {
      await ownerContext.close();
      await renterContext.close();
    }
  });
}

test('background handoff failure is visible, retains the record and recovers', async ({ page }) => {
  const s = scenario();
  await s.setup(page, true);
  s.state.failRefresh = true;
  await sync(page);
  await expect(page.getByText('Handoff updates interrupted', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Handoff camera', exact: true })).toBeVisible();
  s.state.failRefresh = false;
  await page.getByRole('button', { name: 'Refresh handoff', exact: true }).click();
  await expect(page.getByText('Handoff updates interrupted', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'What happens next' })
    .getByRole('heading', { name: 'Choose a pickup time', exact: true })).toBeVisible();
});

test('returned booking details do not close or settle unresolved funds on view', async ({ page }) => {
  const s = scenario();
  s.booking.status = 'completed';
  await s.setup(page, true);
  let settlementCalls = 0;
  await page.route('**/rest/v1/rental_settlements?*', route => route.fulfill({ json: {
    booking_id: bookingId, deposit_amount: 0, owner_amount: 20,
    refund_status: 'not_required', transfer_status: 'pending', last_error: null,
  } }));
  await page.route('**/functions/v1/settle-rental', route => {
    settlementCalls++;
    return route.fulfill({ json: {} });
  });
  await page.goto(`${appUrl}/confirmation/${bookingId}`);
  await expect(page.getByRole('heading', { name: 'Your booking', exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.getByText('Item returned. Condition review and financial processing are tracked separately.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Process / refresh settlement', exact: true })).toBeEnabled();
  expect(settlementCalls).toBe(0);
});
