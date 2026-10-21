import { expect, test } from '@playwright/test';
import { mockSupabaseModule } from './mock-supabase';

test('notification subscribers have independent channels and cleanup', async ({ page }) => {
  await page.route('**/src/lib/supabase.ts*', mockSupabaseModule);
  await page.route('http://127.0.0.1:54321/**', (route) =>
    route.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.routeWebSocket('**/realtime/v1/websocket**', (socket) => {
    socket.onMessage((message) => {
      const [joinRef, ref, topic, event, payload] = JSON.parse(String(message));
      if (event === 'phx_join' || event === 'phx_leave' || event === 'heartbeat') {
        socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', {
          status: 'ok',
          response: event === 'phx_join'
            ? { postgres_changes: payload.config.postgres_changes.map((filter: object) => ({ ...filter, id: 1 })) }
            : {},
        }]));
      }
    });
  });
  await page.goto('http://127.0.0.1:5174/notifications');
  const result = await page.evaluate(async () => {
    const { subscribeToNotifications } = await import('/src/lib/notifications.ts');
    const { supabase } = await import('/src/lib/supabase.ts');
    const userId = 'b1000000-0000-4000-8000-000000000001';
    const header = subscribeToNotifications(userId, () => {});
    const center = subscribeToNotifications(userId, () => {});
    const independent = header !== center && header.topic !== center.topic;
    await supabase.removeChannel(center);
    const headerStillActive = supabase.getChannels().includes(header);
    const remounted = subscribeToNotifications(userId, () => {});
    const remountIndependent = remounted !== header && remounted.topic !== center.topic;
    await supabase.removeChannel(remounted);
    await supabase.removeChannel(header);
    return { independent, headerStillActive, remountIndependent };
  });
  expect(result).toEqual({
    independent: true,
    headerStillActive: true,
    remountIndependent: true,
  });
});
