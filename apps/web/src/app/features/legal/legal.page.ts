import { Component, DestroyRef, computed, effect, inject, input } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';

import { LEGAL_DOC_KEYS, type LegalDocKey } from './legal-document';
import { LEGAL_DOCUMENTS } from './legal-documents';
import { LegalTextComponent } from './legal-text.component';

/**
 * /privacy, /terms and /support — public, no sign-in. The App Store listing
 * links the first and the last, so they have to open for anyone.
 *
 * One page for all three: the route says which document (`data.doc`), the
 * language switcher says which translation. The browser tab gets the
 * document's title while it is open and the site's own back afterwards —
 * no other page sets one.
 */
@Component({
  selector: 'app-legal-page',
  standalone: true,
  imports: [RouterLink, TranslatePipe, LegalTextComponent],
  template: `
    <section
      style="background: var(--color-cream); padding: clamp(32px, 6vw, 56px) clamp(16px, 5vw, 24px) clamp(48px, 8vw, 80px)"
    >
      <article class="flex flex-col" style="max-width: 760px; margin: 0 auto; gap: 24px">
        <header class="flex flex-col" style="gap: 8px">
          <h1
            style="font-family: var(--font-display); font-size: clamp(30px, 5vw, 40px); font-weight: 700; line-height: 1.1; color: var(--color-espresso); margin: 0"
          >
            {{ document().title }}
          </h1>
          @if (document().effective; as effective) {
            <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0">
              {{ effective }}
            </p>
          }
        </header>

        @if (document().toc) {
          <nav class="legal-card legal-toc" [attr.aria-label]="'web.legal.contents' | translate">
            <span class="legal-label">{{ 'web.legal.contents' | translate }}</span>
            <ol>
              @for (section of contents(); track section.id) {
                <li>
                  <a routerLink="." [fragment]="section.id">{{ section.heading }}</a>
                </li>
              }
            </ol>
          </nav>
        }

        <div class="legal-card legal-prose">
          @for (section of document().sections; track $index) {
            @if (section.heading) {
              @if (section.level === 3) {
                <h3 [attr.id]="section.id ?? null">{{ section.heading }}</h3>
              } @else {
                <h2 [attr.id]="section.id ?? null">{{ section.heading }}</h2>
              }
            }
            @for (block of section.blocks; track $index) {
              @if (typeof block === 'string') {
                <p><app-legal-text [text]="block" /></p>
              } @else {
                <ul>
                  @for (item of block.list; track $index) {
                    <li><app-legal-text [text]="item" /></li>
                  }
                </ul>
              }
            }
          }
        </div>

        <nav class="legal-related" [attr.aria-label]="'web.legal.related' | translate">
          <span class="legal-label">{{ 'web.legal.related' | translate }}</span>
          @for (key of related(); track key) {
            <a [routerLink]="'/' + key">{{ 'web.legal.' + key | translate }}</a>
          }
        </nav>
      </article>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .legal-card {
        background: var(--color-foam);
        border: 1px solid var(--color-border-light);
        border-radius: var(--radius-card);
        padding: clamp(20px, 4vw, 40px);
      }
      .legal-label {
        font-family: var(--font-sans);
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 1px;
        text-transform: uppercase;
        color: var(--color-text-tertiary);
      }
      .legal-toc {
        padding-top: 20px;
        padding-bottom: 20px;
      }
      .legal-toc ol {
        list-style: none;
        margin: 12px 0 0;
        padding: 0;
        display: grid;
        gap: 8px;
      }
      .legal-toc a,
      .legal-related a {
        font-family: var(--font-sans);
        font-size: 15px;
        font-weight: 500;
        color: var(--color-caramel);
      }
      .legal-prose {
        font-family: var(--font-sans);
        color: var(--color-text-primary);
      }
      .legal-prose h2 {
        font-size: 20px;
        font-weight: 600;
        line-height: 1.3;
        color: var(--color-espresso);
        margin: 36px 0 12px;
      }
      .legal-prose h2:first-child,
      .legal-prose h3:first-child {
        margin-top: 0;
      }
      .legal-prose h3 {
        font-size: 16px;
        font-weight: 600;
        line-height: 1.4;
        color: var(--color-espresso);
        margin: 24px 0 8px;
      }
      .legal-prose p,
      .legal-prose li {
        font-size: 15px;
        line-height: 1.65;
      }
      .legal-prose p {
        margin: 0 0 12px;
      }
      .legal-prose ul {
        list-style: disc;
        margin: 0 0 12px;
        padding-left: 22px;
      }
      .legal-prose li + li {
        margin-top: 6px;
      }
      .legal-related {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 8px 20px;
        padding-top: 20px;
        border-top: 1px solid var(--color-border);
      }
    `,
  ],
})
export class LegalPage {
  /** Which document — the route's `data.doc`, bound by `withComponentInputBinding`. */
  readonly doc = input.required<LegalDocKey>();

  private readonly lang = inject(LocaleFormatService).lang;

  readonly document = computed(() => LEGAL_DOCUMENTS[this.doc()][this.lang()]);

  /** The top-level sections, for the table of contents. */
  readonly contents = computed(() =>
    this.document().sections.filter((s) => s.id !== undefined && s.heading !== undefined && s.level !== 3),
  );

  /** The other two pages, linked at the bottom. */
  readonly related = computed(() => LEGAL_DOC_KEYS.filter((key) => key !== this.doc()));

  constructor() {
    const title = inject(Title);
    const meta = inject(Meta);
    const siteTitle = title.getTitle();
    const siteDescription = meta.getTag('name="description"')?.content;

    effect(() => {
      const doc = this.document();
      title.setTitle(`${doc.title} — takeAway`);
      meta.updateTag({ name: 'description', content: doc.description });
    });

    inject(DestroyRef).onDestroy(() => {
      title.setTitle(siteTitle);
      if (siteDescription !== undefined) meta.updateTag({ name: 'description', content: siteDescription });
    });
  }
}
