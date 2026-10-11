import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { IS_PUBLIC_KEY, OPTIONAL_AUTH_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    if (isPublic) {
      // `@OptionalAuth()`: a caller who sends a token is who the token says.
      const optional = this.reflector.getAllAndOverride<boolean>(OPTIONAL_AUTH_KEY, targets);
      if (!optional || !hasBearerToken(context)) return true;
    }
    return super.canActivate(context) as boolean | Promise<boolean>;
  }
}

function hasBearerToken(context: ExecutionContext): boolean {
  const request = context.switchToHttp().getRequest<{ headers?: Record<string, unknown> }>();
  const header = request.headers?.['authorization'];
  return typeof header === 'string' && /^bearer\s+\S/i.test(header);
}
