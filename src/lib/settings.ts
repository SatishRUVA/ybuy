import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

// Display-only default; the server snapshots the authoritative value (app_settings) on every booking.
const DEFAULT_FEE = 0.1;
let cached: number | null = null;

export function usePlatformFee() {
  const [state, setState] = useState<{ pct: number | null; loading: boolean; error: string | null }>({
    pct: cached, loading: true, error: null,
  });
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'platform_fee_pct').maybeSingle();
        if (error) throw new Error(error.message);
        const value = data?.value;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
          throw new Error('The platform service fee is unavailable. Please retry before booking.');
        }
        cached = value;
        if (active) setState({ pct: value, loading: false, error: null });
      } catch (reason) {
        if (active) setState({ pct: null, loading: false, error: reason instanceof Error ? reason.message : 'Could not load the platform service fee.' });
      }
    }
    void load();
    return () => { active = false; };
  }, []);
  return state;
}

/** Display-only estimate for legacy screens; checkout always uses the server's price. */
export function usePlatformFeePct(): number {
  const { pct, error } = usePlatformFee();
  useEffect(() => { if (error) console.error('Platform fee estimate unavailable:', error); }, [error]);
  return pct ?? DEFAULT_FEE;
}

export const formatFeePct = (pct: number) => `${+(pct * 100).toFixed(1)}%`;
