import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type {
  SandboxBank,
  SandboxOperation,
  SandboxToken,
  SandboxTokenRequest,
} from '../../apps/api/src/app/payments/agroprombank/testing/sandbox-bank';
import type {
  SandboxInvoice,
  SandboxWebBank,
} from '../../apps/api/src/app/payments/agroprombank-web/testing/sandbox-web-bank';

/**
 * Keeps the sandboxes' memory in a file across restarts (`AGRO_MOCK_STATE_FILE`).
 *
 * The sandboxes hold everything in memory, which suits tests. On a shared
 * environment the mock is recreated whenever its sources change, and every
 * card bound before that would then be answered «Токен не найден» — the
 * tester's saved card dead for no reason they can see. So the cards, their
 * operations and the Web-платёж invoices are written out after every call
 * that can change them and read back on start.
 */

interface SavedState {
  tokenRequests: SandboxTokenRequest[];
  tokens: SandboxToken[];
  operations: SandboxOperation[];
  invoices: SandboxInvoice[];
}

export function keepStateIn(
  file: string,
  bank: SandboxBank,
  webBank: SandboxWebBank,
  log: (message: string) => void,
): void {
  if (existsSync(file)) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as Partial<SavedState>;
      for (const request of saved.tokenRequests ?? []) bank.tokenRequests.set(request.requestId, request);
      for (const token of saved.tokens ?? []) bank.tokens.set(token.token, token);
      for (const operation of saved.operations ?? []) bank.operations.set(operation.invoiceId, operation);
      for (const invoice of saved.invoices ?? []) webBank.invoices.set(invoice.nivid, invoice);
      log(
        `состояние из ${file}: токенов ${bank.tokens.size}, операций ${bank.operations.size}, ` +
          `счетов Web-платежа ${webBank.invoices.size}`,
      );
    } catch (err) {
      log(`не прочитать ${file}, начинаю с пустого: ${err instanceof Error ? err.message : err}`);
    }
  }

  const save = (): void => {
    const state: SavedState = {
      tokenRequests: [...bank.tokenRequests.values()],
      tokens: [...bank.tokens.values()],
      operations: [...bank.operations.values()],
      invoices: [...webBank.invoices.values()],
    };
    try {
      mkdirSync(dirname(file), { recursive: true });
      // Write-then-rename: a restart mid-write leaves the previous file whole.
      writeFileSync(`${file}.tmp`, JSON.stringify(state));
      renameSync(`${file}.tmp`, file);
    } catch (err) {
      log(`не записать ${file}: ${err instanceof Error ? err.message : err}`);
    }
  };

  // Only POSTs change anything; GETs (state, health checks) are not worth a write.
  for (const server of [bank.server, webBank.server]) {
    server.on('request', (req, res) => {
      if (req.method === 'POST') res.on('finish', save);
    });
  }
}
