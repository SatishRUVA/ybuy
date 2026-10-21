import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

// Display-only default; the server snapshots the authoritative value (app_settings) on every booking.
const DEFAULT_FEE = 0.1;
let cached: number | null = null;

/** Platform fee fraction managed by administrators. Shown to renters; never trusted for pricing. */
export function usePlatformFeePct(): number {
  const [pct, setPct] = useState(cached ?? DEFAULT_FEE);
  useEffect(() => {
    let active = true;
    supabase.from('app_settings').select('value').eq('key', 'platform_fee_pct').maybeSingle()
      .then(({ data }) => {
        const v = Number(data?.value);
        if (Number.isFinite(v) && v >= 0 && v <= 1) { cached = v; if (active) setPct(v); }
      });
    return () => { active = false; };
  }, []);
  return pct;
}

export const formatFeePct = (pct: number) => `${+(pct * 100).toFixed(1)}%`;
