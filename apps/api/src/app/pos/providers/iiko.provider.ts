import {
  BadGatewayException,
  Injectable,
  Logger,
  NotImplementedException,
  UnauthorizedException,
} from '@nestjs/common';
import axios, { AxiosError, AxiosInstance } from 'axios';

import { RedisService } from '../../redis/redis.service';
import type {
  IPosProvider,
  IikoCredentials,
  IikoSettings,
  ImportedMenu,
  ImportedStopListEntry,
  ImportedStoreDraft,
  OrderForPush,
  PosIntegrationCtx,
  SyncProgressCtx,
} from './pos-provider.interface';

const DEFAULT_API_HOST = 'https://api-ru.iiko.services';
const TOKEN_TTL_SECONDS = 50 * 60;
const REQUEST_TIMEOUT_MS = 15_000;

interface IikoAccessTokenResponse {
  correlationId?: string;
  token: string;
}

/**
 * Adapter for the iiko Cloud (api-ru.iiko.services) public API.
 *
 * Auth model: a single `apiLogin` is exchanged for a short-lived bearer
 * token at `/api/1/access_token`. Tokens are valid for ~1 hour; we cache
 * them in Redis at 50 minutes to leave a safety margin against clock skew
 * between us and the iiko gateway.
 *
 * For M1 only {@link testConnection} is wired up — listing stores,
 * importing menu/stop-list and pushing orders all live behind
 * NotImplementedException placeholders so the API surface compiles and
 * the admin UI can hit the endpoints, but the actual sync work is M3/M4.
 */
@Injectable()
export class IikoProvider implements IPosProvider {
  readonly kind = 'IIKO' as const;
  /**
   * iiko Cloud has no public webhook channel for stop-list changes, so the
   * cron poller is the only way to keep our copy fresh. Stays `false` until
   * `importStopList` lands (M5+) — flipping it earlier would just keep the
   * cron enqueueing jobs that immediately fail with NotImplementedException.
   */
  readonly supportsStopListPolling = false;
  private readonly logger = new Logger(IikoProvider.name);

  constructor(private readonly redis: RedisService) {}

  async testConnection(integration: PosIntegrationCtx): Promise<void> {
    await this.fetchAccessToken(integration, { force: true });
  }

  async listStores(_integration: PosIntegrationCtx): Promise<ImportedStoreDraft[]> {
    throw new NotImplementedException('iiko store import is not available yet (M2)');
  }

  async importMenu(_integration: PosIntegrationCtx, _ctx: SyncProgressCtx): Promise<ImportedMenu> {
    throw new NotImplementedException('iiko menu import is not available yet (M2)');
  }

  async importStopList(_integration: PosIntegrationCtx, _ctx: SyncProgressCtx): Promise<ImportedStopListEntry[]> {
    throw new NotImplementedException('iiko stop-list import is not available yet (M2)');
  }

  async pushOrder(_integration: PosIntegrationCtx, _order: OrderForPush): Promise<{ posExternalId: string }> {
    throw new NotImplementedException('iiko outgoing orders are not available yet (M3)');
  }

  /**
   * Returns a valid bearer token for the integration. Cached in Redis under
   * `pos:iiko:token:{integrationId}` with a 50-minute TTL.
   *
   * `force: true` skips the cache — used by testConnection so we never
   * report success based on a stale cached token.
   */
  private async fetchAccessToken(integration: PosIntegrationCtx, opts: { force?: boolean } = {}): Promise<string> {
    const cacheKey = `pos:iiko:token:${integration.row.id}`;
    if (!opts.force) {
      const cached = await this.redis.get(cacheKey);
      if (cached) return cached;
    }

    const credentials = integration.credentials as IikoCredentials;
    const settings = integration.settings as IikoSettings;
    const host = settings.apiHost ?? DEFAULT_API_HOST;

    try {
      const response = await this.http(host).post<IikoAccessTokenResponse>('/api/1/access_token', {
        apiLogin: credentials.apiLogin,
      });
      const token = response.data.token;
      if (!token) {
        throw new BadGatewayException('iiko returned an empty access token');
      }
      await this.redis.set(cacheKey, token, TOKEN_TTL_SECONDS);
      return token;
    } catch (err) {
      if (err instanceof AxiosError && err.response) {
        const status = err.response.status;
        if (status === 401 || status === 403) {
          throw new UnauthorizedException('iiko rejected the apiLogin');
        }
        this.logger.warn(`iiko access_token failed (${status}): ${JSON.stringify(err.response.data ?? {})}`);
        throw new BadGatewayException(`iiko gateway returned HTTP ${status}`);
      }
      throw err;
    }
  }

  private http(host: string): AxiosInstance {
    return axios.create({
      baseURL: host,
      timeout: REQUEST_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
