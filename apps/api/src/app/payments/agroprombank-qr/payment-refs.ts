import type { Payment } from '@prisma/client';

import type { QrPaymentRefs } from './agroprombank-qr.client';

/**
 * The bank's handles on a paid QR invoice, as recorded on our row when it was
 * found paid: `rawJson.qrPaymentId` (else `providerRef`, the id
 * `CreatePaymentID` returned) and `rawJson.rrn`.
 */
export function qrPaymentRefs(payment: Pick<Payment, 'rawJson' | 'providerRef'>): QrPaymentRefs {
  const raw =
    payment.rawJson && typeof payment.rawJson === 'object' && !Array.isArray(payment.rawJson)
      ? (payment.rawJson as Record<string, unknown>)
      : {};
  const qrPaymentId = raw['qrPaymentId'];
  const rrn = raw['rrn'];
  return {
    qrPaymentId: typeof qrPaymentId === 'string' && qrPaymentId ? qrPaymentId : payment.providerRef,
    rrn: typeof rrn === 'string' && rrn ? rrn : null,
  };
}
