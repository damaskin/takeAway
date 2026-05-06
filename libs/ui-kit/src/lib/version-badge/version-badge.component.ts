import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, of } from 'rxjs';

interface VersionInfo {
  version: string;
  commit: string;
  builtAt: string;
  app?: string;
}

/**
 * Tiny build-version pill, fixed to the bottom-right corner. Fetches
 * `/version.json` (written by deploy/scripts/extract-spa.sh on each
 * production deploy) and renders the short version string.
 *
 * Click → copies the full triple to the clipboard so QA can paste into
 * a bug report. Hidden when `?no-version` is in the URL — useful for
 * screenshots — and silently absent on dev where /version.json 404s.
 */
@Component({
  selector: 'lib-version-badge',
  standalone: true,
  template: `
    @if (info() && !suppressed) {
      <button
        type="button"
        class="lib-version-badge"
        (click)="copy()"
        [title]="tooltip()"
        [attr.aria-label]="tooltip()"
      >
        {{ info()!.version }}
      </button>
    }
  `,
  styles: [
    `
      .lib-version-badge {
        position: fixed;
        right: 0.5rem;
        bottom: 0.5rem;
        z-index: 9999;
        font:
          11px/1 ui-monospace,
          SFMono-Regular,
          Menlo,
          Consolas,
          monospace;
        padding: 4px 8px;
        background: rgba(0, 0, 0, 0.55);
        color: #fff;
        border: 0;
        border-radius: 999px;
        opacity: 0.55;
        cursor: pointer;
        transition: opacity 0.15s ease;
      }
      .lib-version-badge:hover {
        opacity: 1;
      }
    `,
  ],
})
export class VersionBadgeComponent implements OnInit {
  private readonly http = inject(HttpClient);
  readonly info = signal<VersionInfo | null>(null);
  readonly suppressed = typeof window !== 'undefined' && window.location.search.includes('no-version');

  ngOnInit(): void {
    if (this.suppressed) return;
    this.http
      .get<VersionInfo>('/version.json', { headers: { 'Cache-Control': 'no-cache' } })
      .pipe(catchError(() => of(null)))
      .subscribe((v) => {
        if (v && typeof v.version === 'string') this.info.set(v);
      });
  }

  tooltip(): string {
    const v = this.info();
    if (!v) return '';
    return `${v.version}\ncommit ${v.commit}\nbuilt ${v.builtAt}`;
  }

  async copy(): Promise<void> {
    const v = this.info();
    if (!v) return;
    const text = `version: ${v.version}\ncommit: ${v.commit}\nbuiltAt: ${v.builtAt}${v.app ? `\napp: ${v.app}` : ''}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API needs https + user gesture; click is a gesture, but
      // some embedded browsers (older TMA WebView) refuse anyway. Silent
      // failure is fine — the tooltip already shows the same content.
    }
  }
}
