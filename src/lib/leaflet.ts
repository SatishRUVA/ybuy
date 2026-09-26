// Loads Leaflet from the unpkg CDN on demand (no npm dependency / bundle cost) and returns the
// global `L`. The pnpm store lives on a full disk, so the CDN is the pragmatic way to get a real
// map without an install. Typed to only the small surface the app actually uses.

export interface LeafletLatLngBounds {
  isValid(): boolean;
}
export interface LeafletMap {
  setView(center: [number, number], zoom: number): LeafletMap;
  fitBounds(bounds: LeafletLatLngBounds, options?: { padding?: [number, number]; maxZoom?: number }): LeafletMap;
  remove(): void;
  invalidateSize(): void;
}
export interface LeafletMarker {
  addTo(map: LeafletMap): LeafletMarker;
  on(event: 'click' | 'mouseover' | 'mouseout', handler: () => void): LeafletMarker;
  getElement(): HTMLElement | undefined;
}
export interface LeafletDivIcon {
  _brand?: 'divicon';
}
export interface Leaflet {
  map(el: HTMLElement, options?: { zoomControl?: boolean; scrollWheelZoom?: boolean }): LeafletMap;
  tileLayer(url: string, options: { attribution: string; maxZoom: number }): { addTo(map: LeafletMap): unknown };
  marker(latlng: [number, number], options: { icon: LeafletDivIcon }): LeafletMarker;
  divIcon(options: { html: string; className: string; iconSize: [number, number]; iconAnchor: [number, number] }): LeafletDivIcon;
  latLngBounds(latlngs: [number, number][]): LeafletLatLngBounds;
}

const CSS_HREF = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const JS_SRC = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

let loader: Promise<Leaflet> | null = null;

export function loadLeaflet(): Promise<Leaflet> {
  if (loader) return loader;

  loader = new Promise<Leaflet>((resolve, reject) => {
    const win = window as unknown as { L?: Leaflet };
    if (win.L) return resolve(win.L);

    if (!document.querySelector(`link[href="${CSS_HREF}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = CSS_HREF;
      document.head.appendChild(link);
    }

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${JS_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => (win.L ? resolve(win.L) : reject(new Error('Leaflet failed to load'))));
      existing.addEventListener('error', () => reject(new Error('Leaflet failed to load')));
      return;
    }

    const script = document.createElement('script');
    script.src = JS_SRC;
    script.async = true;
    script.onload = () => (win.L ? resolve(win.L) : reject(new Error('Leaflet failed to load')));
    script.onerror = () => reject(new Error('Leaflet failed to load'));
    document.head.appendChild(script);
  });

  return loader;
}
