import { createClient } from 'npm:@supabase/supabase-js@2';

function equalSecret(actual: string | null, expected: string | undefined): boolean {
  if (!actual || !expected || actual.length !== expected.length) return false;
  let diff = 0;
  for (let index = 0; index < actual.length; index++) diff |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return diff === 0;
}

Deno.serve(async request => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!equalSecret(request.headers.get('x-notification-worker-secret'), Deno.env.get('NOTIFICATION_WORKER_SECRET'))) {
    return json({ error: 'Not authorized' }, 401);
  }
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  if (!url) return json({ error: 'Database URL is unavailable' }, 503);
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  try {
    const { data: settings, error: settingsError } = await admin.from('app_settings')
      .select('key,value').in('key',['deposit_authorization_lead_hours','deposit_reauthorization_safety_hours']);
    if (settingsError) throw new Error(settingsError.message);
    const setting = new Map((settings ?? []).map(row => [row.key, Number(row.value)]));
    const leadHours = setting.get('deposit_authorization_lead_hours') || 24;
    const safetyHours = setting.get('deposit_reauthorization_safety_hours') || 24;
    const now = new Date();
    const duePickupDate = new Date(now.getTime() + leadHours * 3600000).toISOString().slice(0,10);
    const slotPickupDate = new Date(now.getTime() + (Math.max(leadHours,24) + 24) * 3600000).toISOString().slice(0,10);
    const { data: bookings, error: bookingError } = await admin.from('bookings')
      .select('id,renter_id,start_date,end_date,deposit,payment_first,status')
      .eq('deposit_collection_model','authorization').gt('deposit',0)
      .in('status',['confirmed','active']).or('payment_first.eq.true,deposit_hold_consent_at.not.is.null')
      .lte('start_date',slotPickupDate).limit(100);
    if (bookingError) throw new Error(bookingError.message);
    const scheduledBookingIds = (bookings ?? []).filter(booking => booking.payment_first && booking.status === 'confirmed').map(booking => booking.id);
    const slots = new Map<string, { starts_at: string; ends_at: string }>();
    if (scheduledBookingIds.length > 0) {
      const { data: approvedSlots, error: slotError } = await admin.from('booking_pickup_slots')
        .select('booking_id,starts_at,ends_at').in('booking_id', scheduledBookingIds).eq('status','approved');
      if (slotError) throw new Error(slotError.message);
      for (const slot of approvedSlots ?? []) slots.set(slot.booking_id, slot);
    }
    let notified = 0;
    for (const booking of bookings ?? []) {
      if (!booking.payment_first && booking.start_date > duePickupDate) continue;
      if (booking.payment_first && booking.status === 'confirmed') {
        const slot = slots.get(booking.id);
        if (!slot || Date.parse(slot.starts_at) > now.getTime() + 24 * 3600000 || Date.parse(slot.ends_at) <= now.getTime()) continue;
      }
      const { data: authorization, error: authorizationError } = await admin.from('booking_deposit_authorizations')
        .select('id,status,capture_before').eq('booking_id',booking.id).order('attempt',{ascending:false}).limit(1).maybeSingle();
      if (authorizationError) throw new Error(authorizationError.message);
      if (!authorization) continue;
      const captureBefore = authorization.capture_before ? Date.parse(authorization.capture_before) : 0;
      const needsSetup = authorization.status === 'setup_required';
      const initialDue = ['scheduled','failed','expired','released'].includes(authorization.status)
        && (booking.payment_first || booking.start_date <= duePickupDate);
      const replacementDue = authorization.status === 'authorized' && captureBefore > 0
        && captureBefore <= now.getTime() + safetyHours * 3600000
        && captureBefore < new Date(`${booking.end_date}T23:59:59Z`).getTime();
      if (!needsSetup && !initialDue && !replacementDue) continue;
      const title = needsSetup ? 'Save a card for your security deposit'
        : replacementDue ? 'Renew your security-deposit authorization'
          : 'Authorize your security deposit before pickup';
      const body = needsSetup
        ? 'Save a payment method before pickup. The deposit is a temporary authorization, not an upfront charge.'
        : replacementDue
          ? 'Your current card authorization expires before this rental ends. Renew it before pickup or return.'
          : 'Authorize the temporary security-deposit hold before pickup. No deposit charge is made with the booking payment.';
      const eventKey = `deposit-authorization-reminder:${booking.id}:${authorization.id}`;
      const { error } = await admin.rpc('create_notification', {
        p_user_id: booking.renter_id, p_event_key: eventKey, p_category: 'payments',
        p_title: title, p_body: body, p_destination: `/${booking.payment_first ? 'check-in' : 'confirmation'}/${booking.id}`,
      });
      if (error) throw new Error(error.message);
      notified++;
    }
    return json({ notified });
  } catch (error) {
    console.error('Deposit authorization reminder worker failed',error instanceof Error ? error.message : 'Unknown failure');
    return json({ error: 'Deposit authorization reminders failed; retry required' },500);
  }
});

function json(body: unknown, status=200) {
  return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
}
