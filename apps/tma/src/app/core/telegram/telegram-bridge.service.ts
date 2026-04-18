import { Injectable, signal } from '@angular/core';

interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: { user?: { first_name?: string; last_name?: string } };
  colorScheme?: 'light' | 'dark';
  themeParams?: Record<string, string>;
  ready: () => void;
  expand: () => void;
  close: () => void;
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

@Injectable({ providedIn: 'root' })
export class TelegramBridgeService {
  readonly isAvailable = signal<boolean>(typeof window !== 'undefined' && !!window.Telegram?.WebApp);
  readonly colorScheme = signal<'light' | 'dark'>(window.Telegram?.WebApp?.colorScheme ?? 'light');

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
}
