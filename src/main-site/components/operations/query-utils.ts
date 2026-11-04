import { useEffect, useRef, useState } from 'react';
import type { Paged } from '@/admin/api';

export const PAGE_SIZE = 20;

export const money = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n));

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const fmtDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { dateStyle: 'medium' });

export interface PagedQuery<T> {
  data: Paged<T> | null;
  loading: boolean;
  error: string | null;
  page: number;
  setPage: (page: number) => void;
  reload: () => void;
}

/** Server-paginated list. Changing `deps` (search, filters) resets to the first page. */
export function usePagedQuery<T>(
  fetcher: (limit: number, offset: number) => Promise<Paged<T>>,
  deps: unknown[],
): PagedQuery<T> {
  const key = JSON.stringify(deps);
  const [pageState, setPageState] = useState({ key, page: 0 });
  const page = pageState.key === key ? pageState.page : 0;
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<{ data: Paged<T> | null; loading: boolean; error: string | null }>({
    data: null, loading: true, error: null,
  });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let active = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetcherRef.current(PAGE_SIZE, page * PAGE_SIZE)
      .then((data) => { if (active) setState({ data, loading: false, error: null }); })
      .catch((e: Error) => { if (active) setState({ data: null, loading: false, error: e.message }); });
    return () => { active = false; };
  }, [key, page, nonce]);

  return {
    ...state,
    page,
    setPage: (p) => setPageState({ key, page: p }),
    reload: () => setNonce((n) => n + 1),
  };
}

/** Loads a non-paginated resource; reloads when `deps` change or `reload()` is called. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const key = JSON.stringify(deps);
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({
    data: null, loading: true, error: null,
  });
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let active = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    loaderRef.current()
      .then((data) => { if (active) setState({ data, loading: false, error: null }); })
      .catch((e: Error) => { if (active) setState({ data: null, loading: false, error: e.message }); });
    return () => { active = false; };
  }, [key, nonce]);

  return { ...state, reload: () => setNonce((n) => n + 1) };
}
