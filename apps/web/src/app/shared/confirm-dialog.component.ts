import { Component, ElementRef, HostListener, afterNextRender, input, output, viewChild } from '@angular/core';

let nextId = 0;

/**
 * A modal yes-or-no question before something that cannot be undone, such
 * as cancelling an order. Texts arrive translated. Escape, the backdrop and
 * the dismiss button all answer no; the dismiss button has the focus, so a
 * stray Enter does not confirm.
 */
@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  template: `
    <button type="button" class="backdrop" [attr.aria-label]="dismissLabel()" (click)="dismiss()"></button>
    <div
      class="card"
      role="alertdialog"
      aria-modal="true"
      [attr.aria-labelledby]="titleId"
      [attr.aria-describedby]="body() ? bodyId : null"
    >
      <h2 [id]="titleId" class="title">{{ title() }}</h2>
      @if (body()) {
        <p [id]="bodyId" class="text">{{ body() }}</p>
      }
      <div class="actions">
        <button #dismissButton type="button" class="dismiss" data-testid="confirm-dismiss" (click)="dismiss()">
          {{ dismissLabel() }}
        </button>
        <button type="button" class="confirm" data-testid="confirm-accept" [disabled]="busy()" (click)="confirm()">
          {{ confirmLabel() }}
        </button>
      </div>
    </div>
  `,
  styles: [
    `
      .backdrop {
        position: fixed;
        inset: 0;
        z-index: 50;
        border: 0;
        padding: 0;
        background: rgba(0, 0, 0, 0.35);
      }
      .card {
        position: fixed;
        z-index: 51;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: min(420px, calc(100vw - 32px));
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 24px;
        background: var(--color-foam);
        border-radius: 20px;
        box-shadow: var(--shadow-soft);
        font-family: var(--font-sans);
      }
      .title {
        margin: 0;
        font-family: var(--font-display);
        font-size: 22px;
        font-weight: 600;
        color: var(--color-espresso);
      }
      .text {
        margin: 0;
        font-size: 14px;
        line-height: 1.5;
        color: var(--color-text-secondary);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 4px;
      }
      .dismiss,
      .confirm {
        min-height: 44px;
        padding: 0 18px;
        border: 0;
        border-radius: 12px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
      }
      .dismiss {
        background: var(--color-cream);
        color: var(--color-espresso);
        border: 1px solid var(--color-border);
      }
      .confirm {
        background: var(--color-berry);
        color: var(--color-foam);
      }
      .confirm:disabled {
        opacity: 0.5;
        cursor: default;
      }
    `,
  ],
})
export class ConfirmDialogComponent {
  readonly title = input.required<string>();
  readonly body = input('');
  readonly confirmLabel = input.required<string>();
  readonly dismissLabel = input.required<string>();
  /** The confirmed action is on its way: the confirm button waits. */
  readonly busy = input(false);

  readonly confirmed = output<void>();
  readonly dismissed = output<void>();

  readonly titleId = `confirm-dialog-${nextId}-title`;
  readonly bodyId = `confirm-dialog-${nextId++}-body`;

  private readonly dismissButton = viewChild<ElementRef<HTMLButtonElement>>('dismissButton');

  constructor() {
    afterNextRender(() => this.dismissButton()?.nativeElement.focus());
  }

  @HostListener('document:keydown.escape')
  dismiss(): void {
    this.dismissed.emit();
  }

  confirm(): void {
    if (!this.busy()) this.confirmed.emit();
  }
}
