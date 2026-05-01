import {
  BadGatewayException,
  Injectable,
  Logger,
  NotImplementedException,
  UnauthorizedException,
} from '@nestjs/common';
import axios, { AxiosError, AxiosInstance } from 'axios';

import type {
  IPosProvider,
  ImportedMenu,
  ImportedStopListEntry,
  ImportedStoreDraft,
  OrderForPush,
  PosIntegrationCtx,
  PosterCredentials,
  PosterSettings,
  SyncProgressCtx,
} from './pos-provider.interface';

const DEFAULT_API_HOST = 'https://joinposter.com';
const REQUEST_TIMEOUT_MS = 15_000;

interface PosterEnvelope<T> {
  response?: T;
  error?: { code: number; message: string };
}

/**
 * Adapter for joinposter.com — Poster's public API.
 *
 * Auth model: a long-lived application token, supplied as `?token=` on
 * every request. There is no exchange step or short-lived bearer, so we
 * don't cache anything provider-side; the encrypted token is read from
 * {@link PosIntegration.credentialsCiphertext} on demand.
 *
 * For M1 only {@link testConnection} is wired up — the rest of the
 * surface throws NotImplementedException until we land the menu importer
 * (M2) and outgoing orders (M3).
 */
@Injectable()
export class PosterProvider implements IPosProvider {
  readonly kind = 'POSTER' as const;
  private readonly logger = new Logger(PosterProvider.name);

  async testConnection(integration: PosIntegrationCtx): Promise<void> {
    const credentials = integration.credentials as PosterCredentials;
    const settings = integration.settings as PosterSettings;
    const host = settings.apiHost ?? DEFAULT_API_HOST;
    try {
      const response = await this.http(host).get<PosterEnvelope<unknown>>('/api/access.ping', {
        params: { token: credentials.token },
      });
      if (response.data.error) {
        throw new UnauthorizedException(`Poster rejected the token: ${response.data.error.message}`);
      }
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      if (err instanceof AxiosError && err.response) {
        const status = err.response.status;
        if (status === 401 || status === 403) {
          throw new UnauthorizedException('Poster rejected the token');
        }
        this.logger.warn(`Poster access.ping failed (${status}): ${JSON.stringify(err.response.data ?? {})}`);
        throw new BadGatewayException(`Poster gateway returned HTTP ${status}`);
      }
      throw err;
    }
  }

  async listStores(_integration: PosIntegrationCtx): Promise<ImportedStoreDraft[]> {
    throw new NotImplementedException('Poster spot import is not available yet (M2)');
  }

  async importMenu(_integration: PosIntegrationCtx, _ctx: SyncProgressCtx): Promise<ImportedMenu> {
    throw new NotImplementedException('Poster menu import is not available yet (M2)');
  }

  async importStopList(_integration: PosIntegrationCtx, _ctx: SyncProgressCtx): Promise<ImportedStopListEntry[]> {
    throw new NotImplementedException('Poster stop-list import is not available yet (M2)');
  }

  async pushOrder(_integration: PosIntegrationCtx, _order: OrderForPush): Promise<{ posExternalId: string }> {
    throw new NotImplementedException('Poster outgoing orders are not available yet (M3)');
  }

  async subscribeWebhooks(_integration: PosIntegrationCtx, _callbackUrl: string): Promise<void> {
    throw new NotImplementedException('Poster webhook subscription is not available yet (M4)');
  }

  private http(host: string): AxiosInstance {
    return axios.create({
      baseURL: host,
      timeout: REQUEST_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
