import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import {
  ConnectPosRequest,
  PosApi,
  PosIntegrationView,
  PosProvider,
  PosSyncJobKind,
  PosSyncJobView,
} from '../../core/pos/pos.service';

interface ProviderRow {
  provider: PosProvider;
  integration: PosIntegrationView | null;
  jobs: PosSyncJobView[];
}

const PROVIDERS: PosProvider[] = ['POSTER', 'IIKO'];
const JOB_REFRESH_INTERVAL_MS = 3000;

/**
 * One-stop page for plugging in (and operating) external POS systems.
 * Per provider the page renders either a connect form (with the right
 * credential fields for that provider) or — once connected — the action
 * row: import stores / menu / stop-list / disconnect.
 *
 * Job history auto-refreshes every {@link JOB_REFRESH_INTERVAL_MS} ms
 * while a sync is RUNNING so the operator sees progress without manual
 * reloads. Polling stops as soon as nothing is in flight.
 */
@Component({
  selector: 'app-admin-integrations',
  standalone: true,
  imports: [DatePipe, ReactiveFormsModule, TranslatePipe],
  template: `
    <section style="padding: 32px; max-width: 980px">
      <h1 style="font-family: var(--font-display); font-size: 28px; color: var(--color-espresso); margin: 0 0 8px">
        {{ 'admin.integrations.title' | translate }}
      </h1>
      <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0 0 24px">
        {{ 'admin.integrations.subtitle' | translate }}
      </p>

      @if (loading()) {
        <p style="color: var(--color-text-secondary)">{{ 'common.loading' | translate }}</p>
      } @else {
        <div class="flex flex-col" style="gap: 20px">
          @for (row of rows(); track row.provider) {
            <article
              style="background: var(--color-foam); border-radius: var(--radius-card); padding: 24px; box-shadow: var(--shadow-soft)"
            >
              <header class="flex items-center" style="gap: 12px; margin-bottom: 16px">
                <h2
                  style="font-family: var(--font-display); font-size: 20px; color: var(--color-espresso); margin: 0; flex: 1"
                >
                  {{ 'admin.integrations.provider.' + row.provider | translate }}
                </h2>
                @if (row.integration; as integ) {
                  <span
                    [style.background]="statusBg(integ.status)"
                    [style.color]="statusFg(integ.status)"
                    style="padding: 4px 10px; border-radius: 999px; font-family: var(--font-sans); font-size: 12px; font-weight: 600; text-transform: uppercase"
                  >
                    {{ 'admin.integrations.status.' + integ.status | translate }}
                  </span>
                }
              </header>

              @if (row.integration; as integ) {
                <p
                  style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); margin: 0 0 16px"
                >
                  {{ 'admin.integrations.lastSync' | translate }}:
                  {{
                    integ.lastSyncAt ? (integ.lastSyncAt | date: 'medium') : ('admin.integrations.never' | translate)
                  }}
                </p>
                @if (integ.lastErrorMessage) {
                  <p
                    style="font-family: var(--font-sans); font-size: 13px; color: var(--color-berry); margin: 0 0 12px"
                  >
                    {{ integ.lastErrorMessage }}
                  </p>
                }

                <div class="flex flex-wrap" style="gap: 8px; margin-bottom: 16px">
                  <button type="button" (click)="enqueue(row, 'STORES')" [disabled]="busy()" class="action">
                    {{ 'admin.integrations.action.stores' | translate }}
                  </button>
                  <button type="button" (click)="enqueue(row, 'MENU')" [disabled]="busy()" class="action">
                    {{ 'admin.integrations.action.menu' | translate }}
                  </button>
                  <button type="button" (click)="enqueue(row, 'STOP_LIST')" [disabled]="busy()" class="action">
                    {{ 'admin.integrations.action.stopList' | translate }}
                  </button>
                  <button type="button" (click)="disconnect(row)" [disabled]="busy()" class="action danger">
                    {{ 'admin.integrations.action.disconnect' | translate }}
                  </button>
                </div>

                @if (row.jobs.length > 0) {
                  <div style="margin-top: 12px">
                    <h3
                      style="font-family: var(--font-sans); font-size: 12px; text-transform: uppercase; color: var(--color-text-tertiary); margin: 0 0 8px; letter-spacing: 0.04em"
                    >
                      {{ 'admin.integrations.jobsTitle' | translate }}
                    </h3>
                    <ul
                      style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px"
                    >
                      @for (job of row.jobs.slice(0, 5); track job.id) {
                        <li
                          class="flex items-center"
                          style="gap: 12px; padding: 8px 12px; background: var(--color-cream); border-radius: 8px"
                        >
                          <span
                            style="font-family: var(--font-mono); font-size: 12px; color: var(--color-text-tertiary); min-width: 100px"
                            >{{ job.createdAt | date: 'shortTime' }}</span
                          >
                          <span style="font-family: var(--font-sans); font-size: 13px; min-width: 90px">{{
                            'admin.integrations.kind.' + job.kind | translate
                          }}</span>
                          <span
                            [style.color]="jobStatusFg(job.status)"
                            style="font-family: var(--font-sans); font-size: 12px; font-weight: 600; min-width: 90px"
                          >
                            {{ 'admin.integrations.status.' + job.status | translate }}
                          </span>
                          @if (job.total > 0) {
                            <span
                              style="font-family: var(--font-mono); font-size: 12px; color: var(--color-text-secondary)"
                              >{{ job.progress }}/{{ job.total }}</span
                            >
                          }
                          @if (job.errorMessage) {
                            <span
                              style="flex: 1; font-family: var(--font-sans); font-size: 12px; color: var(--color-berry)"
                              >{{ job.errorMessage }}</span
                            >
                          }
                        </li>
                      }
                    </ul>
                  </div>
                }
              } @else {
                <form
                  [formGroup]="formFor(row.provider)"
                  (ngSubmit)="connect(row.provider)"
                  class="flex flex-col"
                  style="gap: 12px"
                >
                  @if (row.provider === 'POSTER') {
                    <label class="flex flex-col" style="gap: 4px">
                      <span class="form-label">{{ 'admin.integrations.poster.token' | translate }}</span>
                      <input formControlName="token" type="text" class="form-input" autocomplete="off" />
                    </label>
                    <label class="flex flex-col" style="gap: 4px">
                      <span class="form-label">{{ 'admin.integrations.poster.accountName' | translate }}</span>
                      <input formControlName="accountName" type="text" class="form-input" autocomplete="off" />
                    </label>
                    <label class="flex flex-col" style="gap: 4px">
                      <span class="form-label">{{ 'admin.integrations.poster.accountNumber' | translate }}</span>
                      <input
                        formControlName="accountNumber"
                        type="text"
                        inputmode="numeric"
                        class="form-input"
                        autocomplete="off"
                      />
                      <span style="font-family: var(--font-sans); font-size: 11px; color: var(--color-text-tertiary)">
                        {{ 'admin.integrations.poster.accountNumberHint' | translate }}
                      </span>
                    </label>
                  } @else {
                    <label class="flex flex-col" style="gap: 4px">
                      <span class="form-label">{{ 'admin.integrations.iiko.apiLogin' | translate }}</span>
                      <input formControlName="apiLogin" type="text" class="form-input" autocomplete="off" />
                    </label>
                    <label class="flex flex-col" style="gap: 4px">
                      <span class="form-label">{{ 'admin.integrations.iiko.organizationId' | translate }}</span>
                      <input formControlName="organizationId" type="text" class="form-input" autocomplete="off" />
                    </label>
                  }
                  <p
                    style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary); margin: 0"
                  >
                    {{ 'admin.integrations.connectHint' | translate }}
                  </p>
                  <div class="flex items-center" style="gap: 12px">
                    <button type="submit" [disabled]="busy() || formFor(row.provider).invalid" class="primary">
                      {{ (busy() ? 'admin.integrations.connecting' : 'admin.integrations.connect') | translate }}
                    </button>
                    @if (errorFor(row.provider); as msg) {
                      <span style="color: var(--color-berry); font-family: var(--font-sans); font-size: 13px">{{
                        msg
                      }}</span>
                    }
                  </div>
                </form>
              }
            </article>
          }
        </div>
      }
    </section>
  `,
  styles: [
    `
      .form-label {
        font-family: var(--font-sans);
        font-size: 12px;
        color: var(--color-text-secondary);
      }
      .form-input {
        height: 38px;
        padding: 0 12px;
        background: var(--color-cream);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        font-family: var(--font-mono);
        font-size: 13px;
        outline: none;
      }
      .primary {
        padding: 8px 16px;
        background: var(--color-caramel);
        color: white;
        border: 0;
        border-radius: var(--radius-button);
        font-family: var(--font-sans);
        font-weight: 600;
        cursor: pointer;
      }
      .primary:disabled {
        opacity: 0.5;
      }
      .action {
        padding: 6px 14px;
        background: transparent;
        color: var(--color-espresso);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-button);
        font-family: var(--font-sans);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }
      .action:disabled {
        opacity: 0.5;
        cursor: progress;
      }
      .action.danger {
        color: var(--color-berry);
        border-color: var(--color-berry);
      }
    `,
  ],
})
export class AdminIntegrationsPage implements OnInit, OnDestroy {
  private readonly api = inject(PosApi);
  private readonly translate = inject(TranslateService);

  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly rows = signal<ProviderRow[]>([]);
  private readonly errors = signal<Record<PosProvider, string | null>>({ POSTER: null, IIKO: null });

  private readonly forms: Record<PosProvider, FormGroup> = {
    POSTER: new FormGroup({
      token: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
      accountName: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
      accountNumber: new FormControl('', { nonNullable: true }),
    }),
    IIKO: new FormGroup({
      apiLogin: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
      organizationId: new FormControl('', { nonNullable: true }),
    }),
  };

  private pollHandle: ReturnType<typeof setInterval> | null = null;

  /** Convenience for the template — `runningSomewhere` triggers polling. */
  readonly runningSomewhere = computed(() =>
    this.rows().some((r) => r.jobs.some((j) => j.status === 'RUNNING' || j.status === 'PENDING')),
  );

  ngOnInit(): void {
    this.refresh();
  }

  ngOnDestroy(): void {
    if (this.pollHandle) clearInterval(this.pollHandle);
  }

  formFor(p: PosProvider): FormGroup {
    return this.forms[p];
  }

  errorFor(p: PosProvider): string | null {
    return this.errors()[p];
  }

  connect(provider: PosProvider): void {
    const form = this.forms[provider];
    if (form.invalid) return;
    this.busy.set(true);
    this.errors.update((e) => ({ ...e, [provider]: null }));
    const body: ConnectPosRequest = { provider, credentials: form.getRawValue() as Record<string, string> };
    this.api.connect(body).subscribe({
      next: () => {
        this.busy.set(false);
        form.reset();
        this.refresh();
      },
      error: (err) => {
        this.busy.set(false);
        this.errors.update((e) => ({ ...e, [provider]: this.extractMessage(err) }));
      },
    });
  }

  disconnect(row: ProviderRow): void {
    if (!row.integration) return;
    const ok = window.confirm(this.translate.instant('admin.integrations.confirmDisconnect'));
    if (!ok) return;
    this.busy.set(true);
    this.api.disconnect(row.provider).subscribe({
      next: () => {
        this.busy.set(false);
        this.refresh();
      },
      error: (err) => {
        this.busy.set(false);
        this.errors.update((e) => ({ ...e, [row.provider]: this.extractMessage(err) }));
      },
    });
  }

  enqueue(row: ProviderRow, kind: PosSyncJobKind): void {
    if (!row.integration) return;
    this.busy.set(true);
    const op =
      kind === 'STORES'
        ? this.api.syncStores(row.provider)
        : kind === 'MENU'
          ? this.api.syncMenu(row.provider)
          : this.api.syncStopList(row.provider);
    op.subscribe({
      next: () => {
        this.busy.set(false);
        this.refresh();
        this.startPolling();
      },
      error: (err) => {
        this.busy.set(false);
        this.errors.update((e) => ({ ...e, [row.provider]: this.extractMessage(err) }));
      },
    });
  }

  private refresh(): void {
    this.api.status().subscribe({
      next: (integrations) => {
        const map = new Map(integrations.map((i) => [i.provider, i]));
        const next: ProviderRow[] = PROVIDERS.map((p) => {
          const integration = map.get(p) ?? null;
          return {
            provider: p,
            integration,
            jobs: integration?.lastJob ? [integration.lastJob] : [],
          };
        });
        this.rows.set(next);
        this.loading.set(false);
        // After the initial summary load, fan out to per-provider jobs only
        // for the ones that are connected — we don't want to hit /jobs for
        // a provider the brand never plugged in.
        for (const row of next) {
          if (row.integration) this.refreshJobs(row.provider);
        }
        if (this.runningSomewhere()) this.startPolling();
        else this.stopPolling();
      },
      error: () => this.loading.set(false),
    });
  }

  private refreshJobs(provider: PosProvider): void {
    this.api.jobs(provider).subscribe({
      next: (list) => {
        this.rows.update((current) => current.map((r) => (r.provider === provider ? { ...r, jobs: list } : r)));
        if (this.runningSomewhere()) this.startPolling();
        else this.stopPolling();
      },
      error: () => undefined,
    });
  }

  private startPolling(): void {
    if (this.pollHandle) return;
    this.pollHandle = setInterval(() => {
      for (const row of this.rows()) {
        if (row.integration) this.refreshJobs(row.provider);
      }
    }, JOB_REFRESH_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  statusBg(s: string): string {
    if (s === 'CONNECTED') return 'rgba(76,175,80,0.15)';
    if (s === 'ERROR') return 'rgba(220,53,69,0.15)';
    return 'rgba(0,0,0,0.06)';
  }

  statusFg(s: string): string {
    if (s === 'CONNECTED') return 'var(--color-mint)';
    if (s === 'ERROR') return 'var(--color-berry)';
    return 'var(--color-text-secondary)';
  }

  jobStatusFg(s: string): string {
    if (s === 'COMPLETED') return 'var(--color-mint)';
    if (s === 'FAILED') return 'var(--color-berry)';
    if (s === 'RUNNING') return 'var(--color-caramel)';
    return 'var(--color-text-secondary)';
  }

  private extractMessage(err: unknown): string {
    const maybe = err as { error?: { message?: unknown }; message?: unknown };
    if (maybe.error?.message && typeof maybe.error.message === 'string') return maybe.error.message;
    if (Array.isArray(maybe.error?.message) && maybe.error.message.length) return maybe.error.message[0] as string;
    if (typeof maybe.message === 'string') return maybe.message;
    return this.translate.instant('common.genericError');
  }
}
