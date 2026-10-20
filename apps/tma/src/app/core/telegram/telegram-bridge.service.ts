import { Injectable, signal } from '@angular/core';

/** Edge insets reported by Telegram (Bot API 8.0+). */
interface TelegramInset {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

type TelegramEvent =
  | 'themeChanged'
  | 'viewportChanged'
  | 'fullscreenChanged'
  | 'safeAreaChanged'
  | 'contentSafeAreaChanged';

/** `LocationManager.getLocation` result (Bot API 8.0). */
interface TelegramLocationData {
  latitude: number;
  longitude: number;
}

/** Bot API 8.0: the device location, behind Telegram's own permission prompt. */
interface TelegramLocationManager {
  isInited: boolean;
  isLocationAvailable: boolean;
  isAccessRequested: boolean;
  isAccessGranted: boolean;
  init: (callback?: () => void) => void;
  /** Called back with null when the customer did not grant access. */
  getLocation: (callback: (data: TelegramLocationData | null) => void) => void;
  /** Telegram's settings for this bot, where location access is switched back on. Only from a tap. */
  openSettings: () => void;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: {
    user?: { first_name?: string; last_name?: string; username?: string };
    start_param?: string;
  };
  /** Bot API version the client supports, e.g. "8.0". */
  version?: string;
  isVersionAtLeast?: (version: string) => boolean;
  colorScheme?: 'light' | 'dark';
  themeParams?: Record<string, string>;
  // Bot API 8.0+ — undefined on older Telegram clients.
  isFullscreen?: boolean;
  safeAreaInset?: TelegramInset;
  contentSafeAreaInset?: TelegramInset;
  LocationManager?: TelegramLocationManager;
  ready: () => void;
  expand: () => void;
  close: () => void;
  /** Bot API 7.7: a swipe down on the content scrolls instead of collapsing the Mini App. */
  disableVerticalSwipes?: () => void;
  /** Bot API 6.2: a native OK / Cancel dialog. */
  showConfirm?: (message: string, callback?: (confirmed: boolean) => void) => void;
  /** Bot API 6.1+: opens the link in the browser; the Mini App stays open. */
  openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
  onEvent?: (event: TelegramEvent, cb: () => void) => void;
  offEvent?: (event: TelegramEvent, cb: () => void) => void;
  MainButton: {
    setText: (text: string) => void;
    show: () => void;
    hide: () => void;
    enable: () => void;
    disable: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
  BackButton: {
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
  HapticFeedback?: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy') => void;
    selectionChanged: () => void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

/**
 * Maps from Telegram theme-param keys (as the client sends them) to the
 * CSS variables our design tokens declare. Keeps the bleed-through small
 * and deterministic — anything not mapped stays on the brand default.
 */
const THEME_MAPPING: Record<string, string[]> = {
  bg_color: ['--color-cream'],
  secondary_bg_color: ['--color-foam', '--color-surface', '--color-latte', '--color-surface-variant'],
  text_color: ['--color-espresso', '--color-text-primary'],
  hint_color: ['--color-text-secondary', '--color-text-tertiary'],
  button_color: ['--color-caramel'],
  button_text_color: ['--tg-button-text-color'],
  link_color: ['--tg-link-color'],
};

/** What {@link TelegramBridgeService.requestLocation} found out. */
export type DeviceLocation =
  | { kind: 'ok'; lat: number; lng: number }
  /**
   * The customer did not allow it. `canOpenSettings`: Telegram asked, and
   * only its settings can turn access back on ({@link TelegramBridgeService.openLocationSettings});
   * a browser's own prompt has no such way back.
   */
  | { kind: 'denied'; canOpenSettings: boolean }
  /** No way to locate here, or it failed (no GPS fix, timeout). */
  | { kind: 'unavailable' };

/** Telegram's own prompt can wait on the customer; past this we give up. */
const LOCATION_TIMEOUT_MS = 30_000;
/** A LocationManager that never answers `init` hands over to the browser. */
const LOCATION_INIT_TIMEOUT_MS = 3_000;

/** `order_<id>` launch parameter → the order id, or null for anything else. */
export function orderIdFromStartParam(param: string | null | undefined): string | null {
  const match = /^order_(.+)$/.exec(param ?? '');
  return match?.[1] ?? null;
}

@Injectable({ providedIn: 'root' })
export class TelegramBridgeService {
  readonly isAvailable = signal<boolean>(typeof window !== 'undefined' && !!window.Telegram?.WebApp);
  readonly colorScheme = signal<'light' | 'dark'>(window.Telegram?.WebApp?.colorScheme ?? 'light');
  /**
   * Edge insets Telegram reports, in CSS pixels: the device's own (notch,
   * home indicator, gesture bar) plus Telegram's controls over the content.
   * 0 on clients older than Bot API 8.0 — the stylesheet then falls back to
   * `env(safe-area-inset-*)`.
   */
  readonly safeAreaTop = signal(0);
  readonly safeAreaBottom = signal(0);
  readonly safeAreaLeft = signal(0);
  /** A screen offers a way back: Telegram's back button is shown (see {@link goBack}). */
  readonly canGoBack = signal(false);

  constructor() {
    if (this.isAvailable()) {
      this.applyTelegramTheme();
      this.applySafeArea();
      const tg = window.Telegram?.WebApp;
      tg?.onEvent?.('themeChanged', () => {
        this.colorScheme.set(window.Telegram?.WebApp?.colorScheme ?? 'light');
        this.applyTelegramTheme();
      });
      // In fullscreen mode Telegram draws its own close / menu controls over
      // the top of the webview; at the bottom the phone's home indicator or
      // gesture bar sits over the page. safeAreaInset covers the device,
      // contentSafeAreaInset Telegram's own controls. We sum both per edge
      // and expose them as CSS vars so the header and the tab bar clear them.
      const onSafeAreaChange = () => this.applySafeArea();
      tg?.onEvent?.('safeAreaChanged', onSafeAreaChange);
      tg?.onEvent?.('contentSafeAreaChanged', onSafeAreaChange);
      tg?.onEvent?.('fullscreenChanged', onSafeAreaChange);
      tg?.onEvent?.('viewportChanged', onSafeAreaChange);
    }
  }

  get initData(): string | null {
    return window.Telegram?.WebApp?.initData || null;
  }

  /**
   * The Telegram account the Mini App runs under, as Telegram describes it
   * (unsigned: for display only; the API checks `initData`).
   */
  get telegramUser(): { name: string; username: string | null } | null {
    const user = window.Telegram?.WebApp?.initDataUnsafe?.user;
    if (!user) return null;
    const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
    return { name, username: user.username || null };
  }

  /** True when the Telegram client supports this Bot API version; false outside Telegram. */
  supports(version: string): boolean {
    return window.Telegram?.WebApp?.isVersionAtLeast?.(version) ?? false;
  }

  /**
   * The `startapp` parameter the Mini App was launched with
   * (`t.me/<bot>/<app>?startapp=…`). Telegram puts it in `initDataUnsafe`
   * and, on some clients, only in the launch URL as `tgWebAppStartParam`.
   */
  get startParam(): string | null {
    const fromInitData = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
    if (fromInitData) return fromInitData;
    if (typeof location === 'undefined') return null;
    const fromQuery = new URLSearchParams(location.search).get('tgWebAppStartParam');
    if (fromQuery) return fromQuery;
    return new URLSearchParams(location.hash.replace(/^#/, '')).get('tgWebAppStartParam');
  }

  private startParamTaken = false;

  /**
   * The order a launch link points at (`startapp=order_<id>` — where the bank
   * sends a customer back after paying), handed out once: the parameter stays
   * on the launch for the whole session, and only the first screen should
   * follow it.
   */
  takeStartOrderId(): string | null {
    if (this.startParamTaken) return null;
    this.startParamTaken = true;
    return orderIdFromStartParam(this.startParam);
  }

  /**
   * Opens an outside page — the bank's payment page — in the browser, leaving
   * the Mini App open underneath. Outside Telegram it is a new tab.
   */
  openLink(url: string): void {
    const tg = window.Telegram?.WebApp;
    if (tg?.openLink) {
      tg.openLink(url);
      return;
    }
    window.open(url, '_blank', 'noopener');
  }

  ready(): void {
    window.Telegram?.WebApp?.ready();
  }

  expand(): void {
    window.Telegram?.WebApp?.expand();
  }

  /**
   * Keeps a swipe down on the page for scrolling (Bot API 7.7). Without it a
   * downward flick at the top of a long list (the menu, the stores, the
   * orders) collapses the whole Mini App instead of scrolling. The customer
   * still closes or collapses it by dragging Telegram's header. Older clients
   * keep their own behaviour.
   */
  disableVerticalSwipes(): void {
    if (this.supports('7.7')) window.Telegram?.WebApp?.disableVerticalSwipes?.();
  }

  /**
   * An OK / Cancel question: Telegram's native dialog (Bot API 6.2), else the
   * browser's. Resolves true when the customer confirmed.
   */
  confirm(message: string): Promise<boolean> {
    const tg = window.Telegram?.WebApp;
    if (tg?.showConfirm && this.supports('6.2')) {
      const show = tg.showConfirm;
      return new Promise((resolve) => show(message, (confirmed) => resolve(!!confirmed)));
    }
    if (typeof window.confirm !== 'function') return Promise.resolve(true);
    return Promise.resolve(window.confirm(message));
  }

  /**
   * Where the customer is. Telegram's LocationManager first (Bot API 8.0):
   * its permission prompt is the Mini App's own, and a refusal can be undone
   * in Telegram's settings. Where it is missing, or the device offers no
   * location to Telegram, the browser's geolocation.
   */
  async requestLocation(): Promise<DeviceLocation> {
    const manager = window.Telegram?.WebApp?.LocationManager;
    if (manager && this.supports('8.0')) {
      const viaTelegram = await locateViaTelegram(manager);
      if (viaTelegram) return viaTelegram;
    }
    return locateViaBrowser();
  }

  /** Telegram's settings for this bot, to allow location after a refusal. Call from a tap. */
  openLocationSettings(): void {
    window.Telegram?.WebApp?.LocationManager?.openSettings();
  }

  /**
   * Telegram's `onClick` adds a listener rather than replacing one, and pages
   * call this on every price or option change with a fresh closure. Without
   * dropping the previous handler one tap ran all of them: the product added
   * to the cart once per option the customer had touched, and checkout placed
   * the order that many times.
   */
  private mainButtonHandler: (() => void) | null = null;

  setMainButton(text: string, handler: () => void): void {
    const btn = window.Telegram?.WebApp?.MainButton;
    if (!btn) return;
    this.dropMainButtonHandler();
    btn.setText(text);
    btn.onClick(handler);
    this.mainButtonHandler = handler;
    btn.show();
    btn.enable();
  }

  hideMainButton(): void {
    this.dropMainButtonHandler();
    window.Telegram?.WebApp?.MainButton.hide();
  }

  private dropMainButtonHandler(): void {
    if (!this.mainButtonHandler) return;
    window.Telegram?.WebApp?.MainButton.offClick(this.mainButtonHandler);
    this.mainButtonHandler = null;
  }

  /**
   * What «back» does on the screens that are up, newest last. Telegram's
   * button gets one listener, which runs the newest: a screen whose
   * successor registers before it lets go no longer leaves two handlers on
   * the button, nor hides the button the successor just showed. The
   * left-edge swipe runs the same handler (see {@link goBack}).
   */
  private readonly backHandlers: Array<() => void> = [];
  private readonly onTelegramBack = (): void => {
    this.goBack();
  };
  private backListening = false;

  setBackButton(handler: () => void): () => void {
    this.backHandlers.push(handler);
    this.syncBackButton();
    return () => {
      const index = this.backHandlers.lastIndexOf(handler);
      if (index >= 0) this.backHandlers.splice(index, 1);
      this.syncBackButton();
    };
  }

  /** Does what Telegram's back button would do now. False when no screen offers a way back. */
  goBack(): boolean {
    const handler = this.backHandlers[this.backHandlers.length - 1];
    if (!handler) return false;
    handler();
    return true;
  }

  private syncBackButton(): void {
    const shown = this.backHandlers.length > 0;
    this.canGoBack.set(shown);
    const btn = window.Telegram?.WebApp?.BackButton;
    if (!btn) return;
    if (shown && !this.backListening) {
      btn.onClick(this.onTelegramBack);
      this.backListening = true;
    } else if (!shown && this.backListening) {
      btn.offClick(this.onTelegramBack);
      this.backListening = false;
    }
    if (shown) btn.show();
    else btn.hide();
  }

  haptic(style: 'light' | 'medium' | 'heavy' = 'light'): void {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(style);
  }

  /**
   * Writes the combined insets (device safe area + Telegram's content safe
   * area) into `--tg-safe-area-top` and `--tg-safe-area-bottom`. The app
   * shell pads its top by the first so the header never sits under
   * Telegram's fullscreen close / menu buttons; the tab bar and the pages'
   * ends pad by the second (through `--tma-safe-bottom` in styles.css) so
   * the phone's home indicator does not cover them. Both are 0 on Telegram
   * clients older than Bot API 8.0.
   */
  private applySafeArea(): void {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;
    const edge = (side: keyof TelegramInset): number =>
      (tg.safeAreaInset?.[side] ?? 0) + (tg.contentSafeAreaInset?.[side] ?? 0);
    const top = edge('top');
    const bottom = edge('bottom');
    this.safeAreaTop.set(top);
    this.safeAreaBottom.set(bottom);
    this.safeAreaLeft.set(edge('left'));
    const root = document.documentElement.style;
    root.setProperty('--tg-safe-area-top', `${top}px`);
    root.setProperty('--tg-safe-area-bottom', `${bottom}px`);
  }

  /**
   * Copy Telegram's themeParams onto the design-token CSS variables so the
   * whole app adopts the user's Telegram palette (light + dark) without
   * touching individual components. Brands add no colours of their own:
   * every brand shows in the one takeAway style (since 2026-10-11).
   */
  private applyTelegramTheme(): void {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;
    const root = document.documentElement;
    const scheme = tg.colorScheme ?? 'light';
    root.setAttribute('data-theme', scheme);
    root.setAttribute('data-tma', '1');

    const params = tg.themeParams ?? {};
    for (const [tgKey, cssVars] of Object.entries(THEME_MAPPING)) {
      const value = params[tgKey];
      if (!value) continue;
      for (const cssVar of cssVars) {
        root.style.setProperty(cssVar, value);
      }
    }
  }
}

/** Telegram's LocationManager; null hands over to the browser (no location on this device, or no answer). */
function locateViaTelegram(manager: TelegramLocationManager): Promise<DeviceLocation | null> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: DeviceLocation | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const ask = (): void => {
      if (!manager.isLocationAvailable) {
        finish(null);
        return;
      }
      timer = setTimeout(() => finish({ kind: 'unavailable' }), LOCATION_TIMEOUT_MS);
      manager.getLocation((data) =>
        finish(
          data ? { kind: 'ok', lat: data.latitude, lng: data.longitude } : { kind: 'denied', canOpenSettings: true },
        ),
      );
    };
    if (manager.isInited) {
      ask();
      return;
    }
    timer = setTimeout(() => finish(null), LOCATION_INIT_TIMEOUT_MS);
    manager.init(() => {
      clearTimeout(timer);
      if (!settled) ask();
    });
  });
}

function locateViaBrowser(): Promise<DeviceLocation> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve({ kind: 'unavailable' });
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ kind: 'ok', lat: pos.coords.latitude, lng: pos.coords.longitude }),
      // 1 = PERMISSION_DENIED; not every engine puts the constant on the error.
      (err) => resolve(err.code === 1 ? { kind: 'denied', canOpenSettings: false } : { kind: 'unavailable' }),
      { timeout: 10_000, maximumAge: 300_000 },
    );
  });
}
