import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import * as L from 'leaflet';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  label?: string;
  kind?: 'store' | 'user';
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** Kishinev city centre — neutral fallback when nothing else is known. */
const FALLBACK_CENTER: LatLng = { lat: 47.0105, lng: 28.8638 };

/**
 * Shared Leaflet + OpenStreetMap map.
 *
 * Two modes on one component:
 *  - default (`pickable=false`) — renders `markers` + an optional
 *    `userPosition` dot. Set `interactive=false` for static thumbnails
 *    (order-status mini-map).
 *  - `pickable=true` — renders a single draggable marker; dragging it or
 *    clicking the map emits `markerMoved`. Used by the admin store picker.
 *
 * Leaflet touches the DOM directly, so init runs in `afterNextRender`.
 */
@Component({
  selector: 'lib-leaflet-map',
  standalone: true,
  template: `<div #host style="width: 100%; height: 100%; min-height: 140px; border-radius: 14px; z-index: 0"></div>`,
})
export class LeafletMapComponent {
  readonly markers = input<MapMarker[]>([]);
  readonly userPosition = input<LatLng | null>(null);
  readonly center = input<LatLng | null>(null);
  readonly zoom = input<number>(15);
  readonly interactive = input<boolean>(true);
  readonly pickable = input<boolean>(false);

  readonly markerMoved = output<LatLng>();
  readonly markerClicked = output<string>();

  private readonly hostRef = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private readonly elementRef = inject(ElementRef);

  private map?: L.Map;
  private markerLayer?: L.LayerGroup;
  private pickMarker?: L.Marker;
  private resizeObserver?: ResizeObserver;

  /** First marker / explicit center / user position / fallback. */
  private readonly resolvedCenter = computed<LatLng>(() => {
    const explicit = this.center();
    if (explicit) return explicit;
    const first = this.markers()[0];
    if (first) return { lat: first.lat, lng: first.lng };
    return this.userPosition() ?? FALLBACK_CENTER;
  });

  constructor() {
    afterNextRender(() => this.initMap());
    // Re-sync whenever inputs change — guarded on the map existing.
    effect(() => {
      // touch the signals so the effect re-runs on change
      this.markers();
      this.userPosition();
      this.center();
      if (this.map) this.syncContent();
    });
  }

  private initMap(): void {
    const c = this.resolvedCenter();
    const map = L.map(this.hostRef().nativeElement, {
      center: [c.lat, c.lng],
      zoom: this.zoom(),
      zoomControl: this.interactive(),
      dragging: this.interactive(),
      scrollWheelZoom: this.interactive(),
      doubleClickZoom: this.interactive(),
      touchZoom: this.interactive(),
      boxZoom: this.interactive(),
      keyboard: this.interactive(),
      attributionControl: true,
    });

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);

    this.markerLayer = L.layerGroup().addTo(map);
    this.map = map;

    if (this.pickable()) {
      map.on('click', (e: L.LeafletMouseEvent) => this.placePickMarker(e.latlng.lat, e.latlng.lng, true));
    }

    this.syncContent();

    // Leaflet mis-sizes when the container animates in or mounts after data;
    // recalc on first paint and on any host resize.
    map.invalidateSize();
    this.resizeObserver = new ResizeObserver(() => this.map?.invalidateSize());
    this.resizeObserver.observe(this.elementRef.nativeElement);
  }

  private syncContent(): void {
    if (this.pickable()) {
      const first = this.markers()[0] ?? this.center();
      if (first) this.placePickMarker(first.lat, first.lng, false);
      return;
    }
    this.renderMarkers();
  }

  private renderMarkers(): void {
    const map = this.map;
    const layer = this.markerLayer;
    if (!map || !layer) return;
    layer.clearLayers();

    const points: L.LatLngExpression[] = [];

    for (const m of this.markers()) {
      const marker = L.marker([m.lat, m.lng], { icon: storeIcon(), title: m.label ?? '' });
      marker.on('click', () => this.markerClicked.emit(m.id));
      marker.addTo(layer);
      points.push([m.lat, m.lng]);
    }

    const user = this.userPosition();
    if (user) {
      L.marker([user.lat, user.lng], { icon: userIcon(), interactive: false }).addTo(layer);
      points.push([user.lat, user.lng]);
    }

    const only = points[0];
    if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points), { padding: [32, 32], maxZoom: 16 });
    } else if (only) {
      map.setView(only, this.zoom());
    } else {
      const c = this.resolvedCenter();
      map.setView([c.lat, c.lng], this.zoom());
    }
  }

  private placePickMarker(lat: number, lng: number, emit: boolean): void {
    const map = this.map;
    if (!map) return;
    if (!this.pickMarker) {
      this.pickMarker = L.marker([lat, lng], { icon: storeIcon(), draggable: true }).addTo(map);
      this.pickMarker.on('dragend', () => {
        const p = this.pickMarker?.getLatLng();
        if (p) this.markerMoved.emit({ lat: p.lat, lng: p.lng });
      });
    } else {
      this.pickMarker.setLatLng([lat, lng]);
    }
    map.setView([lat, lng], Math.max(map.getZoom(), this.zoom()));
    if (emit) this.markerMoved.emit({ lat, lng });
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.map?.remove();
    this.map = undefined;
  }
}

/** Caramel teardrop pin for a store / picker marker. */
function storeIcon(): L.DivIcon {
  return L.divIcon({
    className: '',
    iconSize: [28, 36],
    iconAnchor: [14, 36],
    html: `<svg width="28" height="36" viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg">
      <path d="M14 0C6.3 0 0 6.3 0 14c0 9.5 14 22 14 22s14-12.5 14-22C28 6.3 21.7 0 14 0z"
        fill="var(--color-caramel, #c8702d)"/>
      <circle cx="14" cy="14" r="5.5" fill="#fff"/>
    </svg>`,
  });
}

/** Pulsing blue dot for the customer's own position. */
function userIcon(): L.DivIcon {
  return L.divIcon({
    className: '',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    html: `<div style="width:18px;height:18px;border-radius:50%;background:#2e7dd1;
      border:3px solid #fff;box-shadow:0 0 0 2px rgba(46,125,209,0.4)"></div>`,
  });
}
