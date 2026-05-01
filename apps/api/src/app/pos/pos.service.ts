import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  PosIntegration,
  PosIntegrationStatus,
  PosProvider,
  PosSyncJobKind,
  PosSyncJobStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { Queue } from 'bullmq';

import { BrandScopeService } from '../auth/services/brand-scope.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { SecretCipher } from '../common/crypto/secret-cipher';
import { PrismaService } from '../prisma/prisma.service';
import { POS_SYNC_QUEUE, PosSyncJobPayload } from './pos-sync.queue';
import type {
  IPosProvider,
  IikoCredentials,
  PosCredentials,
  PosIntegrationCtx,
  PosSettings,
  PosterCredentials,
} from './providers/pos-provider.interface';
import { IikoProvider } from './providers/iiko.provider';
import { PosterProvider } from './providers/poster.provider';
import type { PosIntegrationDto, PosSyncJobDto } from './dto/pos-status.dto';

const MENU_SYNC_PRIORITY = 10;
const JOB_HISTORY_LIMIT = 25;

/**
 * Facade in front of the IPosProvider implementations. Owns:
 *   - credential encryption / decryption (via SecretCipher)
 *   - PosIntegration lifecycle (connect / disconnect / status)
 *   - PosSyncJob bookkeeping — every long-running operation gets a row
 *     in the table that the BullMQ worker keeps in sync as it progresses
 *
 * Brand scoping: every read/write goes through {@link BrandScopeService}.
 * SUPER_ADMIN can target any brand by passing `brandId`; BRAND_ADMIN's
 * scope is derived from `Brand.ownerId` and `brandId` is ignored.
 */
@Injectable()
export class PosService {
  private readonly logger = new Logger(PosService.name);
  private readonly providers: Record<PosProvider, IPosProvider>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: SecretCipher,
    private readonly scope: BrandScopeService,
    private readonly iiko: IikoProvider,
    private readonly poster: PosterProvider,
    @InjectQueue(POS_SYNC_QUEUE) private readonly queue: Queue<PosSyncJobPayload>,
  ) {
    this.providers = { IIKO: this.iiko, POSTER: this.poster };
  }

  /**
   * Validates credentials by calling provider.testConnection, then upserts a
   * PosIntegration row scoped to the caller's brand. The row is stamped
   * `CONNECTED` on success or `ERROR` if the test fails.
   */
  async connect(
    user: AuthenticatedUser,
    input: {
      provider: PosProvider;
      credentials: Record<string, string>;
      settings?: Record<string, string>;
      brandId?: string;
    },
  ): Promise<PosIntegrationDto> {
    const brandId = await this.resolveBrandId(user, input.brandId);
    const credentials = this.shapeCredentials(input.provider, input.credentials);
    const settings = (input.settings ?? {}) as PosSettings;

    const provider = this.providers[input.provider];
    const transientCtx: PosIntegrationCtx = {
      row: {
        id: 'transient',
        brandId,
        provider: input.provider,
        credentialsCiphertext: '',
        status: PosIntegrationStatus.DISCONNECTED,
        settings: settings as Prisma.JsonValue,
        lastSyncAt: null,
        lastErrorMessage: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as PosIntegration,
      credentials,
      settings,
    };

    try {
      await provider.testConnection(transientCtx);
    } catch (err) {
      const message = (err as Error).message ?? 'unknown error';
      this.logger.warn(`POS connect rejected for brand=${brandId} provider=${input.provider}: ${message}`);
      throw err;
    }

    const ciphertext = this.cipher.encryptJson(credentials);
    const row = await this.prisma.posIntegration.upsert({
      where: { brandId_provider: { brandId, provider: input.provider } },
      create: {
        brandId,
        provider: input.provider,
        credentialsCiphertext: ciphertext,
        status: PosIntegrationStatus.CONNECTED,
        settings: settings as Prisma.InputJsonValue,
        lastErrorMessage: null,
      },
      update: {
        credentialsCiphertext: ciphertext,
        status: PosIntegrationStatus.CONNECTED,
        settings: settings as Prisma.InputJsonValue,
        lastErrorMessage: null,
      },
    });

    return this.toIntegrationDto(row, null);
  }

  async disconnect(user: AuthenticatedUser, provider: PosProvider, brandId?: string): Promise<void> {
    const targetBrandId = await this.resolveBrandId(user, brandId);
    const row = await this.prisma.posIntegration.findUnique({
      where: { brandId_provider: { brandId: targetBrandId, provider } },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Integration not found');
    await this.prisma.posIntegration.delete({ where: { id: row.id } });
  }

  /** Returns one DTO per provider connected for the brand, with the latest job inlined. */
  async getStatus(user: AuthenticatedUser, brandId?: string): Promise<PosIntegrationDto[]> {
    const targetBrandId = await this.resolveBrandId(user, brandId);
    const rows = await this.prisma.posIntegration.findMany({
      where: { brandId: targetBrandId },
      orderBy: { createdAt: 'asc' },
      include: { jobs: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    return rows.map((r) => this.toIntegrationDto(r, r.jobs[0] ?? null));
  }

  async listJobs(user: AuthenticatedUser, provider: PosProvider, brandId?: string): Promise<PosSyncJobDto[]> {
    const targetBrandId = await this.resolveBrandId(user, brandId);
    const integration = await this.prisma.posIntegration.findUnique({
      where: { brandId_provider: { brandId: targetBrandId, provider } },
      select: { id: true },
    });
    if (!integration) throw new NotFoundException('Integration not found');
    const rows = await this.prisma.posSyncJob.findMany({
      where: { integrationId: integration.id },
      orderBy: { createdAt: 'desc' },
      take: JOB_HISTORY_LIMIT,
    });
    return rows.map((r) => this.toJobDto(r));
  }

  /**
   * Enqueues a MENU or STOP_LIST sync. Returns the freshly-created
   * PosSyncJob row so the UI can subscribe to its progress.
   */
  async enqueueSync(
    user: AuthenticatedUser,
    provider: PosProvider,
    kind: Extract<PosSyncJobKind, 'MENU' | 'STOP_LIST'>,
    brandId?: string,
  ): Promise<PosSyncJobDto> {
    const targetBrandId = await this.resolveBrandId(user, brandId);
    const integration = await this.prisma.posIntegration.findUnique({
      where: { brandId_provider: { brandId: targetBrandId, provider } },
      select: { id: true, status: true },
    });
    if (!integration) throw new NotFoundException('Integration not found');
    if (integration.status !== PosIntegrationStatus.CONNECTED) {
      throw new ConflictException('Integration is not connected — reconnect it first');
    }

    const job = await this.prisma.posSyncJob.create({
      data: {
        integrationId: integration.id,
        kind,
        status: PosSyncJobStatus.PENDING,
      },
    });

    await this.queue.add(
      kind,
      { syncJobId: job.id, integrationId: integration.id, kind },
      { priority: MENU_SYNC_PRIORITY, removeOnComplete: 1000, removeOnFail: 1000 },
    );

    return this.toJobDto(job);
  }

  /**
   * Decrypt and re-shape a PosIntegration row into the context handed to
   * an IPosProvider. Used by the BullMQ worker — kept on the service so
   * tests don't need to duplicate the cipher plumbing.
   */
  async loadIntegrationCtx(integrationId: string): Promise<PosIntegrationCtx> {
    const row = await this.prisma.posIntegration.findUnique({ where: { id: integrationId } });
    if (!row) throw new NotFoundException('Integration not found');
    const credentials = this.cipher.decryptJson<PosCredentials>(row.credentialsCiphertext);
    const settings = (row.settings ?? {}) as PosSettings;
    return { row, credentials, settings };
  }

  /**
   * Validates and tags a raw credentials object against {@link PosCredentials}.
   * The DTO accepts a free-form `Record<string, string>` so we have to enforce
   * provider-specific shape here.
   */
  private shapeCredentials(provider: PosProvider, raw: Record<string, string>): PosCredentials {
    if (provider === PosProvider.IIKO) {
      const apiLogin = raw['apiLogin']?.trim();
      if (!apiLogin) throw new BadRequestException('IIKO credentials require { apiLogin }');
      return { kind: 'IIKO', apiLogin } satisfies IikoCredentials;
    }
    const token = raw['token']?.trim();
    const accountName = raw['accountName']?.trim();
    if (!token || !accountName) {
      throw new BadRequestException('Poster credentials require { token, accountName }');
    }
    return { kind: 'POSTER', token, accountName } satisfies PosterCredentials;
  }

  /**
   * BRAND_ADMIN's scope contains exactly one brand — we use it directly
   * and ignore any explicit `brandId`. SUPER_ADMIN must pass `brandId` or
   * we have no way to know which tenant they meant.
   */
  private async resolveBrandId(user: AuthenticatedUser, brandIdHint?: string): Promise<string> {
    const scope = await this.scope.resolveBrandIds(user);
    if (scope === null) {
      if (user.role !== Role.SUPER_ADMIN) throw new ForbiddenException('Forbidden');
      if (!brandIdHint) throw new BadRequestException('SUPER_ADMIN must pass brandId');
      return brandIdHint;
    }
    const first = scope[0];
    if (!first) throw new ForbiddenException('No brand in your scope');
    if (brandIdHint && !scope.includes(brandIdHint)) {
      throw new ForbiddenException('Brand belongs to a scope outside yours');
    }
    return brandIdHint ?? first;
  }

  private toIntegrationDto(
    row: PosIntegration,
    lastJob: {
      id: string;
      kind: PosSyncJobKind;
      status: PosSyncJobStatus;
      progress: number;
      total: number;
      errorMessage: string | null;
      createdAt: Date;
      startedAt: Date | null;
      finishedAt: Date | null;
    } | null,
  ): PosIntegrationDto {
    return {
      id: row.id,
      brandId: row.brandId,
      provider: row.provider,
      status: row.status,
      settings: (row.settings ?? {}) as Record<string, unknown>,
      lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
      lastErrorMessage: row.lastErrorMessage,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      lastJob: lastJob ? this.toJobDto(lastJob) : null,
    };
  }

  private toJobDto(row: {
    id: string;
    kind: PosSyncJobKind;
    status: PosSyncJobStatus;
    progress: number;
    total: number;
    errorMessage: string | null;
    createdAt: Date;
    startedAt: Date | null;
    finishedAt: Date | null;
  }): PosSyncJobDto {
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      progress: row.progress,
      total: row.total,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
    };
  }

  /** Used by the BullMQ worker to advance a sync job's progress. */
  async _markJobRunning(syncJobId: string): Promise<void> {
    await this.prisma.posSyncJob.update({
      where: { id: syncJobId },
      data: { status: PosSyncJobStatus.RUNNING, startedAt: new Date() },
    });
  }

  async _markJobCompleted(syncJobId: string, integrationId: string): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.posSyncJob.update({
        where: { id: syncJobId },
        data: { status: PosSyncJobStatus.COMPLETED, finishedAt: now, errorMessage: null },
      }),
      this.prisma.posIntegration.update({
        where: { id: integrationId },
        data: { lastSyncAt: now, lastErrorMessage: null, status: PosIntegrationStatus.CONNECTED },
      }),
    ]);
  }

  async _markJobFailed(syncJobId: string, integrationId: string, message: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.posSyncJob.update({
        where: { id: syncJobId },
        data: { status: PosSyncJobStatus.FAILED, finishedAt: new Date(), errorMessage: message },
      }),
      this.prisma.posIntegration.update({
        where: { id: integrationId },
        data: { lastErrorMessage: message, status: PosIntegrationStatus.ERROR },
      }),
    ]);
  }

  async _setJobProgress(syncJobId: string, progress: number, total?: number): Promise<void> {
    await this.prisma.posSyncJob.update({
      where: { id: syncJobId },
      data: total !== undefined ? { progress, total } : { progress },
    });
  }
}
