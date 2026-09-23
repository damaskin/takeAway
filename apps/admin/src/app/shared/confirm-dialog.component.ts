import {
  Component,
  ElementRef,
  HostListener,
  afterNextRender,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

let nextId = 0;

/**
 * A modal question with an answer that matters: confirm or cancel, and —
 * when `reasonLabel` is set — a reason that must not be blank. Replaces
 * `window.prompt`, which cannot be translated, cannot require an answer
 * and treats Cancel as "go ahead without one".
 *
 * Texts arrive translated. Escape, the backdrop and Cancel all cancel.
 */
@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  template: `
    <button type="button" class="dialog-backdrop" [attr.aria-label]="cancelLabel()" (click)="cancel()"></button>
    <div class="dialog-card" role="dialog" aria-modal="true" [attr.aria-labelledby]="titleId">
      <h2 [id]="titleId" class="dialog-title">{{ title() }}</h2>
      @if (body()) {
        <p class="dialog-text">{{ body() }}</p>
      }
      @if (warning()) {
        <p class="dialog-warning">{{ warning() }}</p>
      }
      @if (reasonLabel()) {
        <label class="flex flex-col" style="gap: 6px">
          <span class="dialog-label">{{ reasonLabel() }}</span>
          <textarea
            #reasonBox
            rows="3"
            maxlength="1000"
            class="dialog-input"
            [placeholder]="reasonPlaceholder()"
            [value]="reason()"
            [attr.aria-invalid]="showReasonError()"
            (input)="reason.set(reasonBox.value)"
          ></textarea>
        </label>
        @if (showReasonError()) {
          <p class="dialog-error" role="alert">{{ reasonRequiredText() }}</p>
        }
      }
      <div class="dialog-actions">
        <button type="button" class="dialog-cancel" (click)="cancel()">{{ cancelLabel() }}</button>
        <button
          #confirmButton
          type="button"
          class="dialog-confirm disabled:opacity-50"
          [attr.data-tone]="tone()"
          [disabled]="busy()"
          (click)="confirm()"
        >
          {{ confirmLabel() }}
        </button>
      </div>
    </div>
  `,
  styles: [
    `
      .dialog-backdrop {
        position: fixed;
        inset: 0;
        z-index: 50;
        border: 0;
        padding: 0;
        background: rgba(0, 0, 0, 0.35);
      }
      .dialog-card {
        position: fixed;
        z-index: 51;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: min(460px, calc(100vw - 32px));
        max-height: calc(100vh - 32px);
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding: 24px;
        background: var(--color-foam);
        border-radius: var(--radius-card);
        box-shadow: var(--shadow-soft);
      }
      .dialog-title {
        margin: 0;
        font-family: var(--font-display);
        font-size: 20px;
        color: var(--color-espresso);
      }
      .dialog-text,
      .dialog-warning,
      .dialog-error {
        margin: 0;
        font-family: var(--font-sans);
        font-size: 14px;
        line-height: 1.5;
        color: var(--color-text-secondary);
      }
      .dialog-warning {
        padding: 10px 12px;
        border-left: 3px solid var(--color-berry);
        border-radius: 8px;
        background: var(--color-cream);
        color: var(--color-text-primary);
      }
      .dialog-error {
        font-size: 13px;
        color: var(--color-berry);
      }
      .dialog-label {
        font-family: var(--font-sans);
        font-size: 12px;
        font-weight: 500;
        color: var(--color-text-secondary);
      }
      .dialog-input {
        padding: 10px 12px;
        resize: vertical;
        background: var(--color-cream);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-input);
        font-family: var(--font-sans);
        font-size: 14px;
        outline: none;
      }
      .dialog-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
      }
      .dialog-cancel,
      .dialog-confirm {
        padding: 10px 18px;
        border: 0;
        border-radius: var(--radius-button);
        font-family: var(--font-sans);
        font-weight: 600;
        cursor: pointer;
      }
      .dialog-cancel {
        background: var(--color-latte);
        color: var(--color-espresso);
      }
      .dialog-confirm {
        background: var(--color-caramel);
        color: white;
      }
      .dialog-confirm[data-tone='danger'] {
        background: var(--color-berry);
      }
    `,
  ],
})
export class ConfirmDialogComponent {
  readonly title = input.required<string>();
  readonly body = input('');
  /** Shown highlighted: what the action breaks for someone else. */
  readonly warning = input('');
  readonly confirmLabel = input.required<string>();
  readonly cancelLabel = input.required<string>();
  readonly tone = input<'primary' | 'danger'>('primary');
  readonly busy = input(false);
  /** Asks for a reason, which then must not be blank. */
  readonly reasonLabel = input('');
  readonly reasonPlaceholder = input('');
  readonly reasonRequiredText = input('');

  /** Emits the trimmed reason, or '' when none was asked for. */
  readonly confirmed = output<string>();
  readonly cancelled = output<void>();

  readonly titleId = `confirm-dialog-${nextId++}`;
  readonly reason = signal('');
  private readonly attempted = signal(false);
  readonly showReasonError = computed(() => this.attempted() && !this.reason().trim());

  private readonly reasonBox = viewChild<ElementRef<HTMLTextAreaElement>>('reasonBox');
  private readonly confirmButton = viewChild<ElementRef<HTMLButtonElement>>('confirmButton');

  constructor() {
    afterNextRender(() => (this.reasonBox() ?? this.confirmButton())?.nativeElement.focus());
  }

  @HostListener('document:keydown.escape')
  cancel(): void {
    this.cancelled.emit();
  }

  confirm(): void {
    if (this.busy()) return;
    const reason = this.reason().trim();
    if (this.reasonLabel() && !reason) {
      this.attempted.set(true);
      this.reasonBox()?.nativeElement.focus();
      return;
    }
    this.confirmed.emit(reason);
  }
}
