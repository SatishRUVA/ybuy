import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (request) => {
  if (request.method!=='POST') return new Response('Method not allowed',{status:405});
  const expected=Deno.env.get('NOTIFICATION_WORKER_SECRET');
  if (!expected || request.headers.get('x-notification-worker-secret')!==expected) return new Response('Not authorized',{status:401});
  const url=Deno.env.get('SUPABASE_URL') ?? '';
  const key=Deno.env.get('STRIPE_SECRET_KEY') ?? '';
  const allowed=url==='https://jzyjmsixfuwzfnntewqn.supabase.co' || /^http:\/\/(?:127\.0\.0\.1|localhost|kong|supabase_kong_YBuy)(?::\d+)?$/.test(url);
  if (!allowed || !/^(sk|rk)_test_/.test(key)) return new Response('Isolated backend and Stripe test key required',{status:503});
  const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const stripe=new Stripe(key);
  try {
    const expired=await admin.rpc('expire_checkout_reservations');
    if (expired.error) throw new Error(expired.error.message);
    const bookings=await admin.from('bookings').select('id,checkout_session_id')
      .eq('status','cancelled').not('checkout_session_id','is',null).is('checkout_session_closed_at',null).limit(25);
    if (bookings.error) throw new Error(bookings.error.message);
    let closed=0;
    for (const booking of bookings.data) {
      const session=await stripe.checkout.sessions.retrieve(booking.checkout_session_id);
      if (session.livemode) throw new Error('Live checkout session rejected');
      if (session.status==='open') await stripe.checkout.sessions.expire(session.id);
      const recorded=await admin.from('bookings').update({ checkout_session_closed_at:new Date().toISOString() }).eq('id',booking.id);
      if (recorded.error) throw new Error(recorded.error.message);
      closed++;
    }
    return Response.json({closed});
  } catch (error) {
    console.error('Checkout expiration failed',error instanceof Error ? error.message : 'Unknown failure');
    return new Response('Checkout expiration failed; retry required',{status:500});
  }
});
