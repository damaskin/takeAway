import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { parseLegalText } from './legal-document';

/**
 * One line of legal-page content, with its links and emphasis. Pages of this
 * site open through the router; e-mail and Telegram links are plain anchors,
 * web ones in a new tab.
 */
@Component({
  selector: 'app-legal-text',
  standalone: true,
  imports: [RouterLink],
  template: `
    @for (segment of segments(); track $index) {
      @switch (segment.kind) {
        @case ('strong') {
          <strong>{{ segment.text }}</strong>
        }
        @case ('route') {
          <a [routerLink]="segment.path" [fragment]="segment.fragment">{{ segment.text }}</a>
        }
        @case ('link') {
          <a
            [href]="segment.href"
            [attr.target]="segment.external ? '_blank' : null"
            [attr.rel]="segment.external ? 'noopener' : null"
            >{{ segment.text }}</a
          >
        }
        @default {
          <ng-container>{{ segment.text }}</ng-container>
        }
      }
    }
  `,
  styles: [
    `
      a {
        color: var(--color-caramel);
        font-weight: 500;
        text-decoration: underline;
        text-underline-offset: 2px;
        overflow-wrap: anywhere;
      }
      strong {
        font-weight: 600;
        color: var(--color-text-primary);
      }
    `,
  ],
})
export class LegalTextComponent {
  readonly text = input.required<string>();
  readonly segments = computed(() => parseLegalText(this.text()));
}
