import { ConflictException } from '@nestjs/common';

import type { PrismaService } from '../../prisma/prisma.service';

/** Collisions tolerated before giving up on allocating an invoice id. */
const MAX_ATTEMPTS = 5;

/**
 * The next number of the invoice sequence (migration
 * 20260923160000_agroprombank_invoice_sequence). A sequence never hands a
 * value out twice, even across concurrent charges — but a database restored
 * from a backup rewinds it: move it past the highest invoice id the bank has
 * already seen before taking payments again.
 */
export async function nextInvoiceNumber(prisma: Pick<PrismaService, '$queryRaw'>): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('agroprombank_invoice_seq') AS value`;
  const value = rows[0]?.value;
  if (value === undefined) throw new Error('agroprombank_invoice_seq returned no value');
  return value.toString();
}

/**
 * Hands `use` a fresh invoice id and retries with the next one when the row
 * it writes collides with an id already taken.
 *
 * One numbering for every operation we ever send Agroprombank — bound cards,
 * Web-платёж, QR invoices: the prefix (`AGROPROMBANK_INVOICE_PREFIX`, digits
 * only, distinct per environment) and the next value of
 * `agroprombank_invoice_seq`. Short numbers like the bank's own example
 * (`123456`): the timestamp + random ids used before ran to 18 digits, and
 * every charge that carried one failed inside the bank ("Произошла ошибка",
 * no operation on record). The DB's unique index on `Payment.invoiceId` stays
 * the actual guarantee, which is why a collision is retried here.
 */
export async function withFreshInvoiceId<T>(
  prisma: Pick<PrismaService, '$queryRaw'>,
  prefix: string,
  use: (invoiceId: string) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const invoiceId = `${prefix}${await nextInvoiceNumber(prisma)}`;
    try {
      return await use(invoiceId);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  throw new ConflictException('Could not allocate a unique invoice id');
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}
