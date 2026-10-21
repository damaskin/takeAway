import { ConflictException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, StorePauseReason, StoreStatus } from '@prisma/client';
import {
  type KitchenPauseMinutes,
  type KitchenShiftState,
  SHIFT_EXTEND_MINUTES,
  type ShiftExtendMinutes,
  type ShiftExtensionRefusal,
} from '@takeaway/shared-types';

import { busyMeterOf, closingBoundary, isBusy } from '../catalog/store-availability';
import { codedConflict } from '../common/http/coded-conflict';
import {
  closingAfter,
  closingBefore,
  hoursAround,
  type HoursAround,
  nextLocalMidnight,
  wallClock,
  withinHours,
} from '../kitchen/opening-hours';
import { StoreAvailabilityService, type StoreAvailabilityView } from '../kitchen/store-availability.service';
import { NotificationsService } from '../notifications/notifications.service';
import { type PauseEnd, pauseEndedMessage, pauseSetMessage } from '../notifications/store-team-messages';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { StoreAvailabilityNotifier } from '../realtime/store-availability.notifier';

/** A store's shift as the cabinet and the kitchen board show it (`GET /kds/shift`). */
export type StoreShiftDto = KitchenShiftState;

const PERSON = { select: { name: true, email: true, login: true } } as const;

const WITH_NAMES = { openedBy: PERSON, closedBy: PERSON } as const;

/** An extension never reaches further than this past the closing it extends. */
export const MAX_EXTENSION_SECONDS = 4 * 60 * 60;

/** «Продлить» is offered only this close to the closing (or while an extension runs). */
export const EXTEND_WINDOW_SECONDS = 60 * 60;

/** {@link autoCloseDue}: `AUTO_CLOSE_GRACE_MINUTES` when unset — right at the end of the hours. */
export const DEFAULT_AUTO_CLOSE_GRACE_MINUTES = 0;

const HOURS_SELECT = { select: { weekday: true, opensAt: true, closesAt: true, isClosed: true } } as const;

const OPEN_SHIFT = {
  where: { closedAt: null },
  select: { id: true, openedAt: true, extendedUntil: true },
  take: 1,
} as const;

/** What the shift rules read of a store. */
const SCHEDULE_SELECT = {
  id: true,
  name: true,
  status: true,
  timezone: true,
  pausedUntil: true,
  pauseReason: true,
  pauseComment: true,
  pausedById: true,
  workingHours: HOURS_SELECT,
  shifts: OPEN_SHIFT,
} as const satisfies Prisma.StoreSelect;

type ScheduleStore = Prisma.StoreGetPayload<{ select: typeof SCHEDULE_SELECT }>;

/** The open shift as the rules below need it. */
interface OpenShift {
  openedAt: Date;
  extendedUntil: Date | null;
}

/** What `PUT /kds/pause` asks for. */
export interface PauseInput {
  /** Null: until the closing (the end of the working-hours window or the extension). */
  minutes: KitchenPauseMinutes | null;
  reason: StorePauseReason;
  comment?: string | null;
}

/**
 * The store's shift, which since 2026-10-20 follows the working hours by
 * itself (docs/kitchen-policy.md, section F): the schedule cron opens it at
 * the start of each window ({@link openBySchedule}) and closes it at the end
 * of the window or of the kitchen's extension ({@link closeBySchedule}).
 * Nobody opens or closes it by hand any more.
 *
 * What the kitchen still does here:
 * - «Продлить на 30 мин / 1 ч» in the last hour before the closing, or while
 *   an extension runs ({@link extend});
 * - «Пауза» — the coffee machine broke, a cook went home: no ASAP orders and
 *   no pre-orders before its end ({@link pause}, {@link resume}); it runs out
 *   by itself ({@link expirePause}) and is cleared when the shift closes;
 * - «Загружены» ({@link setBusy}), which travels with the shift on the same
 *   realtime event so every tablet of the store shows it at once.
 */
@Injectable()
export class StoreShiftService {
  private readonly logger = new Logger(StoreShiftService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly availability: StoreAvailabilityNotifier,
    private readonly rules: StoreAvailabilityService,
    private readonly notifications: NotificationsService,
  ) {}

  async current(storeId: string, now: Date = new Date()): Promise<StoreShiftDto> {
    const store = await this.findStore(storeId);
    const [last, view, pausedBy] = await Promise.all([
      this.prisma.storeShift.findFirst({
        where: { storeId },
        orderBy: { openedAt: 'desc' },
        include: WITH_NAMES,
      }),
      this.rules.forStore(storeId, now),
      store.pausedById && store.pausedUntil && store.pausedUntil > now
        ? this.prisma.user.findUnique({ where: { id: store.pausedById }, ...PERSON })
        : Promise.resolve(null),
    ]);
    const open = store.shifts[0] ?? null;
    const refusal = extensionRefusal(hoursAround(store.workingHours, store.timezone, now), open, now);
    return toDto(storeId, last, {
      busy: isBusy(store),
      view,
      canExtend: refusal === null,
      pause: store,
      pausedByName: personName(pausedBy),
      now,
    });
  }

  /**
   * Opens a shift for the schedule: within the working hours (or around the
   * clock) with none open. No person opens it (`openedById = null`), and it
   * is marked as opened by the schedule. Returns whether it opened one.
   */
  async openBySchedule(storeId: string, now: Date = new Date()): Promise<boolean> {
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: SCHEDULE_SELECT });
    if (!store || store.status === StoreStatus.CLOSED || store.shifts.length > 0) return false;
    if (!withinHours(hoursAround(store.workingHours, store.timezone, now, { backDays: 1 }), now)) return false;
    try {
      await this.prisma.storeShift.create({
        data: { storeId, openedAt: now, openedById: null, openedAutomatically: true },
      });
    } catch (err) {
      // Another API instance opened it first (partial unique index).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false;
      throw err;
    }
    this.logger.log(`Shift of store ${storeId} opened by the schedule`);
    await this.announce(storeId);
    return true;
  }

  /**
   * Closes the shift for the schedule: outside the working hours, no
   * extension running, `AUTO_CLOSE_GRACE_MINUTES` (0 by default) past the
   * end of the last window or extension. Orders in work do not hold it
   * open — they stay on the board and are finished as usual; closing only
   * stops new ASAP orders, which the hours stop anyway. «Загружены» and a
   * pause are cleared. Returns whether it closed the shift.
   */
  async closeBySchedule(storeId: string, graceSeconds: number, now: Date = new Date()): Promise<boolean> {
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: SCHEDULE_SELECT });
    const shift = store?.shifts[0];
    if (!store || !shift) return false;
    if (!autoCloseDue(hoursAround(store.workingHours, store.timezone, now), shift, graceSeconds, now)) return false;

    const closed = await this.prisma.storeShift.updateMany({
      where: { id: shift.id, closedAt: null },
      data: { closedAt: now, closedById: null, closedAutomatically: true },
    });
    if (closed.count === 0) return false;
    this.logger.log(`Shift of store ${storeId} closed by the schedule`);
    await this.clearBusy(storeId, store.status);
    const paused = store.pausedUntil !== null && store.pausedUntil > now;
    if ((await this.clearPause(storeId)) && paused) await this.tellPauseEnded(store, 'closed');
    await this.announce(storeId);
    return true;
  }

  /**
   * «Продлить на 30 мин / 1 ч»: the kitchen takes ASAP orders past the
   * working hours. Allowed only while {@link extensionRefusal} has nothing
   * against it — a shift open within the hours with the closing at most an
   * hour away, or an extension still running below its cap — else 409
   * `SHIFT_EXTENSION_NOT_ALLOWED {reason}`. At 23:57 outside the hours
   * nothing can be extended, so «Продлить» no longer opens ASAP ordering at
   * night. The extension runs from the later of the closing, the current
   * extension and now, and never reaches more than four hours past the
   * closing it extends.
   */
  async extend(storeId: string, minutes: ShiftExtendMinutes, now: Date = new Date()): Promise<StoreShiftDto> {
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: SCHEDULE_SELECT });
    if (!store) throw new NotFoundException('Store not found');
    const shift = store.shifts[0] ?? null;
    const hours = hoursAround(store.workingHours, store.timezone, now);
    const refusal = extensionRefusal(hours, shift, now);
    const until = shift && refusal === null ? extensionTarget(hours, shift, minutes, now) : 'LIMIT';
    if (refusal !== null || !shift || until === 'LIMIT') throw extensionNotAllowed(refusal ?? 'LIMIT');

    await this.prisma.storeShift.updateMany({
      where: { id: shift.id, closedAt: null },
      data: { extendedUntil: until },
    });
    return this.announce(storeId);
  }

  /**
   * «Пауза»: no ASAP orders and no pre-orders for a time before its end,
   * for 15/30/60/120 minutes or — `minutes: null` — until the closing (the
   * end of the working-hours window or the extension; the next local
   * midnight for a store open around the clock; before the opening, the end
   * of the coming window). Setting it again replaces it. The store team and
   * the owner hear who paused it, why and until when. A store switched off
   * is refused with 409 `STORE_SWITCHED_OFF`.
   */
  async pause(storeId: string, userId: string, input: PauseInput, now: Date = new Date()): Promise<StoreShiftDto> {
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: SCHEDULE_SELECT });
    if (!store) throw new NotFoundException('Store not found');
    if (store.status === StoreStatus.CLOSED) throw switchedOff('The store is switched off; there is nothing to pause');

    const shift = store.shifts[0] ?? null;
    const extension = shift?.extendedUntil && shift.extendedUntil > now ? shift.extendedUntil : null;
    const until = pauseEnd(
      hoursAround(store.workingHours, store.timezone, now),
      extension,
      input.minutes,
      now,
      store.timezone,
    );
    if (!until) {
      throw codedConflict('PAUSE_NEEDS_DURATION', 'The store does not open again soon; pick how long to pause');
    }
    const comment = input.comment?.trim() || null;
    await this.prisma.store.update({
      where: { id: storeId },
      data: { pausedUntil: until, pauseReason: input.reason, pauseComment: comment, pausedById: userId },
    });

    const by = await this.prisma.user.findUnique({ where: { id: userId }, ...PERSON });
    void this.notifications.notifyStoreTeam(
      storeId,
      pauseSetMessage({
        storeName: store.name,
        until: wallClock(until, store.timezone),
        reason: input.reason,
        comment,
        byName: personName(by),
      }),
      { staff: true, owner: true },
    );
    return this.announce(storeId);
  }

  /** «Снять паузу». Idempotent: lifting a pause that already ended changes nothing and tells nobody. */
  async resume(storeId: string, userId: string, now: Date = new Date()): Promise<StoreShiftDto> {
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: SCHEDULE_SELECT });
    if (!store) throw new NotFoundException('Store not found');
    const active = store.pausedUntil !== null && store.pausedUntil > now;
    if (store.pausedUntil !== null && (await this.clearPause(storeId)) && active) {
      const by = await this.prisma.user.findUnique({ where: { id: userId }, ...PERSON });
      await this.tellPauseEnded(store, 'lifted', personName(by));
    }
    return this.announce(storeId);
  }

  /**
   * A pause that ran out: cleared, the team told «Пауза закончилась», and
   * every client told the store takes orders again. Claimed with a
   * conditional update, so two API instances never both announce it.
   * Returns whether this call ended it.
   */
  async expirePause(storeId: string, now: Date = new Date()): Promise<boolean> {
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: SCHEDULE_SELECT });
    if (!store?.pausedUntil || store.pausedUntil > now) return false;
    if (!(await this.clearPause(storeId, now))) return false;
    await this.tellPauseEnded(store, 'expired');
    await this.announce(storeId);
    return true;
  }

  /**
   * The kitchen's «Загружены» switch: on sets the store's status to
   * OVERLOADED, off back to OPEN. That is the status the owner sees in
   * «Точки» and can also set in the store editor, and the storefronts show
   * as «Загружена» with a full (red) load meter. Orders keep coming; the
   * ETA is still the queue-based one, plus `BUSY_EXTRA_WAIT_SECONDS` while
   * busy (KitchenLoadService). A store switched off (CLOSED) is not
   * touched — 409 `STORE_SWITCHED_OFF`. Idempotent.
   */
  async setBusy(storeId: string, busy: boolean): Promise<StoreShiftDto> {
    const store = await this.findStore(storeId);
    if (store.status === StoreStatus.CLOSED) {
      throw switchedOff('The store is switched off; turn it on before marking it busy');
    }
    if (isBusy(store) !== busy) {
      // Conditional on the status read above, so a store switched off in the
      // meantime stays off.
      await this.prisma.store.updateMany({
        where: { id: storeId, status: busy ? StoreStatus.OPEN : StoreStatus.OVERLOADED },
        data: { status: busy ? StoreStatus.OVERLOADED : StoreStatus.OPEN },
      });
      await this.announceLoad(storeId);
    }
    return this.announce(storeId);
  }

  /**
   * Kitchen screens of the store get the shift itself; every client — the
   * storefronts included — learns whether the store now takes orders.
   */
  async announce(storeId: string): Promise<StoreShiftDto> {
    const shift = await this.current(storeId);
    this.realtime.emitKdsShiftChanged({ storeId, shift });
    await this.availability.announce(storeId);
    return shift;
  }

  private async clearBusy(storeId: string, status: StoreStatus): Promise<void> {
    if (status !== StoreStatus.OVERLOADED) return;
    await this.prisma.store.updateMany({
      where: { id: storeId, status: StoreStatus.OVERLOADED },
      data: { status: StoreStatus.OPEN },
    });
    await this.announceLoad(storeId);
  }

  /**
   * Clears the pause; with `endedBy`, only one that ran out by then. Claimed
   * conditionally. Returns whether a pause was there to clear.
   */
  private async clearPause(storeId: string, endedBy?: Date): Promise<boolean> {
    const cleared = await this.prisma.store.updateMany({
      where: { id: storeId, pausedUntil: endedBy ? { not: null, lte: endedBy } : { not: null } },
      data: { pausedUntil: null, pauseReason: null, pauseComment: null, pausedById: null },
    });
    return cleared.count > 0;
  }

  private async tellPauseEnded(store: { id: string; name: string }, end: PauseEnd, byName?: string | null) {
    await this.notifications.notifyStoreTeam(store.id, pauseEndedMessage({ storeName: store.name, end, byName }), {
      staff: true,
      owner: true,
    });
  }

  /**
   * `store.loadChanged` for every connected client, with the load meter and
   * the store's current ETA (the one the storefronts show). Storefronts also
   * refetch the store on the `store.availabilityChanged` that
   * {@link announce} sends right after. Best effort, like the availability
   * broadcast.
   */
  private async announceLoad(storeId: string): Promise<void> {
    try {
      const store = await this.prisma.store.findUnique({
        where: { id: storeId },
        select: { status: true, busyMeter: true, baseEtaSeconds: true },
      });
      if (!store) return;
      const view = await this.rules.forStore(storeId);
      this.realtime.emitStoreLoad({
        storeId,
        busy: isBusy(store),
        busyMeter: busyMeterOf(store),
        currentEtaSeconds: view?.currentEtaSeconds ?? store.baseEtaSeconds,
      });
    } catch (err) {
      this.logger.warn(`store.loadChanged for ${storeId} not sent: ${(err as Error).message}`);
    }
  }

  private async findStore(storeId: string): Promise<ScheduleStore> {
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: SCHEDULE_SELECT });
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }
}

function switchedOff(message: string): ConflictException {
  return new ConflictException({
    statusCode: HttpStatus.CONFLICT,
    error: 'Conflict',
    code: 'STORE_SWITCHED_OFF',
    message,
  });
}

function extensionNotAllowed(reason: ShiftExtensionRefusal): ConflictException {
  const why: Record<ShiftExtensionRefusal, string> = {
    NO_SHIFT: 'No shift is open; the schedule opens it at the start of the working hours',
    AROUND_THE_CLOCK: 'The store is open around the clock; there is nothing to extend',
    OUTSIDE_HOURS: 'The store is closed by its working hours; an extension is only offered before the closing',
    TOO_EARLY: 'The closing is more than an hour away; extend in the last hour before it',
    LIMIT: 'The shift is already extended as far as it can be (four hours past the closing)',
  };
  return new ConflictException({
    statusCode: HttpStatus.CONFLICT,
    error: 'Conflict',
    code: 'SHIFT_EXTENSION_NOT_ALLOWED',
    message: why[reason],
    reason,
  });
}

/**
 * The hours side of the auto-close rule: outside the hours (a store open
 * around the clock never closes), no extension running, and the grace past
 * the end of the last window — or of the extension, or the opening of a
 * shift started outside the hours — gone by.
 */
export function autoCloseDue(hours: HoursAround, shift: OpenShift, graceSeconds: number, now: Date): boolean {
  if (hours.alwaysOpen || withinHours(hours, now)) return false;
  if (shift.extendedUntil && shift.extendedUntil > now) return false;
  const ended = Math.max(
    closingBefore(hours, now)?.getTime() ?? 0,
    shift.extendedUntil?.getTime() ?? 0,
    shift.openedAt.getTime(),
  );
  return now.getTime() >= ended + graceSeconds * 1000;
}

/**
 * Why «Продлить» cannot be offered now, or null when it can: a shift is
 * open, and either the store is within its hours with the closing at most
 * an hour away, or an extension is running — in both cases below the
 * four-hour cap.
 */
export function extensionRefusal(hours: HoursAround, shift: OpenShift | null, now: Date): ShiftExtensionRefusal | null {
  if (!shift) return 'NO_SHIFT';
  if (hours.alwaysOpen) return 'AROUND_THE_CLOCK';
  const running = shift.extendedUntil !== null && shift.extendedUntil > now;
  if (withinHours(hours, now)) {
    const closes = closingAfter(hours, now);
    if (!closes) return 'AROUND_THE_CLOCK';
    if (!running && closes.getTime() - now.getTime() > EXTEND_WINDOW_SECONDS * 1000) return 'TOO_EARLY';
  } else if (!running) {
    return 'OUTSIDE_HOURS';
  }
  return extensionTarget(hours, shift, Math.min(...SHIFT_EXTEND_MINUTES), now) === 'LIMIT' ? 'LIMIT' : null;
}

/**
 * Where an extension of `minutes` ends: from the later of the closing
 * time, the current extension and now, capped at four hours past the
 * closing it extends — the current window's end within the hours, the
 * last window's end while an extension runs past it.
 */
export function extensionTarget(hours: HoursAround, shift: OpenShift, minutes: number, now: Date): Date | 'LIMIT' {
  const closes = withinHours(hours, now) ? closingAfter(hours, now) : null;
  const current = shift.extendedUntil?.getTime() ?? 0;
  const from = Math.max(closes?.getTime() ?? 0, current, now.getTime());
  const capBase = closes?.getTime() ?? closingBefore(hours, now)?.getTime() ?? now.getTime();
  const until = Math.min(from + minutes * 60_000, capBase + MAX_EXTENSION_SECONDS * 1000);
  if (until <= Math.max(current, now.getTime())) return 'LIMIT';
  return new Date(until);
}

/**
 * When a pause of `minutes` ends; with `null`, at the closing — the end of
 * the current window or the running extension, whichever is later. A store
 * open around the clock (or whose window does not close within the week)
 * pauses until the next local midnight; before the opening, until the end
 * of the coming window. Null when nothing opens within the span looked at.
 */
export function pauseEnd(
  hours: HoursAround,
  extendedUntil: Date | null,
  minutes: number | null,
  now: Date,
  timeZone: string,
): Date | null {
  if (minutes !== null) return new Date(now.getTime() + minutes * 60_000);
  const inHours = withinHours(hours, now);
  const boundary = closingBoundary({ closesAt: inHours ? closingAfter(hours, now) : null, extendedUntil });
  if (boundary) return boundary;
  if (inHours) return nextLocalMidnight(now, timeZone);
  return hours.windows.find((w) => w.start > now)?.end ?? null;
}

type ShiftRow = Prisma.StoreShiftGetPayload<{ include: typeof WITH_NAMES }>;

function personName(user: { name: string | null; email: string | null; login: string | null } | null): string | null {
  return user?.name?.trim() || user?.email || user?.login || null;
}

export function toDto(
  storeId: string,
  shift: ShiftRow | null,
  extra: {
    busy?: boolean;
    view?: StoreAvailabilityView | null;
    canExtend?: boolean;
    pause?: { pausedUntil: Date | null; pauseReason: StorePauseReason | null; pauseComment: string | null } | null;
    pausedByName?: string | null;
    now?: Date;
  } = {},
): StoreShiftDto {
  const { busy = false, view = null, canExtend = false, pause = null, pausedByName = null, now = new Date() } = extra;
  const open = shift != null && shift.closedAt == null;
  const paused = pause?.pausedUntil && pause.pausedUntil > now ? pause : null;
  return {
    storeId,
    open,
    openedAt: shift?.openedAt.toISOString() ?? null,
    openedByName: personName(shift?.openedBy ?? null),
    closedAt: shift?.closedAt?.toISOString() ?? null,
    closedByName: personName(shift?.closedBy ?? null),
    busy,
    extendedUntil: open ? (view?.extendedUntil?.toISOString() ?? null) : null,
    closesAt: view?.closesAt?.toISOString() ?? null,
    opensAt: view?.opensAt?.toISOString() ?? null,
    asapOpen: view?.openNow ?? false,
    asapBlockedReason: view?.asapBlockedReason ?? null,
    closedAutomatically: !open && shift?.closedAutomatically === true,
    openedAutomatically: shift?.openedAutomatically === true,
    canExtend: open && canExtend,
    pausedUntil: paused?.pausedUntil?.toISOString() ?? null,
    pauseReason: paused?.pauseReason ?? null,
    pauseComment: paused?.pauseComment ?? null,
    pausedByName: paused ? pausedByName : null,
  };
}
