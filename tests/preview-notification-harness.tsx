import { PreviewProvider, usePreview } from '../src/preview-1/state';
import { PreviewNotificationCenter } from '../src/preview-1/notification-center';

function NotificationEvents() {
  const store = usePreview();
  return <div className="p1">
    <button onClick={() => {
      store.addNotice('Optional bid test', 'Optional activity', 'auction', 'a1');
      store.addNotice('Mandatory winning bid test', 'Payment deadline', 'auction', 'a1', { mandatory: true });
      store.addNotice('Mandatory payment test', 'Payment received', 'payouts');
    }}>Generate preview events</button>
    <PreviewNotificationCenter />
  </div>;
}

export function PreviewNotificationHarness() {
  return <PreviewProvider><NotificationEvents /></PreviewProvider>;
}
