import { Component, computed, inject, input, output } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';
import { calendarDaysFrom } from '@takeaway/utils';

import { activePause, asapNote, scheduleStatus } from '../core/kitchen/kitchen-board';
import type { StoreShift } from '../core/kitchen/kitchen.api';

/**
 * Where a store stands by its schedule — «Работаем по графику до 21:00»,
 * «Продлено до 21:30», «По графику закрыто · откроется завтра в 09:00 ·
 * предзаказы приходят» — and the kitchen's pause with «Снять паузу». Since
 * 2026-10-20 nobody starts or finishes a shift: the working hours do.
 *
 * Shown over the kitchen board, on the «Точки» cards and on the dashboard,
 * from `GET /kds/shift`. Times are on the store's clock.
 */
@Component({
  selector: 'app-store-schedule-status',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    @if (status(); as st) {
      <div class="sched" [attr.data-kind]="st.kind" role="status" data-testid="schedule-status">
        <span class="sched-dot" aria-hidden="true"></span>
        <span class="sched-text">{{ mainText() }}</span>
      </div>
      @if (note(); as n) {
        <p class="sched-note" data-testid="schedule-note">{{ 'admin.kitchen.schedule.' + n | translate }}</p>
      }
    }
    @if (pause(); as p) {
      <div class="sched-pause" role="status" data-testid="schedule-pause">
        <span class="sched-text">{{ pauseText() }}</span>
        @if (canResume()) {
          <button
            type="button"
            class="sched-resume"
            [disabled]="resuming()"
            data-testid="pause-resume"
            (click)="lift.emit()"
          >
            {{ 'admin.kitchen.schedule.resume' | translate }}
          </button>
        }
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-family: var(--font-sans);
      }
      .sched,
      .sched-pause {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px 12px;
        padding: 10px 12px;
        border-radius: 12px;
        background: rgba(123, 196, 164, 0.16);
      }
      .sched[data-kind='opening'] {
        background: rgba(233, 168, 75, 0.18);
      }
      .sched[data-kind='closed'] {
        background: var(--color-surface-variant, #f1ece4);
      }
      .sched[data-kind='switchedOff'] {
        background: rgba(217, 75, 94, 0.12);
      }
      .sched-dot {
        flex: none;
        width: 10px;
        height: 10px;
        border-radius: 9999px;
        background: var(--color-mint);
      }
      .sched[data-kind='opening'] .sched-dot {
        background: var(--color-amber);
      }
      .sched[data-kind='closed'] .sched-dot {
        background: var(--color-text-tertiary);
      }
      .sched[data-kind='switchedOff'] .sched-dot {
        background: var(--color-berry);
      }
      .sched-text {
        flex: 1 1 200px;
        min-width: 0;
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text-primary);
      }
      .sched-note {
        margin: 0;
        font-size: 13px;
        color: #8a6720;
      }
      .sched-pause {
        border: 1px solid var(--color-berry);
        background: rgba(217, 75, 94, 0.12);
      }
      .sched-resume {
        height: 36px;
        padding: 0 14px;
        border-radius: 10px;
        border: 1px solid var(--color-berry);
        background: var(--color-foam);
        color: var(--color-berry);
        font-size: 13px;
        font-weight: 700;
      }
      .sched-resume:disabled {
        opacity: 0.6;
        cursor: progress;
      }
    `,
  ],
})
export class StoreScheduleStatusComponent {
  private readonly translate = inject(TranslateService);
  private readonly fmt = inject(LocaleFormatService);

  readonly shift = input<StoreShift | null>(null);
  /** The store's own switch: CLOSED reads as switched off whatever the shift says. */
  readonly storeStatus = input<string | undefined>(undefined);
  readonly timezone = input<string | null | undefined>(null);
  /** The clock to read the times against; the caller ticks it. */
  readonly now = input<number>(Date.now());
  /** «Снять паузу» is offered (the kitchen board; the cards only show the pause). */
  readonly canResume = input(false);
  readonly resuming = input(false);
  readonly lift = output<void>();

  readonly status = computed(() => scheduleStatus(this.shift(), this.storeStatus(), this.now()));
  readonly pause = computed(() => (this.storeStatus() === 'CLOSED' ? null : activePause(this.shift(), this.now())));
  readonly note = computed(() => {
    const kind = this.status()?.kind;
    if (this.pause() || (kind !== 'open' && kind !== 'extended' && kind !== 'aroundTheClock')) return null;
    return asapNote(this.shift());
  });

  readonly mainText = computed(() => {
    const st = this.status();
    if (!st) return '';
    const key = 'admin.kitchen.schedule.';
    switch (st.kind) {
      case 'open':
        return this.translate.instant(key + 'open', { time: this.time(st.until) });
      case 'extended':
        return this.translate.instant(key + 'extended', { time: this.time(st.until) });
      case 'closed': {
        if (!st.opensAt) return this.translate.instant(key + 'closed');
        const days = calendarDaysFrom(st.opensAt, new Date(this.now()), this.timezone());
        const which = days <= 0 ? 'opensAt' : days === 1 ? 'opensTomorrowAt' : 'opensOnAt';
        return this.translate.instant(key + which, {
          time: this.time(st.opensAt),
          date: this.fmt.dayMonth(st.opensAt, this.timezone()),
        });
      }
      default:
        return this.translate.instant(key + st.kind);
    }
  });

  readonly pauseText = computed(() => {
    const p = this.pause();
    if (!p) return '';
    const parts = [this.translate.instant('admin.kitchen.schedule.pausedUntil', { time: this.time(p.until) })];
    if (p.reason) {
      const reason = this.translate.instant(`admin.kitchen.pause.reasons.${p.reason}`);
      parts.push(p.comment ? `${reason} — ${p.comment}` : reason);
    } else if (p.comment) {
      parts.push(p.comment);
    }
    const text = parts.join(' · ');
    return p.byName ? `${text} ${this.translate.instant('admin.kitchen.schedule.pausedBy', { name: p.byName })}` : text;
  });

  private time(iso: string): string {
    return this.fmt.time(iso, this.timezone());
  }
}
