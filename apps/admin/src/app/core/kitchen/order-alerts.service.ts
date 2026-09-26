import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { type Subscription, interval } from 'rxjs';

import { AuthStore } from '../auth/auth.store';
import { ActiveBrandService } from '../brand-context/active-brand.service';
import { AdminCatalogApi } from '../catalog/admin-catalog.service';
import { apiErrorMessage } from '../http/api-error';
import { type AdminRole, canAccess } from '../permissions/permissions';
import { type KitchenOrderChanged, awaitsAcceptance } from './kitchen-board';
import { KitchenApi, type KitchenOrder } from './kitchen.api';
import { KitchenRealtimeService } from './kitchen-realtime.service';

export interface KitchenStore {
  id: string;
  name: string;
  timezone: string | null;
}

/** An order nobody has taken on yet, with the store it came to. */
export interface PendingOrder {
  orderId: string;
  orderCode: string;
  storeId: string;
  storeName: string;
  timezone: string | null;
  pickupAt: string;
  itemCount: number;
}

/** A pop-up about a new order; lives until someone accepts or closes it. */
export interface OrderAlert extends PendingOrder {
  busy: boolean;
  error: string | null;
}

const SOUND_KEY = 'takeaway.admin.orderSound';
/** Older pop-ups beyond this are folded away; the sidebar counter still has them. */
const MAX_ALERTS = 4;
/** Safety net for a missed event: the socket is the main path. */
const RESYNC_MS = 60_000;

/**
 * New-order alerts across the whole cabinet, not only on the kitchen page:
 * whoever runs the brand hears a chime, sees a pop-up they can accept from,
 * and a counter next to "Kitchen" in the menu, wherever they are.
 *
 * It follows the brand picked in the header and listens to every store of
 * it that the account may run — the API narrows both the list and the
 * socket rooms to the account's scope. Orders already waiting when the
 * cabinet opens are counted but do not pop up; only arrivals after that do.
 */
@Injectable({ providedIn: 'root' })
export class OrderAlertsService {
  private readonly auth = inject(AuthStore);
  private readonly activeBrand = inject(ActiveBrandService);
  private readonly catalog = inject(AdminCatalogApi);
  private readonly kitchen = inject(KitchenApi);
  private readonly realtime = inject(KitchenRealtimeService);
  private readonly translate = inject(TranslateService);

  private readonly _pending = signal<ReadonlyMap<string, PendingOrder>>(new Map());
  private readonly _alerts = signal<OrderAlert[]>([]);
  private readonly _stores = signal<KitchenStore[]>([]);

  /** Orders waiting for "Accept" in the stores being watched. */
  readonly pendingCount = computed(() => this._pending().size);
  readonly alerts = this._alerts.asReadonly();
  readonly stores = this._stores.asReadonly();
  readonly soundOn = signal(readSoundPreference());
  /** Bumped on every order change in the watched stores, for pages that show live figures. */
  private readonly _revision = signal(0);
  readonly revision = this._revision.asReadonly();

  private detach: Array<() => void> = [];
  private resync: Subscription | null = null;
  /** Bumped on every brand switch so a late answer for the old brand is ignored. */
  private generation = 0;
  private audio: AudioContext | null = null;

  constructor() {
    effect(() => {
      const role = this.auth.user()?.role as AdminRole | undefined;
      const brandId = this.activeBrand.activeId();
      untracked(() => this.follow(canAccess(role, 'kitchen') ? brandId : null));
    });
    effect(() => writeSoundPreference(this.soundOn()));
    inject(DestroyRef).onDestroy(() => this.follow(null));
  }

  /** Charges the card if it was only held, and moves the order to "Accepted". */
  accept(orderId: string): void {
    const order = this._pending().get(orderId);
    if (!order) return;
    this.patchAlert(orderId, { busy: true, error: null });
    this.kitchen.run('accept', order.storeId, orderId).subscribe({
      next: () => {
        this.forget(orderId);
      },
      error: (err) =>
        this.patchAlert(orderId, {
          busy: false,
          error: apiErrorMessage(err, this.translate, {
            network: 'common.networkError',
            statuses: { 403: 'common.forbidden', 404: 'admin.kitchen.errors.gone' },
          }),
        }),
    });
  }

  dismiss(orderId: string): void {
    this._alerts.update((list) => list.filter((a) => a.orderId !== orderId));
  }

  /**
   * Turns the chime on or off. Turning it on is also the click browsers want
   * before they let a page play sound or show system notifications.
   */
  toggleSound(): void {
    const on = !this.soundOn();
    this.soundOn.set(on);
    if (!on) return;
    this.chime();
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  }

  private follow(brandId: string | null): void {
    const generation = ++this.generation;
    for (const stop of this.detach) stop();
    this.detach = [];
    this.resync?.unsubscribe();
    this.resync = null;
    this._pending.set(new Map());
    this._alerts.set([]);
    this._stores.set([]);
    if (!brandId) return;

    this.catalog.listStores(brandId).subscribe({
      next: (rows) => {
        if (generation !== this.generation) return;
        const stores = rows.map((s) => ({ id: s.id, name: s.name, timezone: s.timezone ?? null }));
        this._stores.set(stores);
        for (const store of stores) {
          this.detach.push(this.realtime.watch(store.id, (event) => this.onEvent(store, event)));
          this.load(store, generation, false);
        }
        this.resync = interval(RESYNC_MS).subscribe(() => {
          for (const store of stores) this.load(store, generation, true);
        });
      },
      // Without the store list there is nothing to listen to; the kitchen
      // page reports the failure where someone is looking at it.
      error: () => undefined,
    });
  }

  private load(store: KitchenStore, generation: number, announce: boolean): void {
    this.kitchen.list(store.id).subscribe({
      next: (orders) => {
        if (generation !== this.generation) return;
        const before = this._pending();
        const next = new Map([...before].filter(([, p]) => p.storeId !== store.id));
        for (const order of orders.filter(awaitsAcceptance)) {
          const pending = toPending(store, order);
          next.set(order.id, pending);
          if (announce && !before.has(order.id)) this.announce(pending);
        }
        this._pending.set(next);
        this.dropStaleAlerts();
      },
      error: () => undefined,
    });
  }

  private onEvent(store: KitchenStore, event: KitchenOrderChanged): void {
    this._revision.update((n) => n + 1);
    if (event.kind === 'removed') {
      this.forget(event.orderId);
      return;
    }
    if (!event.order) {
      this.load(store, this.generation, true);
      return;
    }
    const order = event.order as KitchenOrder;
    if (!awaitsAcceptance(order)) {
      this.forget(order.id);
      return;
    }
    const pending = toPending(store, order);
    const isNew = !this._pending().has(order.id);
    this._pending.update((map) => new Map(map).set(order.id, pending));
    if (isNew) this.announce(pending);
  }

  private announce(order: PendingOrder): void {
    this._alerts.update((list) =>
      [{ ...order, busy: false, error: null }, ...list.filter((a) => a.orderId !== order.orderId)].slice(0, MAX_ALERTS),
    );
    if (this.soundOn()) this.chime();
    this.notifySystem(order);
  }

  private forget(orderId: string): void {
    if (this._pending().has(orderId)) {
      this._pending.update((map) => {
        const next = new Map(map);
        next.delete(orderId);
        return next;
      });
    }
    this.dismiss(orderId);
  }

  /** A pop-up for an order someone accepted elsewhere — on a tablet, say — goes away. */
  private dropStaleAlerts(): void {
    const pending = this._pending();
    this._alerts.update((list) => list.filter((a) => pending.has(a.orderId)));
  }

  private patchAlert(orderId: string, patch: Partial<OrderAlert>): void {
    this._alerts.update((list) => list.map((a) => (a.orderId === orderId ? { ...a, ...patch } : a)));
  }

  /** A short two-note chime, synthesised so the cabinet ships no audio file. */
  private chime(): void {
    try {
      const Ctx =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.audio ??= new Ctx();
      const ctx = this.audio;
      if (ctx.state === 'suspended') void ctx.resume();
      [880, 1318.5].forEach((frequency, i) => {
        const start = ctx.currentTime + i * 0.18;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.4);
      });
    } catch {
      // No audio device, or the browser still refuses — the pop-up is enough.
    }
  }

  /** When the cabinet sits in a background tab, the OS notification is what gets noticed. */
  private notifySystem(order: PendingOrder): void {
    if (typeof document === 'undefined' || !document.hidden) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
      new Notification(this.translate.instant('admin.kitchen.alerts.systemTitle', { code: order.orderCode }), {
        body: order.storeName,
        tag: `order-${order.orderId}`,
      });
    } catch {
      // Some mobile browsers only allow notifications from a service worker.
    }
  }
}

function toPending(store: KitchenStore, order: KitchenOrder): PendingOrder {
  return {
    orderId: order.id,
    orderCode: order.orderCode,
    storeId: store.id,
    storeName: store.name,
    timezone: store.timezone,
    pickupAt: order.pickupAt,
    itemCount: order.items.reduce((sum, i) => sum + i.quantity, 0),
  };
}

function readSoundPreference(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

function writeSoundPreference(on: boolean): void {
  try {
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    // Storage-disabled browsers just forget the choice.
  }
}
