import { Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { SITE_LINKS_CONFIG, socialProfiles } from '../../core/config/site-links';

/**
 * takeAway's social profiles as icons, in the site footer. Only the networks
 * with an address in `SITE_LINKS.social` show; with none, nothing renders.
 * Each opens in a new tab without handing the site's window to the network.
 */
@Component({
  selector: 'app-social-links',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    @if (profiles.length > 0) {
      <nav class="social" [attr.aria-label]="'web.social.label' | translate">
        @for (p of profiles; track p.network) {
          <a
            [href]="p.url"
            target="_blank"
            rel="noopener"
            [attr.data-network]="p.network"
            [attr.aria-label]="'web.social.' + p.network | translate"
            [attr.title]="'web.social.' + p.network | translate"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              @switch (p.network) {
                @case ('instagram') {
                  <rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2" />
                  <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2" />
                  <circle cx="17.3" cy="6.7" r="1.3" fill="currentColor" />
                }
                @case ('telegram') {
                  <path
                    fill="currentColor"
                    d="M21.4 3.6 2.9 10.8c-1 .4-1 1.6.1 1.9l4.6 1.4 1.8 5.6c.3.8 1.3 1 1.9.4l2.6-2.4 4.6 3.4c.7.5 1.6.1 1.8-.7l3.1-14.8c.2-1.1-.9-2-1.9-1.6Zm-3.6 4.1-7.6 6.9-.3 3.2-1.3-4.2 8.7-5.4c.4-.2.8.3.5.5Z"
                  />
                }
                @case ('tiktok') {
                  <path
                    fill="currentColor"
                    d="M16.1 3c.3 2.2 1.7 3.7 3.9 3.9v3.1c-1.4 0-2.8-.4-3.9-1.2v6.1A5.9 5.9 0 1 1 10.2 9v3.2a2.8 2.8 0 1 0 2.8 2.8V3h3.1Z"
                  />
                }
                @case ('facebook') {
                  <path
                    fill="currentColor"
                    d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.5-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 3.9v2.3H8v3h2.5V21h3Z"
                  />
                }
                @case ('vk') {
                  <path
                    fill="currentColor"
                    d="M12.8 17.5C6.6 17.5 3.1 13.3 3 6.5h3.1c.1 5 2.3 7.1 4 7.5V6.5h2.9v4.3c1.7-.2 3.5-2.2 4.1-4.3H20c-.5 2.6-2.4 4.6-3.8 5.4 1.4.7 3.6 2.4 4.4 5.6h-3.2c-.7-2.1-2.4-3.8-4.4-4v4h-.2Z"
                  />
                }
              }
            </svg>
          </a>
        }
      </nav>
    }
  `,
  styles: [
    `
      .social {
        display: flex;
        gap: 10px;
      }
      .social a {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: rgba(248, 243, 235, 0.08);
        color: rgba(248, 243, 235, 0.8);
        transition: background 0.15s;
      }
      .social a:hover {
        background: rgba(248, 243, 235, 0.16);
        color: var(--color-cream);
      }
    `,
  ],
})
export class SocialLinksComponent {
  readonly profiles = socialProfiles(inject(SITE_LINKS_CONFIG));
}
