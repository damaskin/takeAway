import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

interface TrackedRequest {
  ip?: string;
  user?: { id?: string };
}

/**
 * Whose budget a request spends.
 *
 * Signed in, it is the account's: the global guards run in order, so by the
 * time this one runs the JWT guard has already put the user on the request.
 * A whole office or mobile carrier behind one address then no longer shares
 * one limit, and an account cannot reset its limit by changing networks.
 *
 * Signed out (login, registration, public previews), it is the client
 * address. `request.ip` is only trustworthy because Fastify trusts exactly
 * our own nginx hop, and nginx sets X-Forwarded-For from Cloudflare's
 * CF-Connecting-IP rather than appending to what the client sent — see
 * common/http/trust-proxy.ts and deploy/nginx/snippets/api-proxy.conf.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    return throttleTracker(req as TrackedRequest);
  }
}

export function throttleTracker(req: TrackedRequest): string {
  const userId = req.user?.id;
  if (typeof userId === 'string' && userId) return `user:${userId}`;
  return `ip:${req.ip ?? 'unknown'}`;
}
