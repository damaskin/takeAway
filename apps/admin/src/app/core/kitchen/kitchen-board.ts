import type {
  KitchenAction,
  KitchenOrder,
  KitchenOrderStatus,
  KitchenRejectMoney,
  KitchenRejectReason,
  StoreShift,
} from './kitchen.api';

/** A `kds.orderChanged` event as the API broadcasts it to a store's room. */
export interface KitchenOrderChanged {
  storeId: string;
  kind: 'created' | 'updated' | 'removed';
  orderId: string;
  /** The full board row; null on "removed", and on updates that only say "look again". */
  order: (Omit<KitchenOrder, 'status'> & { status: string }) | null;
}

/** A `kds.shiftChanged` event: someone started or finished work at the store. */
export interface KitchenShiftChanged {
  storeId: string;
  shift: StoreShift;
}

export type KitchenColumn = 'NEW' | 'PREPARING' | 'READY';

export const KITCHEN_COLUMNS: readonly KitchenColumn[] = ['NEW', 'PREPARING', 'READY'];

const COLUMN_STATUSES: Record<KitchenColumn, readonly KitchenOrderStatus[]> = {
  NEW: ['CREATED', 'PAID', 'ACCEPTED'],
  PREPARING: ['IN_PROGRESS'],
  READY: ['READY'],
};

const OPEN_STATUSES: readonly string[] = ['CREATED', 'PAID', 'ACCEPTED', 'IN_PROGRESS', 'READY'];

/** Orders someone still has to take on — what the new-order alerts count. */
export function awaitsAcceptance(order: { status: string }): boolean {
  return order.status === 'CREATED' || order.status === 'PAID';
}

/** The reasons the kitchen picks from, in the order the dialog lists them. */
export const KITCHEN_REJECT_REASONS: readonly KitchenRejectReason[] = ['OUT_OF_STOCK', 'TOO_BUSY', 'CLOSING', 'OTHER'];

/** Only an order nobody has accepted can be turned down; later it has to be finished. */
export function canReject(order: { status: string }): boolean {
  return awaitsAcceptance(order);
}

/** The translation key of the "order rejected" notice, by what happened to the money. */
export function rejectOutcomeKey(money: KitchenRejectMoney): string {
  return `admin.kitchen.reject.done.${money}`;
}

/** A pre-order waits in «Предзаказы» until its start is this close. */
export const PREORDER_GROUP_LEAD_MS = 15 * 60_000;
/** A card nobody accepted in time chimes again this often. */
export const OVERDUE_CHIME_MS = 30_000;
/** The "end of the working hours" banner shows this long before them. */
export const CLOSING_SOON_MS = 15 * 60_000;

const NOT_STARTED: readonly string[] = ['CREATED', 'PAID', 'ACCEPTED'];
const BEING_MADE: readonly string[] = ['ACCEPTED', 'IN_PROGRESS'];

/**
 * A pre-order the kitchen does not have to think about yet: its start is
 * more than 15 minutes away. It waits in «Предзаказы» (it can be accepted
 * there any time), then joins «Новые».
 */
export function isLaterPreorder(order: KitchenOrder, now: number): boolean {
  if (order.pickupMode !== 'SCHEDULED' || !order.startBy || !NOT_STARTED.includes(order.status)) return false;
  return Date.parse(order.startBy) - now > PREORDER_GROUP_LEAD_MS;
}

/** The pre-orders for later, soonest pickup first. */
export function laterPreorders(list: readonly KitchenOrder[], now: number): KitchenOrder[] {
  return list.filter((o) => isLaterPreorder(o, now)).sort((a, b) => Date.parse(a.pickupAt) - Date.parse(b.pickupAt));
}

export function inColumn(order: KitchenOrder, column: KitchenColumn, now = Date.now()): boolean {
  return COLUMN_STATUSES[column].includes(order.status) && !isLaterPreorder(order, now);
}

/** A countdown: m:ss below an hour, h:mm:ss above it (not "720:00"); a minus once it is past. */
export function countdown(diffMs: number): string {
  const total = Math.abs(Math.round(diffMs / 1000));
  const sign = diffMs < 0 && total > 0 ? '−' : '';
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${sign}${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${sign}${minutes}:${seconds}`;
}

/** Whole minutes an accepted order is past its pickup time; 0 while it is not late. */
export function lateMinutes(order: KitchenOrder, now: number): number {
  if (!BEING_MADE.includes(order.status)) return 0;
  const late = now - Date.parse(order.pickupAt);
  return late > 0 ? Math.max(1, Math.floor(late / 60_000)) : 0;
}

/** Nobody accepted it in time: the card pulses and chimes until someone does. */
export function acceptOverdue(order: KitchenOrder, now: number): boolean {
  return awaitsAcceptance(order) && !!order.acceptAlertAt && Date.parse(order.acceptAlertAt) <= now;
}

/** A pre-order whose start time came and that nobody has started making. */
export function startDue(order: KitchenOrder, now: number): boolean {
  return (
    order.pickupMode === 'SCHEDULED' &&
    NOT_STARTED.includes(order.status) &&
    !!order.startBy &&
    Date.parse(order.startBy) <= now
  );
}

/** What the banner over the board says about the working hours, if anything. */
export type ShiftBanner =
  | { kind: 'closingSoon'; at: string; extended: boolean }
  | { kind: 'outsideHours'; opensAt: string | null };

/**
 * With a shift open: 15 minutes before the hours (or the extension) end,
 * "ASAP orders stop at 21:00"; past them without an extension, "the store is
 * closed by the schedule — no ASAP orders". Both offer «Продлить». Worked
 * out against the board's own clock, so it flips on time between two reads
 * of the shift.
 */
export function shiftBanner(shift: StoreShift | null, now: number): ShiftBanner | null {
  if (!shift?.open) return null;
  const ahead = (iso: string | null | undefined): number | null => {
    const t = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(t) && t > now ? t : null;
  };
  const extension = ahead(shift.extendedUntil);
  const closing = ahead(shift.closesAt);
  const end = Math.max(extension ?? 0, closing ?? 0);
  if (end > 0) {
    if (end - now > CLOSING_SOON_MS) return null;
    return { kind: 'closingSoon', at: new Date(end).toISOString(), extended: end === extension };
  }
  const passed = (iso: string | null | undefined) => !!iso && Date.parse(iso) <= now;
  const outside = shift.asapBlockedReason === 'OUTSIDE_HOURS' || passed(shift.closesAt) || passed(shift.extendedUntil);
  return outside ? { kind: 'outsideHours', opensAt: shift.opensAt ?? null } : null;
}

/** The one button a ticket shows, by where it stands. */
export function nextAction(order: KitchenOrder): KitchenAction | null {
  switch (order.status) {
    case 'CREATED':
    case 'PAID':
      return 'accept';
    case 'ACCEPTED':
      return 'start';
    case 'IN_PROGRESS':
      return 'ready';
    case 'READY':
      return 'pickedUp';
    default:
      return null;
  }
}

/**
 * Patches the board with one realtime event. Returns `null` when the event
 * carries no row and the board has to be read again — an update such as
 * "the customer is here" arrives that way.
 */
export function applyKitchenEvent(list: readonly KitchenOrder[], event: KitchenOrderChanged): KitchenOrder[] | null {
  if (event.kind === 'removed') return list.filter((o) => o.id !== event.orderId);
  if (!event.order) return null;
  const incoming = event.order;
  if (!OPEN_STATUSES.includes(incoming.status)) return list.filter((o) => o.id !== incoming.id);
  const known = list.find((o) => o.id === incoming.id);
  // A row built outside the board query (a new or just-paid order) carries no
  // arrival; keep what the board already knew rather than wiping it.
  const row = (
    incoming.customerArrival === undefined && known
      ? { ...incoming, customerArrival: known.customerArrival, customerArrivedAt: known.customerArrivedAt }
      : incoming
  ) as KitchenOrder;
  return list.some((o) => o.id === row.id) ? list.map((o) => (o.id === row.id ? row : o)) : [...list, row];
}
