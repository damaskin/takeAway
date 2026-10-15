import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocalDatePipe } from '@takeaway/i18n';
import { BRAND_PLANS, type BrandPlan, DEFAULT_COMMISSION_BPS } from '@takeaway/shared-types';
import { BRAND_LAUNCH_RECOMMENDATIONS, BRAND_LAUNCH_STEPS, brandLaunch, formatPhone } from '@takeaway/utils';

import {
  AdminBrand,
  type BrandOnboardingProgress,
  BrandModerationStatus,
  BrandsService,
  SetBrandModerationRequest,
} from '../../core/brands/brands.service';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog.component';

/**
 * The moderation states, plus two call lists: self-registered brands that
 * have not launched yet, and owners asking for another plan.
 */
type Tab = BrandModerationStatus | 'NOT_LAUNCHED' | 'PLAN_REQUESTS';

/** A decision that needs a second look before it is sent. */
interface PendingDecision {
  brand: AdminBrand;
  /** REJECTED asks for the reason; PENDING takes a brand off the storefront or out of "rejected". */
  status: 'REJECTED' | 'PENDING';
}

@Component({
  selector: 'app-admin-brands',
  standalone: true,
  imports: [LocalDatePipe, RouterLink, TranslatePipe, ConfirmDialogComponent],
  template: `
    <section style="padding: 32px; max-width: 1100px">
      <header class="flex items-center justify-between" style="gap: 16px; margin-bottom: 24px">
        <div>
          <h1 style="font-family: var(--font-display); font-size: 28px; color: var(--color-espresso); margin: 0">
            {{ 'admin.brands.title' | translate }}
          </h1>
          <p
            style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 4px 0 0"
          >
            {{ 'admin.brands.subtitle' | translate }}
          </p>
        </div>
        <a
          routerLink="/brands/new"
          class="flex items-center"
          style="padding: 10px 18px; background: var(--color-caramel); color: white; border-radius: var(--radius-button); font-family: var(--font-sans); font-weight: 600; text-decoration: none; white-space: nowrap"
        >
          {{ 'admin.brands.create.cta' | translate }}
        </a>
      </header>

      <div class="flex flex-wrap" style="gap: 8px; margin-bottom: 16px">
        @for (t of tabs; track t) {
          <button
            type="button"
            class="tab"
            [class.tab-active]="tab() === t"
            [class.tab-calls]="t === 'NOT_LAUNCHED' || t === 'PLAN_REQUESTS'"
            (click)="setTab(t)"
            style="padding: 8px 16px; border-radius: 999px; border: 1px solid var(--color-border); font-family: var(--font-sans); font-size: 14px; cursor: pointer"
          >
            {{ 'admin.brands.tabs.' + t | translate }} · {{ counts()[t] }}
          </button>
        }
      </div>
      @if (tab() === 'NOT_LAUNCHED') {
        <p class="tab-hint">{{ 'admin.brands.notLaunchedHint' | translate }}</p>
      }

      @if (loading()) {
        <p style="font-family: var(--font-sans); color: var(--color-text-secondary)">
          {{ 'common.loading' | translate }}
        </p>
      } @else if (filtered().length === 0) {
        <p style="font-family: var(--font-sans); color: var(--color-text-secondary)">
          {{ 'admin.brands.empty' | translate }}
        </p>
      } @else {
        <div class="flex flex-col" style="gap: 12px">
          @for (b of filtered(); track b.id) {
            <article
              style="background: var(--color-foam); border-radius: var(--radius-card); padding: 20px; box-shadow: var(--shadow-soft)"
            >
              <div class="flex items-start justify-between" style="gap: 16px">
                <div>
                  <p
                    style="font-family: var(--font-display); font-size: 20px; color: var(--color-espresso); margin: 0 0 4px"
                  >
                    {{ b.name }}
                    <span
                      [attr.data-status]="b.moderationStatus"
                      class="status-pill"
                      style="margin-left: 8px; font-family: var(--font-sans); font-size: 11px; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; vertical-align: middle"
                      >{{ 'admin.brands.status.' + b.moderationStatus | translate }}</span
                    >
                  </p>
                  <p
                    style="font-family: var(--font-mono); font-size: 12px; color: var(--color-text-tertiary); margin: 0"
                  >
                    {{ b.slug }}
                  </p>
                </div>
                <div
                  style="text-align: right; font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)"
                >
                  <div>{{ 'admin.brands.submitted' | translate }}: {{ b.submittedAt | localDate: 'dateTime' }}</div>
                  @if (b.moderatedAt) {
                    <div>{{ 'admin.brands.moderated' | translate }}: {{ b.moderatedAt | localDate: 'dateTime' }}</div>
                  }
                </div>
              </div>

              <dl
                class="flex flex-wrap"
                style="gap: 24px; margin: 16px 0 0; font-family: var(--font-sans); font-size: 13px"
              >
                <div>
                  <dt style="color: var(--color-text-tertiary)">{{ 'admin.brands.owner' | translate }}</dt>
                  <dd style="margin: 2px 0 0; color: var(--color-text-primary)">
                    @if (b.owner) {
                      {{ b.owner.name || '—' }} · {{ b.owner.email || '—' }}
                    } @else {
                      —
                    }
                  </dd>
                </div>
                <div>
                  <dt style="color: var(--color-text-tertiary)">{{ 'admin.brands.phone' | translate }}</dt>
                  <dd style="margin: 2px 0 0; color: var(--color-text-primary)">
                    @if (b.contactPhone) {
                      <a class="phone-link" [href]="'tel:' + b.contactPhone">{{ phone(b.contactPhone) }}</a>
                    } @else {
                      —
                    }
                  </dd>
                </div>
                @if (b.onboarding; as o) {
                  <div>
                    <dt style="color: var(--color-text-tertiary)">{{ 'admin.brands.launch.label' | translate }}</dt>
                    <dd style="margin: 2px 0 0; color: var(--color-text-primary)">
                      <span class="launch-count" [class.launch-done]="o.complete">{{
                        'admin.brands.launch.progress' | translate: { done: o.done, total: o.total }
                      }}</span>
                      @if (o.hasOrders) {
                        <span class="launch-sold" data-testid="brand-has-orders">
                          · {{ 'admin.brands.launch.hasOrders' | translate }}</span
                        >
                      }
                      <span class="launch-steps">
                        @for (s of launchSteps; track s) {
                          <span
                            [class.launch-step-done]="stepDone(o, s)"
                            [title]="'admin.brands.launch.steps.' + s | translate"
                          >
                            {{ stepDone(o, s) ? '✓' : '·' }} {{ 'admin.brands.launch.steps.' + s | translate }}
                          </span>
                        }
                      </span>
                      <span class="launch-steps launch-optional" data-testid="brand-launch-recommended">
                        {{ 'admin.brands.launch.recommended' | translate }}
                        @for (r of launchRecommendations; track r) {
                          <span [class.launch-step-done]="o[r]">
                            {{ o[r] ? '✓' : '·' }} {{ 'admin.brands.launch.steps.' + r | translate }}
                          </span>
                        }
                      </span>
                    </dd>
                  </div>
                }
                <div>
                  <dt style="color: var(--color-text-tertiary)">{{ 'admin.brands.stores' | translate }}</dt>
                  <dd style="margin: 2px 0 0; color: var(--color-text-primary)">{{ b._count.stores }}</dd>
                </div>
                <div>
                  <dt style="color: var(--color-text-tertiary)">{{ 'admin.brands.products' | translate }}</dt>
                  <dd style="margin: 2px 0 0; color: var(--color-text-primary)">{{ b._count.products }}</dd>
                </div>
                <div>
                  <dt style="color: var(--color-text-tertiary)">{{ 'admin.brands.plan.label' | translate }}</dt>
                  <dd class="flex items-center" style="margin: 2px 0 0; gap: 8px; color: var(--color-text-primary)">
                    <span class="plan-pill" [attr.data-plan]="b.plan">{{
                      'admin.plans.names.' + b.plan | translate
                    }}</span>
                    {{ percent(b.commissionBps) }} %
                    @if (planEdit()?.id !== b.id) {
                      <button type="button" class="plan-edit" (click)="editPlan(b)">
                        {{ 'admin.brands.plan.change' | translate }}
                      </button>
                    }
                  </dd>
                </div>
              </dl>

              @if (b.requestedPlan) {
                <div class="plan-request" role="note">
                  <span>{{
                    'admin.brands.planRequest.text'
                      | translate
                        : {
                            plan: ('admin.plans.names.' + b.requestedPlan | translate),
                            date: (b.planRequestedAt | localDate: 'dateTime'),
                          }
                  }}</span>
                  @if (planEdit()?.id !== b.id) {
                    <button type="button" class="plan-edit" (click)="editPlan(b, b.requestedPlan)">
                      {{ 'admin.brands.planRequest.apply' | translate }}
                    </button>
                  }
                  <button
                    type="button"
                    class="plan-cancel"
                    [disabled]="actingOnId() === b.id"
                    (click)="dismissPlanRequest(b)"
                  >
                    {{ 'admin.brands.planRequest.dismiss' | translate }}
                  </button>
                </div>
              }

              @if (planEdit(); as edit) {
                @if (edit.id === b.id) {
                  <form class="plan-form" (submit)="$event.preventDefault(); savePlan(b)">
                    <label>
                      <span>{{ 'admin.brands.plan.label' | translate }}</span>
                      <select (change)="setDraftPlan($any($event.target).value)">
                        @for (p of planOptions; track p) {
                          <option [value]="p" [selected]="edit.plan === p">
                            {{ 'admin.plans.names.' + p | translate }} · {{ defaultPercent(p) }} %
                          </option>
                        }
                      </select>
                    </label>
                    <label>
                      <span>{{ 'admin.brands.plan.commission' | translate }}</span>
                      <input
                        type="number"
                        min="0"
                        max="50"
                        step="0.5"
                        [value]="edit.percent"
                        (input)="setDraftPercent($any($event.target).value)"
                      />
                    </label>
                    <button type="submit" class="plan-save" [disabled]="actingOnId() === b.id || !planDraftValid()">
                      {{ 'common.save' | translate }}
                    </button>
                    <button type="button" class="plan-cancel" (click)="planEdit.set(null)">
                      {{ 'common.cancel' | translate }}
                    </button>
                    <span class="plan-hint">{{ 'admin.brands.plan.hint' | translate }}</span>
                  </form>
                }
              }

              @if (b.moderationNote) {
                <p
                  style="margin: 12px 0 0; font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); background: var(--color-cream); padding: 8px 12px; border-radius: 8px"
                >
                  {{ 'admin.brands.note' | translate }}: {{ b.moderationNote }}
                </p>
              }

              @if (b.moderationStatus !== 'APPROVED' && b.moderationStatus !== 'REJECTED') {
                <div class="flex" style="gap: 8px; margin-top: 16px">
                  <button
                    type="button"
                    (click)="approve(b)"
                    [disabled]="actingOnId() === b.id"
                    class="disabled:opacity-50"
                    style="padding: 8px 16px; background: var(--color-mint); color: white; border: 0; border-radius: var(--radius-button); font-family: var(--font-sans); font-weight: 600; cursor: pointer"
                  >
                    {{ 'admin.brands.approve' | translate }}
                  </button>
                  <button
                    type="button"
                    (click)="ask(b, 'REJECTED')"
                    [disabled]="actingOnId() === b.id"
                    class="disabled:opacity-50"
                    style="padding: 8px 16px; background: var(--color-berry); color: white; border: 0; border-radius: var(--radius-button); font-family: var(--font-sans); font-weight: 600; cursor: pointer"
                  >
                    {{ 'admin.brands.reject' | translate }}
                  </button>
                </div>
              } @else {
                <div class="flex" style="gap: 8px; margin-top: 16px">
                  <button
                    type="button"
                    (click)="ask(b, 'PENDING')"
                    [disabled]="actingOnId() === b.id"
                    class="disabled:opacity-50"
                    style="padding: 8px 16px; background: var(--color-latte); color: var(--color-espresso); border: 0; border-radius: var(--radius-button); font-family: var(--font-sans); font-weight: 600; cursor: pointer"
                  >
                    {{ 'admin.brands.revert' | translate }}
                  </button>
                </div>
              }
            </article>
          }
        </div>
      }

      @if (error()) {
        <p style="margin-top: 16px; color: var(--color-berry)">{{ error() }}</p>
      }

      @if (decision(); as d) {
        @if (d.status === 'REJECTED') {
          <app-confirm-dialog
            tone="danger"
            [title]="'admin.brands.dialog.rejectTitle' | translate: { name: d.brand.name }"
            [body]="'admin.brands.dialog.rejectBody' | translate"
            [reasonLabel]="'admin.brands.dialog.reason' | translate"
            [reasonPlaceholder]="'admin.brands.dialog.reasonPlaceholder' | translate"
            [reasonRequiredText]="'admin.brands.dialog.reasonRequired' | translate"
            [confirmLabel]="'admin.brands.reject' | translate"
            [cancelLabel]="'common.cancel' | translate"
            [busy]="actingOnId() === d.brand.id"
            (confirmed)="decide(d, $event)"
            (cancelled)="decision.set(null)"
          />
        } @else {
          <app-confirm-dialog
            [title]="'admin.brands.dialog.revertTitle' | translate: { name: d.brand.name }"
            [body]="'admin.brands.dialog.revertBody' | translate"
            [warning]="d.brand.moderationStatus === 'APPROVED' ? ('admin.brands.dialog.liveWarning' | translate) : ''"
            [confirmLabel]="'admin.brands.revert' | translate"
            [cancelLabel]="'common.cancel' | translate"
            [busy]="actingOnId() === d.brand.id"
            (confirmed)="decide(d, $event)"
            (cancelled)="decision.set(null)"
          />
        }
      }
    </section>
  `,
  styles: [
    `
      .tab {
        background: var(--color-foam);
        color: var(--color-text-secondary);
      }
      .tab-active {
        background: var(--color-caramel);
        color: white;
        border-color: var(--color-caramel);
      }
      .tab-calls:not(.tab-active) {
        border-style: dashed;
      }
      .tab-hint {
        margin: -4px 0 16px;
        font-family: var(--font-sans);
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .phone-link {
        color: var(--color-caramel);
        font-weight: 600;
        white-space: nowrap;
      }
      .launch-count {
        font-weight: 600;
        color: var(--color-amber);
      }
      .launch-done {
        color: var(--color-mint);
      }
      .launch-steps {
        display: flex;
        flex-wrap: wrap;
        gap: 2px 10px;
        margin-top: 2px;
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
      .launch-step-done {
        color: var(--color-mint);
      }
      .launch-sold {
        font-size: 12px;
        font-weight: 600;
        color: var(--color-mint);
      }
      .launch-optional {
        font-style: italic;
      }
      .plan-request {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px 12px;
        margin-top: 12px;
        padding: 10px 12px;
        border-radius: 10px;
        background: var(--color-caramel-light);
        font-family: var(--font-sans);
        font-size: 13px;
        color: var(--color-text-primary);
      }
      .plan-pill {
        padding: 2px 8px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.5px;
        background: var(--color-surface-variant);
        color: var(--color-text-secondary);
      }
      .plan-pill[data-plan='PRO'] {
        background: var(--color-espresso);
        color: white;
      }
      .plan-edit,
      .plan-cancel {
        padding: 2px 8px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-button);
        background: transparent;
        font-family: var(--font-sans);
        font-size: 12px;
        color: var(--color-caramel);
        cursor: pointer;
      }
      .plan-form {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: 10px;
        margin-top: 12px;
        padding: 12px;
        border-radius: 12px;
        background: var(--color-cream);
        font-family: var(--font-sans);
        font-size: 13px;
      }
      .plan-form label {
        display: flex;
        flex-direction: column;
        gap: 4px;
        color: var(--color-text-secondary);
      }
      .plan-form select,
      .plan-form input {
        height: 34px;
        padding: 0 8px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-input);
        background: var(--color-foam);
        font-family: var(--font-sans);
        font-size: 13px;
      }
      .plan-form input {
        width: 90px;
      }
      .plan-save {
        height: 34px;
        padding: 0 14px;
        border: 0;
        border-radius: var(--radius-button);
        background: var(--color-caramel);
        color: white;
        font-weight: 600;
        cursor: pointer;
      }
      .plan-save:disabled {
        opacity: 0.5;
      }
      .plan-cancel {
        height: 34px;
        padding: 0 12px;
        color: var(--color-text-secondary);
      }
      .plan-hint {
        flex-basis: 100%;
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
      .status-pill[data-status='PENDING'] {
        background: var(--color-amber);
        color: white;
      }
      .status-pill[data-status='APPROVED'] {
        background: var(--color-mint);
        color: white;
      }
      .status-pill[data-status='REJECTED'] {
        background: var(--color-berry);
        color: white;
      }
    `,
  ],
})
export class AdminBrandsPage {
  private readonly brands = inject(BrandsService);
  private readonly translate = inject(TranslateService);

  readonly tabs: ReadonlyArray<Tab> = ['PENDING', 'APPROVED', 'REJECTED', 'NOT_LAUNCHED', 'PLAN_REQUESTS'];
  readonly tab = signal<Tab>('PENDING');
  /** The «Запуск бренда» steps, in the order the owner sees them; then what is only recommended. */
  readonly launchSteps = BRAND_LAUNCH_STEPS;
  readonly launchRecommendations = BRAND_LAUNCH_RECOMMENDATIONS;
  readonly all = signal<AdminBrand[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly actingOnId = signal<string | null>(null);
  /** The rejection or revert waiting in the dialog. */
  readonly decision = signal<PendingDecision | null>(null);
  /** The brand whose plan is being edited, with the draft. */
  readonly planEdit = signal<{ id: string; plan: BrandPlan; percent: string } | null>(null);
  readonly planOptions = BRAND_PLANS;
  readonly planDraftValid = computed(() => {
    const edit = this.planEdit();
    if (!edit) return false;
    const value = Number(edit.percent);
    return edit.percent.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= 50;
  });

  readonly counts = computed(() => {
    const c: Record<Tab, number> = { PENDING: 0, APPROVED: 0, REJECTED: 0, NOT_LAUNCHED: 0, PLAN_REQUESTS: 0 };
    for (const b of this.all()) {
      c[b.moderationStatus]++;
      if (notLaunched(b)) c.NOT_LAUNCHED++;
      if (b.requestedPlan) c.PLAN_REQUESTS++;
    }
    return c;
  });

  readonly filtered = computed(() => {
    const tab = this.tab();
    if (tab === 'NOT_LAUNCHED') return this.all().filter(notLaunched);
    if (tab === 'PLAN_REQUESTS') return this.all().filter((b) => b.requestedPlan !== null);
    return this.all().filter((b) => b.moderationStatus === tab);
  });

  constructor() {
    this.load();
  }

  setTab(t: Tab): void {
    this.tab.set(t);
  }

  percent(bps: number): string {
    return String(bps / 100);
  }

  /** «+373 69 123 456» rather than the bare E.164. */
  phone(e164: string): string {
    return formatPhone(e164);
  }

  stepDone(o: BrandOnboardingProgress, step: (typeof BRAND_LAUNCH_STEPS)[number]): boolean {
    return step === 'payments' ? true : o[step];
  }

  defaultPercent(plan: BrandPlan): number {
    return DEFAULT_COMMISSION_BPS[plan] / 100;
  }

  /** `plan`: the plan to start the form on — the one the owner asked for, when answering a request. */
  editPlan(brand: AdminBrand, plan: BrandPlan = brand.plan): void {
    this.error.set(null);
    const percent = plan === brand.plan ? this.percent(brand.commissionBps) : String(this.defaultPercent(plan));
    this.planEdit.set({ id: brand.id, plan, percent });
  }

  /** Closes the owner's plan request without changing the plan. */
  dismissPlanRequest(brand: AdminBrand): void {
    this.actingOnId.set(brand.id);
    this.error.set(null);
    this.brands.dismissPlanRequest(brand.id).subscribe({
      next: (updated) => {
        this.all.update((list) => list.map((b) => (b.id === updated.id ? { ...b, ...updated } : b)));
        this.syncBadge();
        this.actingOnId.set(null);
      },
      error: (err) => {
        this.actingOnId.set(null);
        this.error.set(this.extractMessage(err));
      },
    });
  }

  /** A new plan brings its own rate; the platform admin can still type another one. */
  setDraftPlan(value: string): void {
    const plan = BRAND_PLANS.find((p) => p === value);
    if (!plan) return;
    this.planEdit.update((edit) => (edit ? { ...edit, plan, percent: String(this.defaultPercent(plan)) } : edit));
  }

  setDraftPercent(value: string): void {
    this.planEdit.update((edit) => (edit ? { ...edit, percent: value } : edit));
  }

  savePlan(brand: AdminBrand): void {
    const edit = this.planEdit();
    if (!edit || !this.planDraftValid()) return;
    this.actingOnId.set(brand.id);
    this.error.set(null);
    this.brands
      .setPlan(brand.id, { plan: edit.plan, commissionBps: Math.round(Number(edit.percent) * 100) })
      .subscribe({
        next: (updated) => {
          this.all.update((list) => list.map((b) => (b.id === updated.id ? { ...b, ...updated } : b)));
          // Setting the plan answers the owner's request, if there was one.
          this.syncBadge();
          this.actingOnId.set(null);
          this.planEdit.set(null);
        },
        error: (err) => {
          this.actingOnId.set(null);
          this.error.set(this.extractMessage(err));
        },
      });
  }

  approve(brand: AdminBrand): void {
    this.apply(brand, { status: 'APPROVED' });
  }

  /** Rejecting needs a reason; reverting a decision needs a second look. */
  ask(brand: AdminBrand, status: PendingDecision['status']): void {
    this.error.set(null);
    this.decision.set({ brand, status });
  }

  decide(decision: PendingDecision, reason: string): void {
    const body: SetBrandModerationRequest = { status: decision.status };
    if (decision.status === 'REJECTED') body.note = reason;
    this.apply(decision.brand, body, () => this.decision.set(null));
  }

  private apply(brand: AdminBrand, body: SetBrandModerationRequest, onDone?: () => void): void {
    this.actingOnId.set(brand.id);
    this.error.set(null);
    this.brands.setModeration(brand.id, body).subscribe({
      next: (updated) => {
        this.all.update((list) => list.map((b) => (b.id === updated.id ? withModeration({ ...b, ...updated }) : b)));
        this.syncBadge();
        this.actingOnId.set(null);
        onDone?.();
      },
      error: (err) => {
        this.actingOnId.set(null);
        onDone?.();
        this.error.set(this.extractMessage(err));
      },
    });
  }

  private load(): void {
    this.loading.set(true);
    this.brands.list().subscribe({
      next: (list) => {
        this.all.set(list);
        this.syncBadge();
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(this.extractMessage(err));
      },
    });
  }

  /** The sidebar badge: brands to review and plan requests to answer. */
  private syncBadge(): void {
    const counts = this.counts();
    this.brands.setPendingCount(counts.PENDING, counts.PLAN_REQUESTS);
  }

  private extractMessage(err: unknown): string {
    const maybe = err as { error?: { message?: unknown }; message?: unknown };
    if (maybe.error?.message && typeof maybe.error.message === 'string') return maybe.error.message;
    if (Array.isArray((maybe.error as { message?: unknown })?.message)) {
      return ((maybe.error as { message: unknown[] }).message as string[]).join(', ');
    }
    if (typeof maybe.message === 'string') return maybe.message;
    return this.translate.instant('common.genericError');
  }
}

/** Signed up by an owner and not launched yet — the team's call list (the API's `?notLaunched` says the same). */
function notLaunched(b: AdminBrand): boolean {
  return b.owner !== null && b.onboarding != null && !b.onboarding.complete;
}

/**
 * A moderation decision moves the approval step; the launch is recounted by
 * the API's own rule (`brandLaunch`), so the list and `?notLaunched` agree
 * without a reload.
 */
function withModeration(b: AdminBrand): AdminBrand {
  const o = b.onboarding;
  if (!o) return b;
  const approved = b.moderationStatus === 'APPROVED';
  if (approved === o.approved) return b;
  const launch = brandLaunch({ store: o.store, menu: o.menu, approved, hasOrders: o.hasOrders ?? false });
  return { ...b, onboarding: { ...o, approved, ...launch } };
}
