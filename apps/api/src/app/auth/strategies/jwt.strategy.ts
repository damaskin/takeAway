import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { UsersService } from '../../users/users.service';

interface JwtPayload {
  sub: string;
  jti: string;
  /** Present on a kitchen PIN session: the one store it works. See TokensService.SessionScope. */
  kds?: string;
}

export interface AuthenticatedUser {
  id: string;
  phone: string | null;
  email: string | null;
  name: string | null;
  role: Role;
  /**
   * Set when the session was opened with a kitchen PIN: it reaches only the
   * endpoints marked `@KdsSessionAllowed()` and only this store
   * (KdsSessionGuard). Absent on an email + password session.
   */
  kdsStoreId?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly users: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET') ?? 'change-me-in-prod-access',
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.users.findById(payload.sub);
    if (!user || user.blockedAt) {
      throw new UnauthorizedException('User not found or blocked');
    }
    const authenticated: AuthenticatedUser = {
      id: user.id,
      phone: user.phone,
      email: user.email,
      name: user.name,
      role: user.role,
    };
    if (typeof payload.kds === 'string' && payload.kds) authenticated.kdsStoreId = payload.kds;
    return authenticated;
  }
}
