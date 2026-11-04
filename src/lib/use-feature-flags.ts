import { useSyncExternalStore } from 'react';
import { supabase } from '@/lib/supabase';
import { listFlags } from '@/admin/api';
import { createFeatureFlagStore } from '@/lib/feature-flag-store';

const store = createFeatureFlagStore({
  load: listFlags,
  connect(changed, status) {
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let channel: ReturnType<typeof supabase.channel>;
    function connect() {
      channel = supabase.channel(`feature-flags:${crypto.randomUUID()}`, {
        config: { postgres_changes_options: { wait: true } },
      })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'feature_flags' }, changed)
        .subscribe((value) => {
          if (disposed) return;
          status(value);
          // Transport errors rejoin automatically; a closed channel needs a new subscription.
          if (value === 'CLOSED') {
            clearTimeout(retry);
            retry = setTimeout(connect, 1000);
          }
        });
    }
    connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      void supabase.removeChannel(channel);
    };
  },
});

export function useFeatureFlags() {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { ...state, reload: store.reload };
}

export function useFeatureFlag(key: string) {
  const state = useFeatureFlags();
  const flag = state.data?.find((row) => row.key === key);
  return {
    ...state,
    enabled: !state.loading && !state.error && flag?.enabled === true,
  };
}
