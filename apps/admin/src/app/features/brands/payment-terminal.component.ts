import { Component, computed, inject, input, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocalDatePipe } from '@takeaway/i18n';
import type {
  PaymentTerminalCertificate,
  PaymentTerminalCheck,
  PaymentTerminalFlow,
  PaymentTerminalSecret,
  PaymentTerminalView,
  UpsertPaymentTerminalRequest,
} from '@takeaway/shared-types';

import { PaymentTerminalService } from '../../core/brands/payment-terminal.service';

/** Text fields shown with their stored value; edited in place. */
type PlainField =
  | 'cardMerchantId'
  | 'cardTerminalId'
  | 'webMerchantLogin'
  | 'webMerchantId'
  | 'qrTerminalId'
  | 'qrLogin'
  | 'qrDeviceId';
/** Write-only fields: empty — keep what is stored. */
type SecretField =
  | 'cardPrivateKey'
  | 'cardCertificate'
  | 'cardBankCertificate'
  | 'webMerchantPass'
  | 'webBankCertificate'
  | 'qrPassword'
  | 'qrExternalToken';

const SECTION_FIELDS: Record<PaymentTerminalFlow, Array<PlainField | SecretField>> = {
  card: ['cardMerchantId', 'cardTerminalId', 'cardPrivateKey', 'cardCertificate', 'cardBankCertificate'],
  web: ['webMerchantLogin', 'webMerchantId', 'webMerchantPass', 'webBankCertificate'],
  qr: ['qrTerminalId', 'qrLogin', 'qrPassword', 'qrExternalToken', 'qrDeviceId'],
};

interface Draft {
  plain: Record<PlainField, string>;
  secret: Record<SecretField, string>;
  holdUntilAccepted: boolean;
  isTest: boolean;
  note: string;
  /** Sections to take off the brand's terminal on save. */
  clear: Record<PaymentTerminalFlow, boolean>;
}

/**
 * «Платёжный терминал» on a brand's card (SUPER_ADMIN): the brand's own
 * Agroprombank registration, per flow — bound cards, Web-платёж, QR. A flow
 * without a section of its own is not offered to the brand's guests (never
 * takeAway's default terminal in its place, since 2026-11-27), and the block
 * says so; with no section at all the brand's orders are paid at the store. Secrets are never shown: «задан · …1234», and an
 * empty field keeps what is stored. Loads when opened, not for every brand
 * on the list.
 */
@Component({
  selector: 'app-payment-terminal',
  standalone: true,
  imports: [TranslatePipe, LocalDatePipe],
  styles: [
    `
      :host {
        display: block;
        margin-top: 12px;
        font-family: var(--font-sans);
        font-size: 13px;
        color: var(--color-text-primary);
      }
      .toggle,
      .link {
        padding: 0;
        border: 0;
        background: transparent;
        font: inherit;
        font-weight: 600;
        color: var(--color-caramel);
        cursor: pointer;
      }
      .panel {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-top: 8px;
        padding: 12px;
        border-radius: 10px;
        background: var(--color-cream);
      }
      .flows {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .source {
        font-weight: 600;
      }
      .source-brand {
        color: var(--color-mint);
      }
      .source-default {
        color: var(--color-amber);
      }
      fieldset {
        margin: 0;
        padding: 10px 12px 12px;
        border: 1px solid var(--color-border);
        border-radius: 10px;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 10px;
        min-width: 0;
      }
      legend {
        padding: 0 4px;
        font-weight: 600;
      }
      label {
        display: flex;
        flex-direction: column;
        gap: 4px;
        color: var(--color-text-secondary);
        min-width: 0;
      }
      label.wide {
        grid-column: 1 / -1;
      }
      label.check {
        flex-direction: row;
        align-items: center;
        gap: 8px;
      }
      input[type='text'],
      input[type='password'],
      textarea {
        width: 100%;
        box-sizing: border-box;
        padding: 6px 10px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-input);
        background: var(--color-foam);
        font: inherit;
        color: var(--color-text-primary);
      }
      textarea {
        min-height: 64px;
        font-family: var(--font-mono);
        font-size: 11px;
      }
      .hint {
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px 14px;
      }
      .primary,
      .secondary,
      .danger {
        height: 34px;
        padding: 0 14px;
        border: 0;
        border-radius: var(--radius-button);
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }
      .primary {
        background: var(--color-caramel);
        color: white;
      }
      .secondary {
        background: var(--color-latte);
        color: var(--color-espresso);
      }
      .danger {
        background: var(--color-berry);
        color: white;
      }
      button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .checks {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .outcome-OK {
        color: var(--color-mint);
      }
      .outcome-ANSWERED {
        color: var(--color-amber);
      }
      .outcome-FAILED {
        color: var(--color-berry);
      }
    `,
  ],
  template: `
    <button
      type="button"
      class="toggle"
      [attr.aria-expanded]="open()"
      (click)="toggle()"
      data-testid="payment-terminal-toggle"
    >
      {{ 'admin.brands.terminal.title' | translate }} {{ open() ? '▴' : '▾' }}
    </button>
    @if (open()) {
      <div class="panel" data-testid="payment-terminal">
        @if (loading()) {
          <span>{{ 'common.loading' | translate }}</span>
        } @else if (view(); as v) {
          <ul class="flows" data-testid="payment-terminal-flows">
            @for (flow of flows; track flow) {
              <li>
                {{ 'admin.brands.terminal.flows.' + flow | translate }}:
                @if (v[flow].source === 'BRAND') {
                  <span class="source source-brand">{{ 'admin.brands.terminal.sourceBrand' | translate }}</span>
                  · {{ identity(v, flow) }}
                } @else {
                  <span class="source source-default">{{ 'admin.brands.terminal.sourceNone' | translate }}</span>
                }
              </li>
            }
          </ul>
          <span class="hint">{{ 'admin.brands.terminal.hint' | translate }}</span>
          @if (v.updatedAt) {
            <span class="hint">{{
              'admin.brands.terminal.updated'
                | translate: { date: (v.updatedAt | localDate: 'dateTime'), name: v.updatedByName || '—' }
            }}</span>
          }

          @if (draft(); as d) {
            <form class="flex flex-col" style="gap: 12px" (submit)="$event.preventDefault(); save()">
              <fieldset data-testid="payment-terminal-card">
                <legend>{{ 'admin.brands.terminal.flows.card' | translate }}</legend>
                <span class="hint" style="grid-column: 1 / -1">{{ 'admin.brands.terminal.cardHint' | translate }}</span>
                <label>
                  <span>{{ 'admin.brands.terminal.fields.cardMerchantId' | translate }}</span>
                  <input
                    type="text"
                    autocomplete="off"
                    [value]="d.plain.cardMerchantId"
                    (input)="setPlain('cardMerchantId', $event)"
                  />
                </label>
                <label>
                  <span>{{ 'admin.brands.terminal.fields.cardTerminalId' | translate }}</span>
                  <input
                    type="text"
                    autocomplete="off"
                    [value]="d.plain.cardTerminalId"
                    (input)="setPlain('cardTerminalId', $event)"
                  />
                </label>
                <label class="wide">
                  <span
                    >{{ 'admin.brands.terminal.fields.cardPrivateKey' | translate }} ·
                    {{ secretLabel(v.card.privateKey) }}</span
                  >
                  <textarea
                    autocomplete="off"
                    spellcheck="false"
                    [value]="d.secret.cardPrivateKey"
                    (input)="setSecret('cardPrivateKey', $event)"
                    [placeholder]="'admin.brands.terminal.pemPlaceholder' | translate"
                  ></textarea>
                </label>
                <label class="wide">
                  <span
                    >{{ 'admin.brands.terminal.fields.cardCertificate' | translate }} ·
                    {{ certLabel(v.card.certificate) }}</span
                  >
                  <textarea
                    spellcheck="false"
                    [value]="d.secret.cardCertificate"
                    (input)="setSecret('cardCertificate', $event)"
                    [placeholder]="'admin.brands.terminal.pemPlaceholder' | translate"
                  ></textarea>
                </label>
                <label class="wide">
                  <span
                    >{{ 'admin.brands.terminal.fields.cardBankCertificate' | translate }} ·
                    {{ certLabel(v.card.bankCertificate, true) }}</span
                  >
                  <textarea
                    spellcheck="false"
                    [value]="d.secret.cardBankCertificate"
                    (input)="setSecret('cardBankCertificate', $event)"
                    [placeholder]="'admin.brands.terminal.pemPlaceholder' | translate"
                  ></textarea>
                </label>
                @if (v.card.source === 'BRAND') {
                  <label class="check wide">
                    <input type="checkbox" [checked]="d.clear.card" (change)="setClear('card', $event)" />
                    {{ 'admin.brands.terminal.clearSection' | translate }}
                  </label>
                }
              </fieldset>

              <fieldset data-testid="payment-terminal-web">
                <legend>{{ 'admin.brands.terminal.flows.web' | translate }}</legend>
                <label>
                  <span>{{ 'admin.brands.terminal.fields.webMerchantLogin' | translate }}</span>
                  <input
                    type="text"
                    autocomplete="off"
                    [value]="d.plain.webMerchantLogin"
                    (input)="setPlain('webMerchantLogin', $event)"
                  />
                </label>
                <label>
                  <span>{{ 'admin.brands.terminal.fields.webMerchantId' | translate }}</span>
                  <input
                    type="text"
                    autocomplete="off"
                    [value]="d.plain.webMerchantId"
                    (input)="setPlain('webMerchantId', $event)"
                  />
                </label>
                <label>
                  <span
                    >{{ 'admin.brands.terminal.fields.webMerchantPass' | translate }} ·
                    {{ secretLabel(v.web.merchantPass) }}</span
                  >
                  <input
                    type="password"
                    autocomplete="new-password"
                    [value]="d.secret.webMerchantPass"
                    (input)="setSecret('webMerchantPass', $event)"
                  />
                </label>
                <label class="wide">
                  <span
                    >{{ 'admin.brands.terminal.fields.webBankCertificate' | translate }} ·
                    {{ certLabel(v.web.bankCertificate, true) }}</span
                  >
                  <textarea
                    spellcheck="false"
                    [value]="d.secret.webBankCertificate"
                    (input)="setSecret('webBankCertificate', $event)"
                    [placeholder]="'admin.brands.terminal.pemPlaceholder' | translate"
                  ></textarea>
                </label>
                @if (v.web.source === 'BRAND') {
                  <label class="check wide">
                    <input type="checkbox" [checked]="d.clear.web" (change)="setClear('web', $event)" />
                    {{ 'admin.brands.terminal.clearSection' | translate }}
                  </label>
                }
              </fieldset>

              <fieldset data-testid="payment-terminal-qr">
                <legend>{{ 'admin.brands.terminal.flows.qr' | translate }}</legend>
                <label>
                  <span>{{ 'admin.brands.terminal.fields.qrTerminalId' | translate }}</span>
                  <input
                    type="text"
                    autocomplete="off"
                    placeholder="QRT000000000000000"
                    [value]="d.plain.qrTerminalId"
                    (input)="setPlain('qrTerminalId', $event)"
                  />
                </label>
                <label>
                  <span>{{ 'admin.brands.terminal.fields.qrLogin' | translate }}</span>
                  <input
                    type="text"
                    autocomplete="off"
                    [value]="d.plain.qrLogin"
                    (input)="setPlain('qrLogin', $event)"
                  />
                </label>
                <label>
                  <span
                    >{{ 'admin.brands.terminal.fields.qrPassword' | translate }} ·
                    {{ secretLabel(v.qr.password) }}</span
                  >
                  <input
                    type="password"
                    autocomplete="new-password"
                    [value]="d.secret.qrPassword"
                    (input)="setSecret('qrPassword', $event)"
                  />
                </label>
                <label>
                  <span
                    >{{ 'admin.brands.terminal.fields.qrExternalToken' | translate }} ·
                    {{ secretLabel(v.qr.externalToken) }}</span
                  >
                  <input
                    type="password"
                    autocomplete="new-password"
                    [value]="d.secret.qrExternalToken"
                    (input)="setSecret('qrExternalToken', $event)"
                  />
                </label>
                <label>
                  <span>{{ 'admin.brands.terminal.fields.qrDeviceId' | translate }}</span>
                  <input
                    type="text"
                    autocomplete="off"
                    [value]="d.plain.qrDeviceId"
                    (input)="setPlain('qrDeviceId', $event)"
                  />
                </label>
                @if (v.qr.source === 'BRAND') {
                  <label class="check wide">
                    <input type="checkbox" [checked]="d.clear.qr" (change)="setClear('qr', $event)" />
                    {{ 'admin.brands.terminal.clearSection' | translate }}
                  </label>
                }
              </fieldset>

              <fieldset>
                <legend>{{ 'admin.brands.terminal.common' | translate }}</legend>
                <label class="check wide">
                  <input
                    type="checkbox"
                    [checked]="d.holdUntilAccepted"
                    (change)="setFlag('holdUntilAccepted', $event)"
                  />
                  {{ 'admin.brands.terminal.fields.holdUntilAccepted' | translate }}
                </label>
                <label class="check wide">
                  <input type="checkbox" [checked]="d.isTest" (change)="setFlag('isTest', $event)" />
                  {{ 'admin.brands.terminal.fields.isTest' | translate }}
                </label>
                <label class="wide">
                  <span>{{ 'admin.brands.terminal.fields.note' | translate }}</span>
                  <input type="text" [value]="d.note" (input)="setNote($event)" />
                </label>
              </fieldset>

              <span class="hint">{{ 'admin.brands.terminal.secretsHint' | translate }}</span>
              <div class="actions">
                <button type="submit" class="primary" [disabled]="busy()" data-testid="payment-terminal-save">
                  {{ 'common.save' | translate }}
                </button>
                @if (v.id) {
                  <button
                    type="button"
                    class="secondary"
                    [disabled]="busy()"
                    (click)="check()"
                    data-testid="payment-terminal-check"
                  >
                    {{ 'admin.brands.terminal.check' | translate }}
                  </button>
                  @if (confirmingRemove()) {
                    <span>{{ 'admin.brands.terminal.removeConfirm' | translate }}</span>
                    <button
                      type="button"
                      class="danger"
                      [disabled]="busy()"
                      (click)="remove()"
                      data-testid="payment-terminal-remove-confirm"
                    >
                      {{ 'admin.brands.terminal.remove' | translate }}
                    </button>
                    <button type="button" class="link" (click)="confirmingRemove.set(false)">
                      {{ 'common.cancel' | translate }}
                    </button>
                  } @else {
                    <button
                      type="button"
                      class="link"
                      style="color: var(--color-berry)"
                      (click)="confirmingRemove.set(true)"
                      data-testid="payment-terminal-remove"
                    >
                      {{ 'admin.brands.terminal.remove' | translate }}
                    </button>
                  }
                }
              </div>
            </form>
          }

          @if (checks(); as list) {
            <ul class="checks" role="status" data-testid="payment-terminal-checks">
              @for (c of list; track c.flow) {
                <li>
                  {{ 'admin.brands.terminal.flows.' + c.flow | translate }}:
                  <span [class]="'outcome-' + c.outcome">{{
                    'admin.brands.terminal.outcome.' + c.outcome | translate
                  }}</span>
                  — {{ c.message }}
                </li>
              }
            </ul>
          }
        }
        @if (saved()) {
          <span role="status" data-testid="payment-terminal-saved">{{
            'admin.brands.terminal.saved' | translate
          }}</span>
        }
        @if (error(); as message) {
          <span role="alert" style="color: var(--color-berry)">{{ message }}</span>
        }
      </div>
    }
  `,
})
export class PaymentTerminalComponent {
  readonly brandId = input.required<string>();

  private readonly api = inject(PaymentTerminalService);
  private readonly translate = inject(TranslateService);

  readonly flows: ReadonlyArray<PaymentTerminalFlow> = ['card', 'web', 'qr'];
  readonly open = signal(false);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly view = signal<PaymentTerminalView | null>(null);
  readonly draft = signal<Draft | null>(null);
  readonly checks = signal<PaymentTerminalCheck[] | null>(null);
  readonly saved = signal(false);
  readonly error = signal<string | null>(null);
  readonly confirmingRemove = signal(false);

  /** What the request would carry — for tests and the disabled state. */
  readonly request = computed(() => {
    const v = this.view();
    const d = this.draft();
    return v && d ? buildRequest(v, d) : null;
  });

  toggle(): void {
    const open = !this.open();
    this.open.set(open);
    if (open && !this.view()) this.load();
  }

  identity(v: PaymentTerminalView, flow: PaymentTerminalFlow): string {
    if (flow === 'card') return [v.card.merchantId, v.card.terminalId].filter(Boolean).join(' / ');
    if (flow === 'web') return v.web.merchantLogin ?? '';
    return v.qr.terminalId ?? '';
  }

  secretLabel(secret: PaymentTerminalSecret): string {
    if (!secret.set) return this.translate.instant('admin.brands.terminal.notSet');
    return secret.last4
      ? this.translate.instant('admin.brands.terminal.setTail', { tail: secret.last4 })
      : this.translate.instant('admin.brands.terminal.set');
  }

  certLabel(cert: PaymentTerminalCertificate, fallsBack = false): string {
    if (!cert.set) {
      return this.translate.instant(
        fallsBack ? 'admin.brands.terminal.envCertificate' : 'admin.brands.terminal.notSet',
      );
    }
    const until = cert.validTo ? cert.validTo.slice(0, 10) : '?';
    return this.translate.instant('admin.brands.terminal.certificate', { subject: cert.subject ?? '?', until });
  }

  setPlain(field: PlainField, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.draft.update((d) => (d ? { ...d, plain: { ...d.plain, [field]: value } } : d));
  }

  setSecret(field: SecretField, event: Event): void {
    const value = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
    this.draft.update((d) => (d ? { ...d, secret: { ...d.secret, [field]: value } } : d));
  }

  setClear(flow: PaymentTerminalFlow, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.draft.update((d) => (d ? { ...d, clear: { ...d.clear, [flow]: checked } } : d));
  }

  setFlag(field: 'holdUntilAccepted' | 'isTest', event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.draft.update((d) => (d ? { ...d, [field]: checked } : d));
  }

  setNote(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.draft.update((d) => (d ? { ...d, note: value } : d));
  }

  save(): void {
    const body = this.request();
    if (!body || this.busy()) return;
    this.run(this.api.save(this.brandId(), body), () => this.saved.set(true));
  }

  remove(): void {
    if (this.busy()) return;
    this.run(this.api.remove(this.brandId()), () => this.confirmingRemove.set(false));
  }

  check(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.checks.set(null);
    this.api.check(this.brandId()).subscribe({
      next: (result) => {
        this.busy.set(false);
        this.checks.set(result.checks);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(this.describe(err));
      },
    });
  }

  private load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.get(this.brandId()).subscribe({
      next: (view) => {
        this.loading.set(false);
        this.accept(view);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set(this.describe(err));
      },
    });
  }

  private run(call: ReturnType<PaymentTerminalService['get']>, done: () => void): void {
    this.busy.set(true);
    this.error.set(null);
    this.saved.set(false);
    this.checks.set(null);
    call.subscribe({
      next: (view) => {
        this.busy.set(false);
        this.accept(view);
        done();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(this.describe(err));
      },
    });
  }

  private accept(view: PaymentTerminalView): void {
    this.view.set(view);
    this.draft.set(draftOf(view));
  }

  private describe(err: unknown): string {
    const body = (err as { error?: { message?: unknown } }).error;
    if (typeof body?.message === 'string') return body.message;
    if (Array.isArray(body?.message)) return (body.message as string[]).join(', ');
    return this.translate.instant('common.genericError');
  }
}

function draftOf(v: PaymentTerminalView): Draft {
  return {
    plain: {
      cardMerchantId: v.card.merchantId ?? '',
      cardTerminalId: v.card.terminalId ?? '',
      webMerchantLogin: v.web.merchantLogin ?? '',
      webMerchantId: v.web.merchantId ?? '',
      qrTerminalId: v.qr.terminalId ?? '',
      qrLogin: v.qr.login ?? '',
      qrDeviceId: v.qr.deviceId ?? '',
    },
    secret: {
      cardPrivateKey: '',
      cardCertificate: '',
      cardBankCertificate: '',
      webMerchantPass: '',
      webBankCertificate: '',
      qrPassword: '',
      qrExternalToken: '',
    },
    holdUntilAccepted: v.holdUntilAccepted,
    isTest: v.isTest,
    note: v.note ?? '',
    clear: { card: false, web: false, qr: false },
  };
}

/**
 * The PUT body: a text field only when it changed, a secret only when one
 * was typed (empty keeps what is stored), and a section ticked «убрать»
 * as nulls for all of its fields.
 */
export function buildRequest(v: PaymentTerminalView, d: Draft): UpsertPaymentTerminalRequest {
  const body: UpsertPaymentTerminalRequest = {};
  const loaded = draftOf(v);
  for (const field of Object.keys(d.plain) as PlainField[]) {
    const value = d.plain[field].trim();
    if (value !== loaded.plain[field]) body[field] = value || null;
  }
  for (const field of Object.keys(d.secret) as SecretField[]) {
    const value = d.secret[field].trim();
    if (value) body[field] = value;
  }
  if (d.holdUntilAccepted !== v.holdUntilAccepted) body.holdUntilAccepted = d.holdUntilAccepted;
  if (d.isTest !== v.isTest) body.isTest = d.isTest;
  if (d.note.trim() !== (v.note ?? '')) body.note = d.note.trim() || null;
  for (const flow of Object.keys(d.clear) as PaymentTerminalFlow[]) {
    if (!d.clear[flow]) continue;
    for (const field of SECTION_FIELDS[flow]) body[field] = null;
  }
  return body;
}
