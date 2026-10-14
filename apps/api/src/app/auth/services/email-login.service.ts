import { HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Locale, Role } from '@prisma/client';

import { loginCodeMail } from '../../mail/login-code.mail';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth.service';
import type { AuthSessionDto } from '../dto/auth-response.dto';
import { EMAIL_CODE_TTL_SECONDS, EmailCodeService } from './email-code.service';
import { TokensService } from './tokens.service';

/**
 * Customer sign-in with a one-time code mailed to them — for customers
 * without Telegram or a Google / Apple account (mail.ru and the like).
 *
 * `start` mails a code to any well-formed address and answers the same
 * either way, so it tells nobody whether a profile exists. `verify` turns
 * the code into a session, resolving the account by the same rules as a
 * Google sign-in with a verified address (AuthService.finalizeOAuthSignIn):
 *
 *   1. A customer whose address is *proven* (`emailVerifiedAt`) — by an
 *      earlier code, Google or Apple — is signed in.
 *   2. A customer who only typed the address into their profile does not
 *      get this session: the address moves to a new profile, as with Google,
 *      so nobody can plant a victim's address and wait.
 *   3. A staff or admin account is refused (401
 *      `EMAIL_LOGIN_STAFF_ACCOUNT`): those sign in with a password, and the
 *      customer flow must never open one.
 *   4. Otherwise a new customer with the address proven.
 *
 * Without SMTP the whole flow answers 503 `EMAIL_LOGIN_UNAVAILABLE`, and
 * `GET /auth/methods` tells the clients to hide it.
 */
@Injectable()
export class EmailLoginService {
  private readonly logger = new Logger(EmailLoginService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly codes: EmailCodeService,
    private readonly tokens: TokensService,
    private readonly auth: AuthService,
  ) {}

  /** True when this server can mail codes, i.e. SMTP is configured. */
  isAvailable(): boolean {
    return this.mail.isConfigured();
  }

  async start(email: string, locale?: string): Promise<void> {
    this.assertAvailable();
    const address = normalizeEmail(email);
    const language = locale?.toLowerCase().startsWith('ru') ? Locale.RU : Locale.EN;
    const code = await this.codes.issue(address, { locale: language });

    const sent = await this.mail.sendLoginCode(
      address,
      loginCodeMail({
        code,
        language: language === Locale.RU ? 'ru' : 'en',
        ttlMinutes: EMAIL_CODE_TTL_SECONDS / 60,
      }),
    );
    if (!sent) {
      await this.codes.withdraw(address);
      throw new HttpException(
        {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          error: 'Service Unavailable',
          code: 'EMAIL_CODE_NOT_SENT',
          message: 'The email with the code could not be sent — try again in a few minutes',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async verify(email: string, code: string): Promise<AuthSessionDto> {
    this.assertAvailable();
    const address = normalizeEmail(email);
    const { locale } = await this.codes.consume(address, code);
    const now = new Date();

    const user = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email: address } });
      if (existing) {
        if (existing.role !== Role.CUSTOMER) {
          throw new UnauthorizedException({
            statusCode: HttpStatus.UNAUTHORIZED,
            error: 'Unauthorized',
            code: 'EMAIL_LOGIN_STAFF_ACCOUNT',
            message: 'This email belongs to a staff account — sign in with your password',
          });
        }
        if (existing.emailVerifiedAt) return existing;
        // Only typed in over there, never proven: release it.
        await tx.user.update({ where: { id: existing.id }, data: { email: null } });
        this.logger.warn(
          `Email-code sign-in proved an email that profile ${existing.id} had only typed in; ` +
            'the address moved to a new profile instead of joining that one',
        );
      }
      return tx.user.create({ data: { email: address, emailVerifiedAt: now, locale } });
    });

    if (user.blockedAt) throw new UnauthorizedException('Account is blocked');

    const device = await this.prisma.device.create({
      data: { userId: user.id, type: 'WEB', locale: user.locale },
    });
    const tokens = await this.tokens.issue(user.id, device.id);
    return { ...tokens, user: this.auth.toAuthUser(user) };
  }

  private assertAvailable(): void {
    if (this.mail.isConfigured()) return;
    throw new HttpException(
      {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        error: 'Service Unavailable',
        code: 'EMAIL_LOGIN_UNAVAILABLE',
        message: 'Sign-in by email is not available on this server',
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

/** Addresses are stored lower-cased (see PATCH /auth/me and the social sign-ins). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
