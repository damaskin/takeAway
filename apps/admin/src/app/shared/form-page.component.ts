import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * The shell every add/edit screen in the admin sits in.
 *
 * These forms used to open inline, inside the card of the row being edited.
 * That card is as narrow as the list grid makes it — on the stores page,
 * 283px — and a form does not fit in it: fields were cut off by the card's
 * edge, and the form pushed the rest of the list out of view while it was
 * open. A form now gets a route and the whole page, so it has the width it
 * needs and a URL that can be linked, reloaded and gone back from.
 *
 * The shell owns the parts that must look the same everywhere: where the
 * title sits, where the way back is, where Save and Cancel are, and where
 * the error ends up. A feature supplies only its fields.
 */
@Component({
  selector: 'app-form-page',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `
    <section style="padding: clamp(16px, 3vw, 28px); max-width: 960px; margin: 0 auto">
      <a
        [routerLink]="backTo()"
        class="flex items-center"
        style="gap: 6px; width: fit-content; font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-text-secondary); text-decoration: none; margin-bottom: 14px"
      >
        <span aria-hidden="true">←</span>
        <span>{{ backLabel() | translate }}</span>
      </a>

      <header style="margin-bottom: 20px">
        <h1
          style="font-family: var(--font-display); font-size: 26px; font-weight: 700; color: var(--color-espresso); margin: 0"
        >
          {{ title() | translate }}
        </h1>
        @if (subtitle(); as sub) {
          <p
            style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 6px 0 0"
          >
            {{ sub }}
          </p>
        }
      </header>

      @if (loading()) {
        <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary)">
          {{ 'common.loading' | translate }}
        </p>
      } @else {
        <div
          style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 18px; padding: clamp(16px, 2.5vw, 24px)"
        >
          <ng-content />
        </div>

        @if (error(); as message) {
          <p
            role="alert"
            style="font-family: var(--font-sans); font-size: 13px; color: var(--color-berry); margin: 14px 0 0"
          >
            {{ message }}
          </p>
        }

        <div class="flex items-center flex-wrap" style="gap: 12px; margin-top: 20px">
          <button
            type="button"
            (click)="save.emit()"
            [disabled]="saveDisabled() || saving()"
            class="disabled:opacity-50"
            style="height: 40px; padding: 0 20px; background: var(--color-caramel); color: white; border: 0; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 600; cursor: pointer"
          >
            {{ (saving() ? 'common.loading' : saveLabel()) | translate }}
          </button>
          <a
            [routerLink]="backTo()"
            style="height: 40px; padding: 0 18px; display: inline-flex; align-items: center; background: var(--color-latte); color: var(--color-espresso); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 600; text-decoration: none"
          >
            {{ 'common.cancel' | translate }}
          </a>
          <ng-content select="[formPageExtraActions]" />
        </div>
      }
    </section>
  `,
})
export class FormPageComponent {
  /** Router link for the back arrow and for Cancel. */
  readonly backTo = input.required<unknown[]>();
  readonly backLabel = input<string>('common.back');
  readonly title = input.required<string>();
  /** Already-translated free text, e.g. the name of the record being edited. */
  readonly subtitle = input<string | null>(null);
  readonly saveLabel = input<string>('common.save');
  readonly saveDisabled = input<boolean>(false);
  readonly saving = input<boolean>(false);
  readonly loading = input<boolean>(false);
  readonly error = input<string | null>(null);

  readonly save = output<void>();
}
