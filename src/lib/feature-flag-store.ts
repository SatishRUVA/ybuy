export interface FeatureFlag {
  key: string;
  enabled: boolean;
  description: string;
  updated_at: string;
}

type ConnectionStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED';
interface FlagTransport {
  load: () => Promise<FeatureFlag[]>;
  connect: (changed: () => void, status: (status: ConnectionStatus) => void) => () => void;
}

export function createFeatureFlagStore(transport: FlagTransport) {
  let snapshot: { data: FeatureFlag[] | null; loading: boolean; error: string | null } = {
    data: null, loading: true, error: null,
  };
  const listeners = new Set<() => void>();
  let refresh = () => {};
  let stop = () => {};
  const publish = (next: typeof snapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };

  function start() {
    let disposed = false;
    let connected = false;
    let fetching = false;
    let revision = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = 1000;

    async function load() {
      if (disposed || !connected || fetching) return;
      fetching = true;
      const requestedRevision = revision;
      try {
        const data = await transport.load();
        if (!disposed && connected && requestedRevision === revision) {
          retryDelay = 1000;
          publish({ data, loading: false, error: null });
        }
      } catch (reason) {
        if (!disposed && connected && requestedRevision === revision) {
          publish({ ...snapshot, loading: false, error: reason instanceof Error ? reason.message : 'Could not load feature flags.' });
          retry = setTimeout(refresh, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 30000);
        }
      } finally {
        fetching = false;
        // A change received during a snapshot must not be lost to that older response.
        if (!disposed && connected && requestedRevision !== revision) void load();
      }
    }

    refresh = () => {
      revision += 1;
      clearTimeout(retry);
      void load();
    };
    const disconnect = transport.connect(refresh, (status) => {
      if (disposed) return;
      connected = status === 'SUBSCRIBED';
      revision += 1;
      clearTimeout(retry);
      if (connected) {
        publish({ ...snapshot, loading: true, error: null });
        void load();
      } else {
        publish({ ...snapshot, loading: false, error: 'Live feature settings are disconnected. Reconnecting automatically; feature actions are temporarily unavailable.' });
      }
    });
    stop = () => {
      disposed = true;
      clearTimeout(retry);
      disconnect();
      refresh = () => {};
      snapshot = { data: null, loading: true, error: null };
    };
  }

  return {
    getSnapshot: () => snapshot,
    reload: () => refresh(),
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) start();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
  };
}
