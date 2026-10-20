import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';
import type { OrderItemSnapshot } from '@takeaway/shared-types';
import { readOrderItemSnapshot } from '@takeaway/utils';
import { interval } from 'rxjs';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi } from '../../core/catalog/admin-catalog.service';
import { apiErrorBody, apiErrorCode, apiErrorMessage } from '../../core/http/api-error';
import {
  KITCHEN_COLUMNS,
  KITCHEN_REJECT_REASONS,
  OVERDUE_CHIME_MS,
  type KitchenColumn,
  acceptOverdue,
  acceptPill,
  activePause,
  applyKitchenEvent,
  canReject,
  countdown,
  inColumn,
  lateMinutes,
  laterPreorders,
  nextAction,
  rejectOutcomeKey,
  removalNotice,
  shiftBanner,
  showsPickupCountdown,
  startDue,
} from '../../core/kitchen/kitchen-board';
import {
  KITCHEN_REJECT_COMMENT_MAX,
  KitchenApi,
  type KitchenAction,
  type KitchenOrder,
  type KitchenPauseRequest,
  type KitchenRejectBody,
  type KitchenRejectReason,
  type ShiftExtendMinutes,
  type StoreShift,
} from '../../core/kitchen/kitchen.api';
import { KitchenDeviceService } from '../../core/kitchen/kitchen-device.service';
import { KITCHEN_STORE_KEY, KitchenModeService, read, write } from '../../core/kitchen/kitchen-mode.service';
import { KitchenRealtimeService } from '../../core/kitchen/kitchen-realtime.service';
import { OrderAlertsService } from '../../core/kitchen/order-alerts.service';
import { AuthService } from '../../core/auth/auth.service';
import type { KitchenStore } from '../../core/kitchen/order-alerts.service';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog.component';
import { StoreScheduleStatusComponent } from '../../shared/store-schedule-status.component';
import { KitchenPauseDialogComponent } from './kitchen-pause-dialog.component';
import { KitchenShiftBannerComponent } from './kitchen-shift-banner.component';

/** How long the "order rejected" notice stays on screen. */
const TOAST_MS = 5000;

/** One line of a ticket: how many, and exactly what goes in the cup. */
type TicketLine = OrderItemSnapshot & { quantity: number };

const COLUMN_META: Record<KitchenColumn, { label: string; tint: string; text: string }> = {
  NEW: { label: 'kds.cols.new', tint: 'var(--color-caramel-light)', text: 'var(--color-caramel)' },
  PREPARING: { label: 'kds.cols.preparing', tint: '#E9A84B26', text: '#8A6720' },
  READY: { label: 'kds.cols.ready', tint: '#7BC4A433', text: '#3E8868' },
};

const ACTION_META: Record<KitchenAction, { label: string; color: string }> = {
  accept: { label: 'kds.card.actions.accept', color: 'var(--color-caramel)' },
  start: { label: 'kds.card.actions.start', color: 'var(--color-caramel)' },
  ready: { label: 'kds.card.actions.ready', color: '#3E8868' },
  pickedUp: { label: 'kds.card.actions.pickedUp', color: 'var(--color-espresso)' },
};

/**
 * The kitchen board inside the cabinet — what the standalone KDS app was:
 * three columns, one button per ticket moving it on, live over the socket
 * with a slow poll as a safety net.
 *
 * "Accept" goes through `POST /kds/orders/:id/accept`, the same call the
 * tablet made, so a card that was only held at checkout is charged there
 * and a refusal leaves the ticket where it was, with the bank's reason on it.
 *
 * A ticket nobody has accepted can instead be rejected with a reason
 * (`POST /kds/orders/:id/reject`); the API gives the money back and tells
 * the customer why.
 *
 * The kitchen policy of 2026-10-14 on the board: pre-orders whose start is
 * more than 15 minutes away wait in «Предзаказы»; at their start time a
 * chime and a notice say it is time to make them. A ticket nobody accepted
 * in time pulses and chimes every 30 seconds (the API calls it off at its
 * deadline). Late tickets say by how much.
 *
 * Since 2026-10-20 the working hours open and close the shift: the board
 * says where the store stands by its schedule, offers «Продлить» only in the
 * last hour before the closing, and «Пауза» for technical trouble. A ticket
 * the customer cancelled (or nobody accepted in time) leaves with a notice
 * and a chime instead of silently. An unaccepted card counts down only to
 * its auto-cancel; the pickup countdown starts once it is accepted.
 */
@Component({
  selector: 'app-kitchen',
  standalone: true,
  imports: [
    RouterLink,
    TranslatePipe,
    NgTemplateOutlet,
    ConfirmDialogComponent,
    KitchenShiftBannerComponent,
    KitchenPauseDialogComponent,
    StoreScheduleStatusComponent,
  ],
  template: `
    <section class="kitchen" [class.kitchen-dark]="mode.tablet()">
      <header class="kitchen-head">
        <div class="flex flex-col" style="gap: 4px">
          <h1 class="kitchen-title">{{ 'admin.kitchen.title' | translate }}</h1>
          <p class="kitchen-subtitle">{{ 'admin.kitchen.subtitle' | translate }}</p>
        </div>
        <div class="flex items-center flex-wrap" style="gap: 12px">
          @if (stores().length > 1) {
            <label class="flex items-center" style="gap: 6px">
              <span class="kitchen-caption">{{ 'admin.kitchen.store' | translate }}</span>
              <select class="kitchen-select" [value]="storeId()" (change)="pickStore($any($event.target).value)">
                @for (s of stores(); track s.id) {
                  <option [value]="s.id">{{ s.name }}</option>
                }
              </select>
            </label>
          } @else if (store(); as s) {
            <span class="kitchen-store">{{ s.name }}</span>
          }
          <span class="kitchen-queue">
            <strong>{{ orders().length }}</strong> {{ 'kds.topbar.inQueue' | translate }}
          </span>
          <span class="kitchen-clock">{{ clock() }}</span>
          @if (canMarkBusy()) {
            <button
              type="button"
              class="kitchen-tool kitchen-busy"
              [class.kitchen-busy-on]="markedBusy()"
              [attr.aria-pressed]="markedBusy()"
              [disabled]="busyToggling()"
              [title]="(markedBusy() ? 'admin.kitchen.busy.onHint' : 'admin.kitchen.busy.offHint') | translate"
              data-testid="kitchen-busy"
              (click)="toggleBusy()"
            >
              {{ (markedBusy() ? 'admin.kitchen.busy.on' : 'admin.kitchen.busy.off') | translate }}
            </button>
          }
          @if (canPause()) {
            <button
              type="button"
              class="kitchen-tool kitchen-pause"
              [class.kitchen-pause-on]="paused()"
              [attr.aria-pressed]="!!paused()"
              [disabled]="pauseBusy()"
              [title]="(paused() ? 'admin.kitchen.schedule.resume' : 'admin.kitchen.pause.hint') | translate"
              data-testid="kitchen-pause"
              (click)="paused() ? resumePause() : openPause()"
            >
              @if (paused(); as p) {
                {{ 'admin.kitchen.pause.buttonOn' | translate: { time: shiftTime(p.until) } }}
              } @else {
                {{ 'admin.kitchen.pause.button' | translate }}
              }
            </button>
          }
          <a
            class="kitchen-tool kitchen-link"
            routerLink="/stop-list"
            [queryParams]="storeId() ? { store: storeId() } : {}"
            data-testid="kitchen-stop-list"
            >{{ 'admin.kitchen.stopList' | translate }}</a
          >
          @if (mode.tablet()) {
            <button
              type="button"
              class="kitchen-tool"
              (click)="alerts.toggleSound()"
              [attr.aria-pressed]="alerts.soundOn()"
            >
              {{ alerts.soundOn() ? '🔔' : '🔕' }}
            </button>
            <button type="button" class="kitchen-tool" (click)="mode.leave()">
              {{ 'admin.kitchen.tablet.leave' | translate }}
            </button>
            <button type="button" class="kitchen-tool" (click)="signOut()">{{ 'common.signOut' | translate }}</button>
          } @else {
            <button type="button" class="kitchen-tool" (click)="mode.enter()">
              {{ 'admin.kitchen.tablet.enter' | translate }}
            </button>
          }
          <span
            class="kitchen-live"
            [class.kitchen-live-off]="!realtime.connected()"
            [title]="(realtime.connected() ? 'admin.kitchen.live' : 'admin.kitchen.offline') | translate"
          ></span>
        </div>
      </header>

      @if (error()) {
        <p class="kitchen-error" role="alert">{{ error() }}</p>
      }

      @if (storeId() && shift(); as sh) {
        <!-- The working hours open and close the shift; the kitchen extends the closing and pauses the store. -->
        <app-store-schedule-status
          [shift]="sh"
          [storeStatus]="store()?.status"
          [timezone]="store()?.timezone"
          [now]="now()"
          [canResume]="true"
          [resuming]="pauseBusy()"
          (lift)="resumePause()"
        />
        @if (banner(); as b) {
          <app-kitchen-shift-banner
            [banner]="b"
            [time]="shiftTime(b.at)"
            [busy]="extending()"
            (extend)="extend($event)"
          />
        }
        @if (shiftError()) {
          <p class="kitchen-error" role="alert">{{ shiftError() }}</p>
        }
        @if (sh.open && markedBusy()) {
          <p class="kitchen-busy-note" role="status" data-testid="kitchen-busy-note">
            {{ 'admin.kitchen.busy.note' | translate }}
          </p>
        }
      }

      @if (loaded() && stores().length === 0) {
        <p class="kitchen-empty-state">{{ 'admin.kitchen.noStores' | translate }}</p>
      } @else {
        @if (preorders().length > 0) {
          <section class="kitchen-preorders" [attr.aria-label]="'admin.kitchen.preorders.title' | translate">
            <div class="kitchen-col-head kitchen-preorders-head">
              <span>{{ 'admin.kitchen.preorders.title' | translate }}</span>
              <span class="kitchen-preorders-hint">{{ 'admin.kitchen.preorders.hint' | translate }}</span>
              <span>{{ preorders().length }}</span>
            </div>
            <div class="kitchen-preorders-cards" data-testid="kitchen-preorders">
              @for (order of preorders(); track order.id) {
                <ng-container [ngTemplateOutlet]="ticketCard" [ngTemplateOutletContext]="{ $implicit: order }" />
              }
            </div>
          </section>
        }
        <div class="kitchen-grid">
          @for (col of columns; track col) {
            <section class="kitchen-col" [attr.aria-label]="meta(col).label | translate">
              <div class="kitchen-col-head" [style.background]="meta(col).tint" [style.color]="meta(col).text">
                <span>{{ meta(col).label | translate }}</span>
                <span>{{ ordersIn(col).length }}</span>
              </div>
              <div class="kitchen-cards">
                @for (order of ordersIn(col); track order.id) {
                  <ng-container [ngTemplateOutlet]="ticketCard" [ngTemplateOutletContext]="{ $implicit: order }" />
                } @empty {
                  <p class="kitchen-empty">{{ 'kds.card.empty' | translate }}</p>
                }
              </div>
            </section>
          }
        </div>
      }
    </section>

    <ng-template #ticketCard let-order>
      <article
        class="kitchen-card"
        [class.kitchen-card-here]="order.customerArrival === 'HERE'"
        [class.kitchen-card-overdue]="overdue(order)"
        [style.border]="cardBorder(order)"
        [attr.data-testid]="'ticket-' + order.orderCode"
      >
        @if (pillOf(order); as pill) {
          <!-- Waiting for «Принять»: this is the card's only countdown, to the auto-cancel. -->
          <div
            class="kitchen-awaiting"
            [class.kitchen-overdue]="pill.overdue"
            [attr.role]="pill.overdue ? 'alert' : null"
            [attr.data-testid]="pill.overdue ? 'ticket-overdue' : 'ticket-awaiting'"
          >
            @if (order.pickupMode === 'SCHEDULED' && !pill.overdue) {
              {{ 'admin.kitchen.card.awaitingPreorder' | translate }}
            } @else {
              {{ 'admin.kitchen.card.awaiting' | translate: { minutes: waitingMinutes(order) } }}
            }
            @if (pill.countdown && order.acceptDeadlineAt) {
              · {{ 'admin.kitchen.card.autoCancelIn' | translate: { time: untilLabel(order.acceptDeadlineAt) } }}
            }
          </div>
        }
        @if (late(order) > 0) {
          <div class="kitchen-late" data-testid="ticket-late">
            {{ 'admin.kitchen.card.late' | translate: { minutes: late(order) } }}
          </div>
        }
        @if (order.customerArrival; as arrival) {
          <div
            class="kitchen-arrival"
            [class.kitchen-arrival-here]="arrival === 'HERE'"
            [attr.data-testid]="'arrival-' + arrival"
          >
            {{ (arrival === 'HERE' ? 'admin.kitchen.arrival.here' : 'admin.kitchen.arrival.nearby') | translate }}
            @if (order.customerArrivedAt) {
              <span class="kitchen-arrival-ago">{{ arrivedAgo(order.customerArrivedAt) }}</span>
            }
          </div>
        }
        <div class="flex items-center justify-between">
          <span class="kitchen-code">{{ order.orderCode }}</span>
          <div class="flex flex-col items-end" style="gap: 2px">
            @if (pickupCountdown(order)) {
              <span class="kitchen-due" data-testid="ticket-due" [style.color]="dueColor(order)">{{
                dueLabel(order)
              }}</span>
            }
            <span class="kitchen-mode">{{ 'kds.card.pickupMode.' + order.pickupMode | translate }}</span>
          </div>
        </div>
        <div class="flex items-center justify-between">
          <span class="kitchen-customer">{{ order.customerName ?? ('kds.card.customer' | translate) }}</span>
          <span class="kitchen-muted">
            @if (order.pickupMode === 'SCHEDULED' && order.startBy) {
              {{
                'admin.kitchen.preorders.dueStart'
                  | translate: { time: pickupTime(order), start: shiftTime(order.startBy) }
              }}
            } @else {
              {{ 'kds.card.due' | translate: { time: pickupTime(order) } }}
            }
          </span>
        </div>
        <ul class="kitchen-lines">
          @for (line of ticket(order); track $index) {
            <li class="flex flex-col" style="gap: 4px">
              <div class="flex items-baseline" style="gap: 8px">
                <span class="kitchen-qty">{{ line.quantity }}×</span>
                <span class="kitchen-item">{{ line.name }}</span>
              </div>
              @if (line.variations.length > 0) {
                <div class="flex flex-wrap kitchen-indent" style="gap: 6px">
                  @for (v of line.variations; track v.id) {
                    <span class="kitchen-chip">{{ v.name }}</span>
                  }
                </div>
              }
              @for (m of line.modifierLines; track m.id) {
                <span class="kitchen-indent kitchen-modifier">
                  + {{ m.name }}
                  @if (m.count > 1) {
                    <strong style="color: var(--color-caramel)">×{{ m.count }}</strong>
                  }
                </span>
              }
              @if (line.notes) {
                <div class="kitchen-indent kitchen-note">✎ {{ line.notes }}</div>
              }
            </li>
          }
        </ul>
        @if (order.notes) {
          <div class="kitchen-note">⚠ {{ order.notes }}</div>
        }
        @if (failures()[order.id]; as reason) {
          <p class="kitchen-card-error" role="alert">{{ reason }}</p>
        }
        @if (actionOf(order); as action) {
          <div class="kitchen-actions">
            @if (canReject(order)) {
              <button
                type="button"
                class="kitchen-reject"
                data-testid="reject-order"
                [disabled]="busy().has(order.id)"
                (click)="openReject(order)"
              >
                {{ 'admin.kitchen.reject.button' | translate }}
              </button>
            }
            <button
              type="button"
              class="kitchen-action"
              [style.background]="actionMeta(action).color"
              [disabled]="busy().has(order.id)"
              (click)="run(action, order)"
            >
              {{ (busy().has(order.id) ? 'admin.kitchen.working' : actionMeta(action).label) | translate }}
            </button>
          </div>
        }
      </article>
    </ng-template>

    @if (pausing()) {
      <app-kitchen-pause-dialog
        [busy]="pauseBusy()"
        [error]="pauseError()"
        (confirmed)="confirmPause($event)"
        (cancelled)="closePause()"
      />
    }

    <!-- Outside the board, so the dialog keeps the light palette in tablet mode. -->
    @if (rejecting(); as target) {
      <app-confirm-dialog
        tone="danger"
        [title]="'admin.kitchen.reject.title' | translate: { code: target.orderCode }"
        [body]="'admin.kitchen.reject.body' | translate"
        [confirmLabel]="(rejectBusy() ? 'admin.kitchen.working' : 'admin.kitchen.reject.confirm') | translate"
        [cancelLabel]="'common.cancel' | translate"
        [busy]="rejectBusy() || !rejectReason()"
        (confirmed)="confirmReject()"
        (cancelled)="closeReject()"
      >
        <fieldset class="reject-reasons" [disabled]="rejectBusy()">
          <legend class="reject-label">{{ 'admin.kitchen.reject.reasonLabel' | translate }}</legend>
          @for (reason of rejectReasons; track reason) {
            <label class="reject-reason" [class.reject-reason-on]="rejectReason() === reason">
              <input
                type="radio"
                name="kitchen-reject-reason"
                [value]="reason"
                [checked]="rejectReason() === reason"
                (change)="pickRejectReason(reason)"
              />
              <span>{{ 'admin.kitchen.reject.reasons.' + reason | translate }}</span>
            </label>
          }
        </fieldset>
        <label class="flex flex-col" style="gap: 6px">
          <span class="reject-label">
            {{
              (rejectReason() === 'OTHER'
                ? 'admin.kitchen.reject.commentLabelOther'
                : 'admin.kitchen.reject.commentLabel'
              ) | translate
            }}
          </span>
          <textarea
            #rejectBox
            rows="3"
            class="reject-comment"
            [attr.maxlength]="commentMax"
            [placeholder]="'admin.kitchen.reject.commentPlaceholder' | translate"
            [value]="rejectComment()"
            [disabled]="rejectBusy()"
            (input)="rejectComment.set(rejectBox.value)"
          ></textarea>
          <span class="reject-count">{{ rejectComment().length }}/{{ commentMax }}</span>
        </label>
        @if (rejectError()) {
          <p class="reject-error" role="alert">{{ rejectError() }}</p>
        }
      </app-confirm-dialog>
    }

    @if (toast(); as message) {
      <div class="kitchen-toast" role="status" aria-live="polite">{{ message }}</div>
    }
  `,
  styles: [
    `
      .kitchen {
        padding: clamp(16px, 3vw, 28px);
        display: flex;
        flex-direction: column;
        gap: 16px;
        font-family: var(--font-sans);
      }
      .kitchen-dark {
        --color-foam: #1c1817;
        --color-espresso: #f8f3eb;
        --color-text-primary: #f8f3eb;
        --color-text-secondary: rgba(248, 243, 235, 0.7);
        --color-text-tertiary: rgba(248, 243, 235, 0.5);
        --color-border-light: #2a2523;
        --color-border: #3a3430;
        --color-surface-variant: #2a2523;
        --color-caramel-light: #c77d3b33;
        /* Tablet mode hides the shell, so the board is the whole screen. */
        min-height: 100vh;
        min-height: 100dvh;
        background: #0e0b0a;
      }
      .kitchen-dark .kitchen-note {
        color: var(--color-amber);
      }
      .kitchen-tool {
        height: 34px;
        padding: 0 12px;
        border-radius: 10px;
        border: 1px solid var(--color-border-light);
        background: var(--color-foam);
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text-primary);
      }
      .kitchen-link {
        display: inline-flex;
        align-items: center;
        text-decoration: none;
      }
      .kitchen-busy-on {
        background: var(--color-amber);
        border-color: var(--color-amber);
        color: #3d2a05;
      }
      .kitchen-pause-on {
        background: var(--color-berry);
        border-color: var(--color-berry);
        color: white;
      }
      .kitchen-busy-note {
        margin: 0;
        font-size: 13px;
        color: #8a6720;
      }
      .kitchen-head {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;
      }
      .kitchen-title {
        font-family: var(--font-display);
        font-size: 28px;
        font-weight: 700;
        color: var(--color-espresso);
        margin: 0;
      }
      .kitchen-subtitle,
      .kitchen-muted {
        font-size: 13px;
        color: var(--color-text-secondary);
        margin: 0;
      }
      .kitchen-caption {
        font-size: 11px;
        color: var(--color-text-tertiary);
        letter-spacing: 0.5px;
        text-transform: uppercase;
      }
      .kitchen-select {
        height: 36px;
        padding: 0 10px;
        background: var(--color-foam);
        border: 1px solid var(--color-border-light);
        border-radius: 10px;
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text-primary);
        min-width: 160px;
      }
      .kitchen-store {
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text-secondary);
      }
      .kitchen-queue {
        height: 32px;
        padding: 0 12px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 9999px;
        background: var(--color-caramel);
        color: white;
        font-size: 12px;
      }
      .kitchen-clock {
        font-family: var(--font-mono);
        font-size: 15px;
        font-weight: 600;
        color: var(--color-text-secondary);
      }
      .kitchen-live {
        width: 10px;
        height: 10px;
        border-radius: 9999px;
        background: var(--color-mint);
      }
      .kitchen-live-off {
        background: var(--color-berry);
      }
      .kitchen-error,
      .kitchen-card-error {
        margin: 0;
        font-size: 13px;
        color: var(--color-berry);
      }
      .kitchen-empty-state {
        padding: 40px 0;
        text-align: center;
        color: var(--color-text-secondary);
      }
      .kitchen-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(260px, 1fr));
        gap: 16px;
        overflow-x: auto;
      }
      .kitchen-col {
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-width: 0;
      }
      .kitchen-col-head {
        height: 40px;
        padding: 0 12px;
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 1px;
        text-transform: uppercase;
      }
      .kitchen-cards {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .kitchen-card {
        background: var(--color-foam);
        border-radius: 16px;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .kitchen-code {
        font-family: var(--font-mono);
        font-size: 32px;
        font-weight: 700;
        line-height: 1;
        color: var(--color-espresso);
      }
      .kitchen-due {
        font-family: var(--font-mono);
        font-size: 18px;
        font-weight: 700;
      }
      .kitchen-mode {
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        color: var(--color-text-tertiary);
      }
      .kitchen-customer {
        font-size: 14px;
        color: var(--color-text-primary);
      }
      .kitchen-lines {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .kitchen-qty {
        min-width: 32px;
        font-family: var(--font-mono);
        font-size: 17px;
        font-weight: 700;
        color: var(--color-caramel);
      }
      .kitchen-item {
        font-size: 16px;
        font-weight: 700;
        color: var(--color-text-primary);
        line-height: 1.2;
      }
      .kitchen-indent {
        padding-left: 40px;
      }
      .kitchen-chip {
        padding: 2px 10px;
        border-radius: 9999px;
        background: var(--color-surface-variant);
        font-size: 14px;
        font-weight: 700;
        color: var(--color-text-primary);
      }
      .kitchen-modifier {
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text-secondary);
      }
      .kitchen-note {
        padding: 6px 10px;
        border-radius: 8px;
        border-left: 3px solid var(--color-amber);
        background: rgba(233, 168, 75, 0.14);
        font-size: 13px;
        font-weight: 600;
        color: #8a6720;
      }
      .kitchen-indent.kitchen-note {
        margin-left: 40px;
        padding-left: 10px;
      }
      .kitchen-action {
        height: 42px;
        border-radius: 10px;
        color: white;
        font-size: 14px;
        font-weight: 700;
      }
      .kitchen-action:disabled,
      .kitchen-reject:disabled {
        opacity: 0.6;
        cursor: progress;
      }
      .kitchen-actions {
        display: flex;
        gap: 8px;
      }
      .kitchen-actions .kitchen-action {
        flex: 1 1 auto;
      }
      .kitchen-reject {
        flex: 0 0 auto;
        height: 42px;
        padding: 0 16px;
        border-radius: 10px;
        border: 1px solid var(--color-berry);
        background: transparent;
        color: var(--color-berry);
        font-size: 14px;
        font-weight: 700;
      }
      .reject-reasons {
        margin: 0;
        padding: 0;
        border: 0;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }
      .reject-label {
        margin-bottom: 6px;
        padding: 0;
        font-size: 12px;
        font-weight: 500;
        color: var(--color-text-secondary);
      }
      .reject-reason {
        min-height: 48px;
        padding: 8px 12px;
        display: flex;
        align-items: center;
        gap: 10px;
        border-radius: 12px;
        border: 1px solid var(--color-border);
        background: var(--color-cream);
        font-size: 15px;
        font-weight: 600;
        color: var(--color-text-primary);
        cursor: pointer;
      }
      .reject-reason input {
        width: 18px;
        height: 18px;
        accent-color: var(--color-berry);
      }
      .reject-reason-on {
        border-color: var(--color-berry);
        box-shadow: 0 0 0 1px var(--color-berry);
      }
      .reject-comment {
        padding: 10px 12px;
        resize: vertical;
        background: var(--color-cream);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-input);
        font-family: var(--font-sans);
        font-size: 15px;
        outline: none;
      }
      .reject-count {
        align-self: flex-end;
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
      .reject-error {
        margin: 0;
        font-size: 13px;
        color: var(--color-berry);
      }
      .kitchen-toast {
        position: fixed;
        left: 50%;
        bottom: 24px;
        transform: translateX(-50%);
        z-index: 45;
        width: max-content;
        max-width: calc(100vw - 32px);
        padding: 14px 20px;
        border-radius: 12px;
        background: #1c1817;
        color: #f8f3eb;
        font-family: var(--font-sans);
        font-size: 15px;
        font-weight: 600;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.25);
      }
      .kitchen-tool:disabled {
        opacity: 0.6;
        cursor: progress;
      }
      .kitchen-arrival {
        align-self: flex-start;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 4px 12px;
        border-radius: 9999px;
        background: rgba(233, 168, 75, 0.18);
        color: #8a6720;
        font-size: 13px;
        font-weight: 700;
      }
      .kitchen-arrival-here {
        background: #3e8868;
        color: white;
        font-size: 15px;
      }
      .kitchen-arrival-ago {
        font-weight: 500;
        opacity: 0.85;
      }
      .kitchen-card-here {
        box-shadow: 0 0 0 3px rgba(62, 136, 104, 0.35);
      }
      .kitchen-empty {
        padding: 32px 0;
        text-align: center;
        font-size: 13px;
        color: var(--color-text-tertiary);
        margin: 0;
      }
      .kitchen-preorders {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .kitchen-preorders-head {
        gap: 12px;
        background: var(--color-surface-variant);
        color: var(--color-text-secondary);
      }
      .kitchen-preorders-hint {
        flex: 1 1 auto;
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 0;
        text-transform: none;
      }
      .kitchen-preorders-cards {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        gap: 12px;
      }
      .kitchen-awaiting,
      .kitchen-late {
        align-self: flex-start;
        padding: 4px 12px;
        border-radius: 9999px;
        font-size: 13px;
        font-weight: 700;
        color: #8a6720;
        background: rgba(233, 168, 75, 0.22);
      }
      .kitchen-awaiting.kitchen-overdue {
        color: white;
        background: var(--color-berry);
      }
      .kitchen-late {
        color: white;
        background: #8a6720;
      }
      .kitchen-card-overdue {
        animation: kitchen-pulse 1.4s ease-in-out infinite;
      }
      @keyframes kitchen-pulse {
        0%,
        100% {
          box-shadow: 0 0 0 0 rgba(217, 75, 94, 0.55);
        }
        50% {
          box-shadow: 0 0 0 8px rgba(217, 75, 94, 0);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .kitchen-card-overdue {
          animation: none;
          box-shadow: 0 0 0 3px rgba(217, 75, 94, 0.45);
        }
      }
    `,
  ],
})
export class KitchenPage {
  private readonly api = inject(KitchenApi);
  private readonly catalog = inject(AdminCatalogApi);
  private readonly activeBrand = inject(ActiveBrandService);
  private readonly translate = inject(TranslateService);
  private readonly fmt = inject(LocaleFormatService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly realtime = inject(KitchenRealtimeService);
  readonly mode = inject(KitchenModeService);
  readonly alerts = inject(OrderAlertsService);
  private readonly auth = inject(AuthService);
  private readonly device = inject(KitchenDeviceService);

  readonly columns = KITCHEN_COLUMNS;
  readonly stores = signal<KitchenStore[]>([]);
  readonly storeId = signal<string | null>(null);
  readonly orders = signal<KitchenOrder[]>([]);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);
  readonly busy = signal<ReadonlySet<string>>(new Set());
  /** Why the last action on a ticket failed — a declined card, most often. */
  readonly failures = signal<Readonly<Record<string, string>>>({});
  readonly now = signal(Date.now());
  /** The store's shift; null until read. Closed means it takes no orders. */
  readonly shift = signal<StoreShift | null>(null);
  readonly shiftError = signal<string | null>(null);
  /** «Загружены»: the kitchen marked the store busy — customers see it, orders still come. */
  readonly markedBusy = computed(() => !!this.shift()?.busy);
  /** The switch shows while a shift is open in a store that is not switched off. */
  readonly canMarkBusy = computed(
    () => !!this.shift()?.open && this.shift()?.busy !== undefined && this.store()?.status !== 'CLOSED',
  );
  readonly busyToggling = signal(false);
  readonly extending = signal(false);
  /** The closing banner: the end of the hours (or the extension) is near. */
  readonly banner = computed(() => shiftBanner(this.shift(), this.now()));
  /** The kitchen's «Пауза» while it runs. */
  readonly paused = computed(() => activePause(this.shift(), this.now()));
  /** «Пауза» shows once the shift is read, in a store that is not switched off. */
  readonly canPause = computed(() => !!this.shift() && this.store()?.status !== 'CLOSED');
  /** The pause dialog is open. */
  readonly pausing = signal(false);
  readonly pauseBusy = signal(false);
  readonly pauseError = signal<string | null>(null);
  /** «Предзаказы»: pre-orders whose start is more than 15 minutes away. */
  readonly preorders = computed(() => laterPreorders(this.orders(), this.now()));

  /** Pre-orders whose start reminder already went off on this screen. */
  private reminded = new Set<string>();
  private lastOverdueChime = 0;
  /** The closing banner chimes once per closing time. */
  private chimedBanner: string | null = null;

  readonly rejectReasons = KITCHEN_REJECT_REASONS;
  readonly commentMax = KITCHEN_REJECT_COMMENT_MAX;
  /** The ticket the "reject" dialog is open for; null when it is closed. */
  readonly rejecting = signal<KitchenOrder | null>(null);
  /** Nothing is picked up front, so a stray tap cannot reject with a wrong reason. */
  readonly rejectReason = signal<KitchenRejectReason | null>(null);
  readonly rejectComment = signal('');
  readonly rejectBusy = signal(false);
  readonly rejectError = signal<string | null>(null);
  /** A short notice at the bottom of the screen, e.g. "order rejected". */
  readonly toast = signal<string | null>(null);
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  readonly store = computed(() => this.stores().find((s) => s.id === this.storeId()) ?? null);
  readonly clock = computed(() => this.fmt.time(this.now(), this.store()?.timezone));

  /** Read once per board change rather than on every one-second tick. */
  private readonly tickets = computed(
    () =>
      new Map(
        this.orders().map((o) => [
          o.id,
          o.items.map<TicketLine>((i) => ({ ...readOrderItemSnapshot(i.productSnapshot), quantity: i.quantity })),
        ]),
      ),
  );

  private detach: (() => void) | null = null;

  constructor() {
    interval(1000)
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        this.now.set(Date.now());
        this.remind();
      });
    interval(30_000)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.refresh());

    // The stores follow the brand picked in the header.
    effect(() => {
      const brandId = this.activeBrand.activeId();
      if (!brandId) return;
      untracked(() => this.loadStores(brandId));
    });
    // Board and socket room follow the store.
    effect(() => {
      const storeId = this.storeId();
      untracked(() => this.follow(storeId));
    });
    this.destroyRef.onDestroy(() => {
      this.detach?.();
      if (this.toastTimer) clearTimeout(this.toastTimer);
    });
  }

  /** A tablet signs out back to the PIN screen, not the email form. */
  signOut(): void {
    this.auth.logout().subscribe({
      complete: () => {
        this.realtime.disconnect();
        this.activeBrand.reset();
        void this.router.navigate(['/login/pin']);
      },
    });
  }

  pickStore(id: string): void {
    if (!this.stores().some((s) => s.id === id)) return;
    write(KITCHEN_STORE_KEY, id);
    this.storeId.set(id);
    void this.router.navigate([], { relativeTo: this.route, queryParams: { store: id }, replaceUrl: true });
  }

  ordersIn(column: KitchenColumn): KitchenOrder[] {
    const now = this.now();
    return this.orders().filter((o) => inColumn(o, column, now));
  }

  /** Nobody accepted it in time: it pulses and chimes. */
  overdue(order: KitchenOrder): boolean {
    return acceptOverdue(order, this.now());
  }

  /** The acceptance pill of a card nobody has accepted yet. */
  pillOf(order: KitchenOrder) {
    return acceptPill(order, this.now());
  }

  /** The countdown to the pickup, once the order is accepted. */
  pickupCountdown(order: KitchenOrder): boolean {
    return showsPickupCountdown(order);
  }

  late(order: KitchenOrder): number {
    return lateMinutes(order, this.now());
  }

  /** Minutes since the order reached the board. */
  waitingMinutes(order: KitchenOrder): number {
    const since = order.awaitingSince ?? order.createdAt;
    return Math.max(0, Math.floor((this.now() - Date.parse(since)) / 60_000));
  }

  /** "2:14" until a moment, "0:00" once it passed. */
  untilLabel(iso: string): string {
    return countdown(Math.max(0, Date.parse(iso) - this.now()));
  }

  ticket(order: KitchenOrder): TicketLine[] {
    return this.tickets().get(order.id) ?? [];
  }

  meta(column: KitchenColumn) {
    return COLUMN_META[column];
  }

  actionOf(order: KitchenOrder): KitchenAction | null {
    return nextAction(order);
  }

  actionMeta(action: KitchenAction) {
    return ACTION_META[action];
  }

  canReject(order: KitchenOrder): boolean {
    return canReject(order);
  }

  run(action: KitchenAction, order: KitchenOrder): void {
    const storeId = this.storeId();
    if (!storeId || this.busy().has(order.id)) return;
    this.setBusy(order.id, true);
    this.clearFailure(order.id);
    const done = () => this.setBusy(order.id, false);
    this.api.run(action, storeId, order.id).subscribe({
      next: () => {
        done();
        this.refresh();
      },
      error: (err) => {
        done();
        if (apiErrorCode(err) === 'CARD_DECLINED') {
          // The API called the order off — its ticket is leaving the board, so say it in a toast.
          this.orders.update((list) => list.filter((o) => o.id !== order.id));
          this.alerts.dismiss(order.id);
          this.showToast(this.translate.instant('admin.kitchen.errors.cardDeclined'));
          this.refresh();
          return;
        }
        this.failures.update((map) => ({
          ...map,
          [order.id]: apiErrorMessage(err, this.translate, {
            network: 'common.networkError',
            statuses: { 403: 'common.forbidden', 404: 'admin.kitchen.errors.gone' },
          }),
        }));
        this.refresh();
      },
    });
  }

  /** Opens the "reject" dialog for a ticket nobody has accepted yet. */
  openReject(order: KitchenOrder): void {
    if (!canReject(order) || this.busy().has(order.id)) return;
    this.rejectReason.set(null);
    this.rejectComment.set('');
    this.rejectError.set(null);
    this.rejecting.set(order);
  }

  pickRejectReason(reason: KitchenRejectReason): void {
    this.rejectReason.set(reason);
    this.rejectError.set(null);
  }

  /** Cancel, Escape or the backdrop; ignored while the request is in flight. */
  closeReject(): void {
    if (this.rejectBusy()) return;
    this.rejecting.set(null);
  }

  /**
   * Turns the order down. The API gives the money back and tells the
   * customer; the board drops the ticket right away instead of waiting for
   * the realtime "removed" event.
   */
  confirmReject(): void {
    const order = this.rejecting();
    const storeId = this.storeId();
    const reason = this.rejectReason();
    if (!order || !storeId || !reason || this.rejectBusy()) return;
    const comment = this.rejectComment().trim().slice(0, KITCHEN_REJECT_COMMENT_MAX);
    const body: KitchenRejectBody = comment ? { reason, comment } : { reason };
    this.rejectBusy.set(true);
    this.rejectError.set(null);
    this.setBusy(order.id, true);
    this.clearFailure(order.id);
    this.api.reject(storeId, order.id, body).subscribe({
      next: (result) => {
        this.rejectBusy.set(false);
        this.setBusy(order.id, false);
        this.rejecting.set(null);
        this.orders.update((list) => list.filter((o) => o.id !== order.id));
        this.alerts.dismiss(order.id);
        this.showToast(this.translate.instant(rejectOutcomeKey(result.money)));
      },
      error: (err) => {
        this.rejectBusy.set(false);
        this.setBusy(order.id, false);
        this.rejectError.set(
          apiErrorMessage(err, this.translate, {
            network: 'common.networkError',
            statuses: { 403: 'common.forbidden', 404: 'admin.kitchen.errors.gone' },
          }),
        );
        this.refresh();
      },
    });
  }

  openPause(): void {
    if (!this.canPause() || this.pauseBusy()) return;
    this.pauseError.set(null);
    this.pausing.set(true);
  }

  /** Cancel, Escape or the backdrop; ignored while the request is in flight. */
  closePause(): void {
    if (this.pauseBusy()) return;
    this.pausing.set(false);
  }

  /** «Пауза»: the store takes no orders for now and no pre-orders until it ends. */
  confirmPause(body: KitchenPauseRequest): void {
    const storeId = this.storeId();
    if (!storeId || this.pauseBusy()) return;
    this.pauseBusy.set(true);
    this.pauseError.set(null);
    this.api.pause(storeId, body).subscribe({
      next: (shift) => {
        this.pauseBusy.set(false);
        this.pausing.set(false);
        if (this.storeId() !== storeId) return;
        this.shift.set(shift);
        if (shift.pausedUntil) {
          this.showToast(
            this.translate.instant('admin.kitchen.pause.done', { time: this.shiftTime(shift.pausedUntil) }),
          );
        }
      },
      error: (err) => {
        this.pauseBusy.set(false);
        this.pauseError.set(
          apiErrorMessage(err, this.translate, {
            network: 'common.networkError',
            codes: {
              STORE_SWITCHED_OFF: 'admin.kitchen.pause.errors.STORE_SWITCHED_OFF',
              PAUSE_NEEDS_DURATION: 'admin.kitchen.pause.errors.PAUSE_NEEDS_DURATION',
            },
            statuses: { 403: 'common.forbidden' },
          }),
        );
      },
    });
  }

  /** «Снять паузу». */
  resumePause(): void {
    const storeId = this.storeId();
    if (!storeId || this.pauseBusy()) return;
    this.pauseBusy.set(true);
    this.shiftError.set(null);
    this.api.resume(storeId).subscribe({
      next: (shift) => {
        this.pauseBusy.set(false);
        if (this.storeId() !== storeId) return;
        this.shift.set(shift);
        this.showToast(this.translate.instant('admin.kitchen.pause.resumed'));
      },
      error: (err) => {
        this.pauseBusy.set(false);
        this.shiftError.set(
          apiErrorMessage(err, this.translate, {
            network: 'common.networkError',
            statuses: { 403: 'common.forbidden' },
          }),
        );
      },
    });
  }

  /** «Продлить на 30 мин / 1 ч»: ASAP orders keep coming past the working hours. */
  extend(minutes: ShiftExtendMinutes): void {
    const storeId = this.storeId();
    if (!storeId || this.extending()) return;
    this.extending.set(true);
    this.shiftError.set(null);
    this.api.extendShift(storeId, minutes).subscribe({
      next: (shift) => {
        this.extending.set(false);
        if (this.storeId() === storeId) this.shift.set(shift);
      },
      error: (err) => {
        this.extending.set(false);
        const limit = apiErrorBody(err)?.['reason'] === 'LIMIT';
        this.shiftError.set(
          apiErrorMessage(err, this.translate, {
            network: 'common.networkError',
            codes: {
              SHIFT_EXTENSION_NOT_ALLOWED: limit
                ? 'admin.kitchen.shift.extendLimit'
                : 'admin.kitchen.shift.extendNotAllowed',
            },
            statuses: { 403: 'common.forbidden' },
          }),
        );
        this.refresh();
      },
    });
  }

  /**
   * Once a second: a ticket nobody accepted in time chimes every 30 seconds,
   * a pre-order whose start came gets its notice once, and the closing
   * banner chimes when it appears.
   */
  private remind(): void {
    const now = this.now();
    const store = this.store();
    const orders = this.orders();

    if (orders.some((o) => acceptOverdue(o, now)) && now - this.lastOverdueChime >= OVERDUE_CHIME_MS) {
      this.lastOverdueChime = now;
      this.alerts.remind();
    }

    const due = orders.filter((o) => startDue(o, now) && !this.reminded.has(o.id));
    const first = due[0];
    if (first) {
      for (const o of due) this.reminded.add(o.id);
      const text =
        due.length === 1
          ? this.translate.instant('admin.kitchen.reminders.start', {
              code: first.orderCode,
              time: this.pickupTime(first),
            })
          : this.translate.instant('admin.kitchen.reminders.startMany', {
              codes: due.map((o) => `#${o.orderCode}`).join(', '),
            });
      this.showToast(text);
      this.alerts.remind({ title: text, body: store?.name ?? '', tag: `start-${first.id}` });
    }

    const banner = this.banner();
    if (banner?.kind === 'closingSoon' && this.chimedBanner !== banner.at) {
      this.chimedBanner = banner.at;
      this.alerts.remind();
    }
  }

  /** «Загружены» on or off for the store on the board. */
  toggleBusy(): void {
    const storeId = this.storeId();
    if (!storeId || this.busyToggling()) return;
    const busy = !this.markedBusy();
    this.busyToggling.set(true);
    this.shiftError.set(null);
    this.api.setBusy(storeId, busy).subscribe({
      next: (shift) => {
        this.busyToggling.set(false);
        if (this.storeId() !== storeId) return;
        this.shift.set(shift);
        const status = shift.busy ? 'OVERLOADED' : 'OPEN';
        this.stores.update((list) => list.map((s) => (s.id === storeId ? { ...s, status } : s)));
      },
      error: (err) => {
        this.busyToggling.set(false);
        this.shiftError.set(
          apiErrorMessage(err, this.translate, {
            network: 'common.networkError',
            codes: { STORE_SWITCHED_OFF: 'admin.kitchen.shift.storeClosed' },
            statuses: { 403: 'common.forbidden' },
          }),
        );
      },
    });
  }

  shiftTime(iso: string | null): string {
    return iso ? this.fmt.time(iso, this.store()?.timezone) : '';
  }

  /** Minutes since the customer arrived: "3 min". */
  arrivedAgo(iso: string): string {
    const minutes = Math.max(0, Math.floor((this.now() - new Date(iso).getTime()) / 60_000));
    return this.translate.instant('admin.kitchen.arrival.ago', { minutes });
  }

  dueLabel(order: KitchenOrder): string {
    return countdown(new Date(order.pickupAt).getTime() - this.now());
  }

  pickupTime(order: KitchenOrder): string {
    return this.fmt.time(order.pickupAt, this.store()?.timezone);
  }

  dueColor(order: KitchenOrder): string {
    const diff = (new Date(order.pickupAt).getTime() - this.now()) / 1000;
    if (order.status === 'READY') return '#3E8868';
    if (diff < 0) return 'var(--color-berry)';
    if (diff < 120) return '#8A6720';
    return 'var(--color-text-primary)';
  }

  cardBorder(order: KitchenOrder): string {
    const diff = (new Date(order.pickupAt).getTime() - this.now()) / 1000;
    if (order.customerArrival === 'HERE') return '2px solid #3E8868';
    if (order.status === 'READY') return '1px solid var(--color-mint)';
    if (diff < 0) return '2px solid var(--color-berry)';
    if (diff < 120) return '1px solid var(--color-amber)';
    return '1px solid var(--color-border-light)';
  }

  private setBusy(orderId: string, on: boolean): void {
    this.busy.update((set) => {
      const next = new Set(set);
      if (on) next.add(orderId);
      else next.delete(orderId);
      return next;
    });
  }

  private clearFailure(orderId: string): void {
    if (!(orderId in this.failures())) return;
    this.failures.update((map) => {
      const next = { ...map };
      delete next[orderId];
      return next;
    });
  }

  private showToast(message: string): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toast.set(message);
    this.toastTimer = setTimeout(() => {
      this.toastTimer = null;
      this.toast.set(null);
    }, TOAST_MS);
  }

  private loadStores(brandId: string): void {
    this.catalog.listStores(brandId).subscribe({
      next: (rows) => {
        const stores = rows.map((s) => ({ id: s.id, name: s.name, timezone: s.timezone ?? null, status: s.status }));
        this.stores.set(stores);
        this.loaded.set(true);
        this.error.set(null);
        const wanted = [this.route.snapshot.queryParamMap.get('store'), this.storeId(), read(KITCHEN_STORE_KEY)];
        const start = wanted.map((id) => stores.find((s) => s.id === id)).find(Boolean) ?? stores[0] ?? null;
        this.storeId.set(start?.id ?? null);
      },
      error: (err) => {
        this.loaded.set(true);
        this.error.set(apiErrorMessage(err, this.translate, { network: 'common.networkError' }));
      },
    });
  }

  private follow(storeId: string | null): void {
    this.detach?.();
    this.detach = null;
    this.orders.set([]);
    this.failures.set({});
    this.rejecting.set(null);
    this.shift.set(null);
    this.shiftError.set(null);
    this.pausing.set(false);
    this.reminded = new Set();
    this.lastOverdueChime = 0;
    this.chimedBanner = null;
    if (!storeId) return;
    // Whoever opens the board on this browser binds it to the store's brand
    // as a kitchen tablet (once), so its PIN screen lists only that brand's
    // stores — also how tablets signed in before binding existed get bound.
    this.device.ensureBound(storeId);
    this.refresh();
    this.detach = this.realtime.watch(
      storeId,
      (event) => {
        // The customer cancelled it, or nobody accepted it in time: say so
        // with a chime rather than let the ticket just vanish.
        const notice = removalNotice(this.orders(), event);
        const next = applyKitchenEvent(this.orders(), event);
        if (next) this.orders.set(next);
        else this.refresh();
        if (notice) {
          this.alerts.dismiss(event.orderId);
          this.showToast(this.translate.instant(`admin.kitchen.removed.${notice.reason}`, { code: notice.code }));
          this.alerts.remind();
        }
      },
      (event) => this.shift.set(event.shift),
    );
  }

  private refresh(): void {
    const storeId = this.storeId();
    if (!storeId) return;
    this.api.shift(storeId).subscribe({
      next: (shift) => {
        if (this.storeId() === storeId) this.shift.set(shift);
      },
      // The board still works without it; the next refresh tries again.
      error: () => undefined,
    });
    this.api.list(storeId).subscribe({
      next: (list) => {
        if (this.storeId() !== storeId) return;
        this.orders.set(list);
        this.error.set(null);
      },
      error: (err) => this.error.set(apiErrorMessage(err, this.translate, { network: 'common.networkError' })),
    });
  }
}
