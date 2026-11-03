import { useEffect, useState } from 'react';

const utcDay = () => new Date().toISOString().slice(0, 10);

export function useUtcDay(): string {
  const [day, setDay] = useState(utcDay);
  useEffect(() => {
    const update = () => setDay(utcDay());
    const now = Date.now();
    const timer = window.setTimeout(update, 86400000 - now % 86400000);
    const visible = () => { if (document.visibilityState === 'visible') update(); };
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [day]);
  return day;
}
