import { Injectable, signal } from '@angular/core';

interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: { user?: { first_name?: string; last_name?: string } };
  colorScheme?: 'light' | 'dark';
  themeParams?: Record<string, string>;
  ready: () => void;
  expand: () => void;
  close: () => void;
  onEvent?: (event: 'themeChanged' | 'viewportChanged', cb: () => void) => void;
  offEvent?: (event: 'themeChanged' | 'viewportChanged', cb: () => void) => void;
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

@Injectable({ providedIn: 'root' })
export class TelegramBridgeService {
  readonly isAvailable = signal<boolean>(typeof window !== 'undefined' && !!window.Telegram?.WebApp);
  readonly colorScheme = signal<'light' | 'dark'>(window.Telegram?.WebApp?.colorScheme ?? 'light');

  constructor() {
    if (this.isAvailable()) {
      this.applyTelegramTheme();
      window.Telegram?.WebApp?.onEvent?.('themeChanged', () => {
        this.colorScheme.set(window.Telegram?.WebApp?.colorScheme ?? 'light');
        this.applyTelegramTheme();
      });
    }
  }

  get initData(): string | null {
    return window.Telegram?.WebApp?.initData || null;
  }

  ready(): void {
    window.Telegram?.WebApp?.ready();
  }

  expand(): void {
    window.Telegram?.WebApp?.expand();
  }

  setMainButton(text: string, handler: () => void): void {
    const btn = window.Telegram?.WebApp?.MainButton;
    if (!btn) return;
    btn.setText(text);
    btn.onClick(handler);
    btn.show();
    btn.enable();
  }

  hideMainButton(): void {
    window.Telegram?.WebApp?.MainButton.hide();
  }

  setBackButton(handler: () => void): () => void {
    const btn = window.Telegram?.WebApp?.BackButton;
    if (!btn) return () => undefined;
    btn.onClick(handler);
    btn.show();
    return () => {
      btn.offClick(handler);
      btn.hide();
    };
  }

  haptic(style: 'light' | 'medium' | 'heavy' = 'light'): void {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(style);
  }

  /**
   * Copy Telegram's themeParams onto the design-token CSS variables so the
   * whole app adopts the user's Telegram palette (light + dark) without
   * touching individual components. Brand overrides are applied on top via
   * {@link BrandThemeService}.
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
