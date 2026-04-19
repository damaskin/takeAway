import { Injectable } from '@angular/core';

/**
 * Applies per-brand CSS-variable overrides on top of the Telegram theme
 * that TelegramBridgeService has already painted.
 *
 * Scope: a TMA user is always viewing exactly one brand at a time (via
 * the selected store), so we set overrides on `<html>` globally and reset
 * them when the user navigates out of that brand's context.
 */
@Injectable({ providedIn: 'root' })
export class BrandThemeService {
  private active: Record<string, string> | null = null;

  apply(overrides: Record<string, string> | null | undefined): void {
    this.reset();
    if (!overrides) return;
    const root = document.documentElement;
    for (const [cssVar, value] of Object.entries(overrides)) {
      if (!cssVar.startsWith('--')) continue; // hardening — only CSS vars
      root.style.setProperty(cssVar, value);
    }
    this.active = overrides;
  }

  reset(): void {
    if (!this.active) return;
    const root = document.documentElement;
    for (const cssVar of Object.keys(this.active)) {
      root.style.removeProperty(cssVar);
    }
    this.active = null;
  }
}
