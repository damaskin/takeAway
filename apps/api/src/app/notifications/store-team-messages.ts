import type { StorePauseReason } from '@prisma/client';

import type { StoreTeamMessage } from './notifications.service';

/**
 * Telegram texts for a store's team (staff and the brand owner) about the
 * kitchen's pause and orders that left the board without the kitchen —
 * Russian first, then English, like the other staff messages. Times arrive
 * already on the store's clock ("12:30").
 */

const PAUSE_REASON: Record<StorePauseReason, [string, string]> = {
  EQUIPMENT: ['Сломалось оборудование', 'Equipment broke'],
  NO_INGREDIENTS: ['Закончились продукты', 'Out of ingredients'],
  NO_STAFF: ['Нет сотрудника', 'Short of staff'],
  OTHER: ['Другое', 'Other'],
};

/** «Сломалось оборудование — кофемашина», in both languages. */
function pauseWhy(reason: StorePauseReason, comment: string | null): [string, string] {
  const [ru, en] = PAUSE_REASON[reason];
  const note = comment?.trim();
  return note ? [`${ru} — ${note}`, `${en} — ${note}`] : [ru, en];
}

export function pauseSetMessage(input: {
  storeName: string;
  until: string;
  reason: StorePauseReason;
  comment: string | null;
  byName: string | null;
}): StoreTeamMessage {
  const [whyRu, whyEn] = pauseWhy(input.reason, input.comment);
  const who = input.byName ? ` (${input.byName})` : '';
  return {
    title: `Пауза до ${input.until} · ${input.storeName}`,
    body:
      `${whyRu}${who}. Заказы «сейчас» не принимаются, предзаказы до ${input.until} закрыты. / ` +
      `${whyEn}${who}. No orders for now; pre-orders before ${input.until} are closed.`,
  };
}

/** How a pause ended: lifted on the board, ran out, or cleared by the shift closing at the end of the hours. */
export type PauseEnd = 'lifted' | 'expired' | 'closed';

export function pauseEndedMessage(input: {
  storeName: string;
  end: PauseEnd;
  byName?: string | null;
}): StoreTeamMessage {
  switch (input.end) {
    case 'lifted': {
      const who = input.byName ? ` (${input.byName})` : '';
      return {
        title: `Пауза снята · ${input.storeName}`,
        body: `Пауза снята${who} — точка снова принимает заказы. / The pause was lifted${who}; the store takes orders again.`,
      };
    }
    case 'expired':
      return {
        title: `Пауза закончилась · ${input.storeName}`,
        body: 'Точка снова принимает заказы. / The pause is over; the store takes orders again.',
      };
    case 'closed':
      return {
        title: `Пауза закончилась · ${input.storeName}`,
        body: 'Точка закрылась по графику, пауза снята. / The store closed by the schedule; the pause is cleared.',
      };
  }
}

/** The customer cancelled an order the kitchen had on its board but had not accepted yet. */
export function customerCancelledMessage(input: {
  orderCode: string;
  orderId: string;
  storeName: string;
}): StoreTeamMessage {
  return {
    title: `Клиент отменил заказ #${input.orderCode} · ${input.storeName}`,
    body:
      'Он ещё не был принят — готовить не нужно. / ' +
      `The customer cancelled order #${input.orderCode} before it was accepted; no need to make it.`,
    orderId: input.orderId,
  };
}

/**
 * Nobody accepted the order in time and it was called off. An ASAP order
 * names the timeout («не приняли за 8 минут»); a pre-order names its pickup
 * time, because its deadline is ten minutes before it, not a fixed wait.
 */
export function autoCancelledMessage(input: {
  orderCode: string;
  orderId: string;
  storeName: string;
  timeoutMinutes: number;
  /** The pickup time of a pre-order on the store's clock; null for ASAP. */
  scheduledFor: string | null;
}): StoreTeamMessage {
  const title = `Заказ #${input.orderCode} отменён автоматически · ${input.storeName}`;
  if (input.scheduledFor) {
    return {
      title,
      body:
        `Предзаказ к ${input.scheduledFor} не приняли вовремя. Клиенту ушло уведомление. / ` +
        `The pre-order for ${input.scheduledFor} was not accepted in time; the customer was told.`,
      orderId: input.orderId,
    };
  }
  return {
    title,
    body:
      `Его не приняли за ${input.timeoutMinutes} мин. Клиенту ушло уведомление. / ` +
      `It was not accepted within ${input.timeoutMinutes} min; the customer was told.`,
    orderId: input.orderId,
  };
}
