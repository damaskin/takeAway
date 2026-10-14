import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { Public } from './decorators/public.decorator';
import { AuthSessionDto } from './dto/auth-response.dto';
import { AuthMethodsDto, EmailLoginStartDto, EmailLoginVerifyDto } from './dto/email-login.dto';
import { EmailLoginService } from './services/email-login.service';
import { OAuthIdentityService } from './services/oauth-identity.service';
import { TelegramService } from './services/telegram.service';

// Same dev multiplier as the other auth routes, so iterating locally does
// not keep hitting the 429.
const IS_DEV = process.env['NODE_ENV'] !== 'production';
const DEV_MULTIPLIER = IS_DEV ? 10 : 1;
const limits = {
  // Each start mails a letter; the per-address pause and hourly limit sit
  // on top of this per-client one (EmailCodeService).
  emailStart: 5 * DEV_MULTIPLIER,
  // A code allows 5 wrong tries anyway; this keeps one client from cycling
  // through many addresses.
  emailVerify: 10 * DEV_MULTIPLIER,
};

/**
 * Customer sign-in with a code mailed to them, and which customer sign-in
 * methods this deployment offers. Kept apart from AuthController: these
 * routes only ever lead into customer profiles.
 */
@ApiTags('auth')
@Controller('auth')
export class EmailLoginController {
  constructor(
    private readonly emailLogin: EmailLoginService,
    private readonly oauth: OAuthIdentityService,
    private readonly telegram: TelegramService,
  ) {}

  /**
   * Which customer sign-in methods this server can complete. Public: the
   * sign-in screens read it to decide which buttons to show — email login
   * stays hidden until SMTP is configured.
   */
  @Public()
  @Get('methods')
  @ApiOkResponse({ type: AuthMethodsDto })
  methods(): AuthMethodsDto {
    return {
      email: this.emailLogin.isAvailable(),
      google: this.oauth.isConfigured('GOOGLE'),
      apple: this.oauth.isConfigured('APPLE'),
      telegram: this.telegram.publicConfig().clientId !== null,
    };
  }

  /**
   * Mail a six-digit sign-in code to the address, valid for 10 minutes. 204
   * for every well-formed address — whether it has a profile is never told.
   */
  @Public()
  @Post('email/start')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: limits.emailStart, ttl: 60_000 } })
  @ApiNoContentResponse({ description: 'The code is on its way' })
  @ApiTooManyRequestsResponse({
    description:
      'EMAIL_CODE_COOLDOWN — a code went to this address less than a minute ago; EMAIL_CODE_LIMIT — the hourly limit for the address. Both carry retryAfterSeconds.',
  })
  @ApiServiceUnavailableResponse({
    description:
      'EMAIL_LOGIN_UNAVAILABLE — no SMTP on this server; EMAIL_CODE_NOT_SENT — the mail server refused the letter',
  })
  async start(@Body() dto: EmailLoginStartDto): Promise<void> {
    await this.emailLogin.start(dto.email, dto.locale);
  }

  /** Exchange the code for a session — the same response as Google sign-in. */
  @Public()
  @Post('email/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: limits.emailVerify, ttl: 60_000 } })
  @ApiOkResponse({ type: AuthSessionDto })
  @ApiBadRequestResponse({
    description:
      'EMAIL_CODE_INVALID (with attemptsLeft), EMAIL_CODE_EXPIRED (none, timed out or used), EMAIL_CODE_TOO_MANY_ATTEMPTS (the code is gone)',
  })
  @ApiUnauthorizedResponse({ description: 'EMAIL_LOGIN_STAFF_ACCOUNT, or the account is blocked' })
  @ApiServiceUnavailableResponse({ description: 'EMAIL_LOGIN_UNAVAILABLE — no SMTP on this server' })
  verify(@Body() dto: EmailLoginVerifyDto): Promise<AuthSessionDto> {
    return this.emailLogin.verify(dto.email, dto.code);
  }
}
