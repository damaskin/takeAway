import type { TranslateService } from '@ngx-translate/core';
import { calendarDaysFrom, storeHoursNote } from '@takeaway/utils';

import type { LocaleFormatService } from './locale-format';

/** The store fields the hours lines read — any StoreListItem or StoreDetail. */
export interface StoreHoursInput {
  status: string;
  acceptingOrders?: boolean;
  openNow?: boolean;
  asapBlockedReason?: string | null;
  opensAt?: string | null;
  closesAt?: string | null;
  pausedUntil?: string | null;
  timezone?: string | null;
}

/**
 * The line beside a store's name — «Сейчас закрыто · откроется завтра в
 * 9:00 · можно заказать ко времени», «Большая очередь — только ко времени»,
 * «до 21:00» — on the store's own clock. Null when there is nothing to add:
 * see `storeHoursNote`.
 */
export function storeHoursText(
  store: StoreHoursInput,
  translate: TranslateService,
  fmt: LocaleFormatService,
  now: Date = new Date(),
): string | null {
  const note = storeHoursNote(store, now);
  if (!note) return null;
  const zone = store.timezone;
  switch (note.kind) {
    case 'until':
      return translate.instant('common.storeHours.until', { time: fmt.time(note.at, zone) });
    case 'queueFull':
      return translate.instant('common.storeHours.queueFull');
    case 'paused':
      return translate.instant('common.storeHours.paused', { time: fmt.time(note.until, zone) });
    case 'closingSoon':
      return translate.instant('common.storeHours.closingSoon');
    case 'preorder':
      return translate.instant('common.storeHours.closedPreorder');
    case 'opens':
      return translate.instant(opensKey('common.storeHours', note.days), {
        time: fmt.time(note.at, zone),
        date: fmt.dayMonth(note.at, zone),
      });
  }
}

/**
 * Why «Сейчас» is off at checkout, with what to do instead: «Точка откроется
 * завтра в 9:00 — выберите, к какому времени приготовить заказ». Null while
 * the store takes an order for now, or when the API gave no reason (the
 * caller keeps its general "closed now" line).
 */
export function asapBlockedText(
  store: StoreHoursInput,
  translate: TranslateService,
  fmt: LocaleFormatService,
  now: Date = new Date(),
): string | null {
  if (store.openNow !== false) return null;
  const zone = store.timezone;
  switch (store.asapBlockedReason) {
    case 'QUEUE_FULL':
      return translate.instant('common.asapBlocked.queueFull');
    case 'SHIFT_CLOSED':
      return translate.instant('common.asapBlocked.shiftClosed');
    case 'PAUSED':
      return store.pausedUntil
        ? translate.instant('common.asapBlocked.pausedUntil', { time: fmt.time(store.pausedUntil, zone) })
        : translate.instant('common.asapBlocked.paused');
    case 'CLOSING_SOON':
      return store.closesAt
        ? translate.instant('common.asapBlocked.closingSoonAt', { time: fmt.time(store.closesAt, zone) })
        : translate.instant('common.asapBlocked.closingSoon');
    case 'OUTSIDE_HOURS':
      if (!store.opensAt) return null;
      return translate.instant(opensKey('common.asapBlocked', calendarDaysFrom(store.opensAt, now, zone)), {
        time: fmt.time(store.opensAt, zone),
        date: fmt.dayMonth(store.opensAt, zone),
      });
    default:
      return null;
  }
}

/** «Сегодня», «Завтра», then the date — the heading over a day of pickup windows. */
export function pickupDayLabel(
  days: number,
  firstSlotAt: string,
  translate: TranslateService,
  fmt: LocaleFormatService,
  timeZone?: string | null,
): string {
  if (days <= 0) return translate.instant('common.pickupDay.today');
  if (days === 1) return translate.instant('common.pickupDay.tomorrow');
  return fmt.dayMonth(firstSlotAt, timeZone);
}

function opensKey(group: string, days: number): string {
  if (days <= 0) return `${group}.opensAt`;
  return days === 1 ? `${group}.opensTomorrowAt` : `${group}.opensOnAt`;
}
