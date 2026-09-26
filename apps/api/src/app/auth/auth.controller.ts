import {
  Body,
  Controller,
  ConflictException,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { SignInMethodsService } from './services/sign-in-methods.service';
import { TelegramService } from './services/telegram.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { AuthSessionDto, AuthTokensDto, AuthUserDto } from './dto/auth-response.dto';
import { KdsPinLoginDto } from './dto/kds-pin-login.dto';
import { PasswordChangeSelfDto } from './dto/password-change-self.dto';
import { PasswordForgotDto } from './dto/password-forgot.dto';
import { PasswordLoginDto } from './dto/password-login.dto';
import { PasswordResetDto } from './dto/password-reset.dto';
import { NotificationPrefsDto, UpdateNotificationPrefsDto } from './dto/notification-prefs.dto';
import { OAuthLoginDto } from './dto/oauth-login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { LinkSignInMethodResultDto, SignInMethodsDto } from './dto/sign-in-methods.dto';
import { TelegramAuthDto } from './dto/telegram-auth.dto';
import { TelegramConfigDto } from './dto/telegram-config.dto';
import { TelegramIdTokenDto } from './dto/telegram-id-token.dto';
import { TelegramWidgetAuthDto } from './dto/telegram-widget.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import type { AuthenticatedUser } from './strategies/jwt.strategy';

// Per-route throttle limits. Dev gets a 10× multiplier so iterating on login
// flows locally doesn't keep hitting the 429.
const IS_DEV = process.env['NODE_ENV'] !== 'production';
const DEV_MULTIPLIER = IS_DEV ? 10 : 1;
const limits = {
  passwordLogin: 10 * DEV_MULTIPLIER,
  passwordForgot: 3 * DEV_MULTIPLIER,
  passwordReset: 10 * DEV_MULTIPLIER,
  telegram: 20 * DEV_MULTIPLIER,
  refresh: 20 * DEV_MULTIPLIER,
  // PIN auth on a shared tablet — generous enough for a clumsy barista, tight
  // enough that brute-forcing 10⁴ combos still trips the per-IP limiter long
  // before it lands.
  kdsPin: 8 * DEV_MULTIPLIER,
  // Social sign-in. A failed attempt costs us a JWKS lookup at worst, but
  // the endpoint mints sessions, so keep it in the same band as Telegram.
  oauth: 20 * DEV_MULTIPLIER,
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly signInMethods: SignInMethodsService,
  ) {}

  @Public()
  @Post('password/login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: limits.passwordLogin, ttl: 60_000 } })
  @ApiOkResponse({ type: AuthSessionDto })
  passwordLogin(@Body() dto: PasswordLoginDto): Promise<AuthSessionDto> {
    return this.auth.loginWithPassword(dto.email, dto.password);
  }

  /**
   * KDS lockscreen PIN login. Rate-limited per-IP — production allows
   * 8 attempts per minute, which is plenty for a real barista mistyping
   * once or twice and a brute-forcer can't enumerate 10⁴–10⁶ PINs through
   * it before the per-IP limiter trips.
   */
  @Public()
  @Post('kds/pin')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: limits.kdsPin, ttl: 60_000 } })
  @ApiOkResponse({ type: AuthSessionDto })
  kdsPinLogin(@Body() dto: KdsPinLoginDto): Promise<AuthSessionDto> {
    return this.auth.loginWithKdsPin(dto.storeId, dto.pin);
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: limits.passwordForgot, ttl: 60_000 } })
  @ApiNoContentResponse()
  async passwordForgot(@Body() dto: PasswordForgotDto): Promise<void> {
    await this.auth.requestPasswordReset(dto.email);
  }

  @Public()
  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: limits.passwordReset, ttl: 60_000 } })
  @ApiNoContentResponse()
  async passwordReset(@Body() dto: PasswordResetDto): Promise<void> {
    await this.auth.resetPassword(dto.token, dto.newPassword);
  }

  /**
   * Self-service password change. Used by the admin / KDS 'change your
   * temp password' flow after an invited staff signs in for the first
   * time. Requires the current password and replaces the stored hash.
   */
  @Post('password/change')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiNoContentResponse()
  async passwordChangeSelf(@CurrentUser() user: AuthenticatedUser, @Body() dto: PasswordChangeSelfDto): Promise<void> {
    await this.auth.changeOwnPassword(user.id, dto.currentPassword, dto.newPassword);
  }

  @Public()
  @Post('telegram')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: limits.telegram, ttl: 60_000 } })
  @ApiOkResponse({ type: AuthSessionDto })
  verifyTelegram(@Body() dto: TelegramAuthDto): Promise<AuthSessionDto> {
    return this.auth.verifyTelegram(dto.initData);
  }

  /**
   * Customer sign-in with Google. The client runs Google Identity Services,
   * which hands back a `credential` — that is the ID token we expect here.
   */
  @Public()
  @Post('google')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: limits.oauth, ttl: 60_000 } })
  @ApiOkResponse({ type: AuthSessionDto })
  signInWithGoogle(@Body() dto: OAuthLoginDto): Promise<AuthSessionDto> {
    return this.auth.loginWithOAuth('GOOGLE', dto.idToken);
  }

  /**
   * Customer sign-in with Apple. `name` is only ever populated on the very
   * first consent — Apple never repeats it, so the client forwards it once
   * and we persist it then or not at all.
   */
  @Public()
  @Post('apple')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: limits.oauth, ttl: 60_000 } })
  @ApiOkResponse({ type: AuthSessionDto })
  signInWithApple(@Body() dto: OAuthLoginDto): Promise<AuthSessionDto> {
    return this.auth.loginWithOAuth('APPLE', dto.idToken, dto.name);
  }

  /**
   * What a client needs to start Telegram sign-in: the Telegram Login client
   * id (the bot's numeric id) for the OpenID Connect flow, and the bot
   * username for the legacy widget.
   */
  @Public()
  @Get('telegram/config')
  @ApiOkResponse({ type: TelegramConfigDto })
  telegramConfig(): TelegramConfigDto {
    return this.telegram.publicConfig();
  }

  /**
   * Customer sign-in with Telegram Login (OpenID Connect). The web library's
   * popup and the mobile apps both finish with an ID token signed by
   * `oauth.telegram.org`; it is checked against Telegram's JWKS, issuer and
   * our client id before a single claim is trusted.
   */
  @Public()
  @Post('telegram/oidc')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: limits.telegram, ttl: 60_000 } })
  @ApiOkResponse({ type: AuthSessionDto })
  signInWithTelegramIdToken(@Body() dto: TelegramIdTokenDto): Promise<AuthSessionDto> {
    return this.auth.loginWithTelegramIdToken(dto.idToken);
  }

  /**
   * Legacy Telegram Login Widget entry-point (different wire shape from Mini
   * App init-data), verified by HMAC against the bot token. Kept while a
   * deployment has not registered its site for Telegram Login yet, and for
   * the developer sign-in of local builds.
   */
  @Public()
  @Post('telegram/widget')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: limits.telegram, ttl: 60_000 } })
  @ApiOkResponse({ type: AuthSessionDto })
  verifyTelegramWidget(@Body() dto: TelegramWidgetAuthDto): Promise<AuthSessionDto> {
    return this.auth.verifyTelegramWidget(dto);
  }

  /**
   * Link Telegram to an already-authenticated staff account so they can
   * receive order-event push notifications. Same widget payload shape as
   * the sign-in path, but scoped to the current user instead of creating
   * a new session.
   */
  @Post('telegram/link')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: limits.telegram, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOkResponse({ type: AuthUserDto })
  linkTelegram(@CurrentUser() user: AuthenticatedUser, @Body() dto: TelegramWidgetAuthDto): Promise<AuthUserDto> {
    return this.auth.linkTelegram(user.id, dto);
  }

  /** Link Telegram to the signed-in staff account from a Telegram Login ID token. */
  @Post('telegram/link/oidc')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: limits.telegram, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOkResponse({ type: AuthUserDto })
  linkTelegramIdToken(@CurrentUser() user: AuthenticatedUser, @Body() dto: TelegramIdTokenDto): Promise<AuthUserDto> {
    return this.auth.linkTelegramIdToken(user.id, dto.idToken);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: limits.refresh, ttl: 60_000 } })
  @ApiOkResponse({ type: AuthTokensDto })
  refresh(@Body() dto: RefreshDto): Promise<AuthTokensDto> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOkResponse({ type: AuthUserDto })
  async me(@CurrentUser() user: AuthenticatedUser): Promise<AuthUserDto> {
    const dbUser = await this.users.findById(user.id);
    if (!dbUser) {
      throw new NotFoundException('User not found');
    }
    return this.auth.toAuthUser(dbUser);
  }

  /** Which of Telegram, Google and Apple lead into the signed-in customer's profile. */
  @Get('me/sign-in-methods')
  @ApiBearerAuth()
  @ApiOkResponse({ type: SignInMethodsDto })
  mySignInMethods(@CurrentUser() user: AuthenticatedUser): Promise<SignInMethodsDto> {
    return this.signInMethods.list(user.id);
  }

  /**
   * Add Google to the signed-in customer's profile. When the Google account
   * already has a profile with orders and this one has none, the customer is
   * moved into that profile and the response carries a new `session`.
   */
  @Post('me/sign-in-methods/google')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: limits.oauth, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOkResponse({ type: LinkSignInMethodResultDto })
  linkGoogle(@CurrentUser() user: AuthenticatedUser, @Body() dto: OAuthLoginDto): Promise<LinkSignInMethodResultDto> {
    return this.signInMethods.linkOAuth(user.id, 'GOOGLE', dto.idToken);
  }

  /** Add Apple to the signed-in customer's profile; same rules as Google. */
  @Post('me/sign-in-methods/apple')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: limits.oauth, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOkResponse({ type: LinkSignInMethodResultDto })
  linkApple(@CurrentUser() user: AuthenticatedUser, @Body() dto: OAuthLoginDto): Promise<LinkSignInMethodResultDto> {
    return this.signInMethods.linkOAuth(user.id, 'APPLE', dto.idToken, dto.name);
  }

  /** Add Telegram (Telegram Login ID token) to the signed-in customer's profile. */
  @Post('me/sign-in-methods/telegram')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: limits.telegram, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOkResponse({ type: LinkSignInMethodResultDto })
  linkTelegramMethod(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TelegramIdTokenDto,
  ): Promise<LinkSignInMethodResultDto> {
    return this.signInMethods.linkTelegram(user.id, dto.idToken);
  }

  /** Remove Google or Apple. Refused when it is the profile's last way in. */
  @Delete('me/sign-in-methods/:provider')
  @ApiBearerAuth()
  @ApiOkResponse({ type: SignInMethodsDto })
  unlinkSignInMethod(
    @CurrentUser() user: AuthenticatedUser,
    @Param('provider', new ParseEnumPipe({ google: 'GOOGLE', apple: 'APPLE' })) provider: 'GOOGLE' | 'APPLE',
  ): Promise<SignInMethodsDto> {
    return this.signInMethods.unlink(user.id, provider);
  }

  @Get('me/notifications')
  @ApiBearerAuth()
  @ApiOkResponse({ type: NotificationPrefsDto })
  async myNotifications(@CurrentUser() user: AuthenticatedUser): Promise<NotificationPrefsDto> {
    const row = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { notifyOrderUpdates: true, notifyPromotions: true },
    });
    if (!row) throw new NotFoundException('User not found');
    return row;
  }

  @Patch('me/notifications')
  @ApiBearerAuth()
  @ApiOkResponse({ type: NotificationPrefsDto })
  async updateMyNotifications(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateNotificationPrefsDto,
  ): Promise<NotificationPrefsDto> {
    const data: Record<string, boolean> = {};
    if (dto.notifyOrderUpdates !== undefined) data['notifyOrderUpdates'] = dto.notifyOrderUpdates;
    if (dto.notifyPromotions !== undefined) data['notifyPromotions'] = dto.notifyPromotions;
    const row = await this.prisma.user.update({
      where: { id: user.id },
      data,
      select: { notifyOrderUpdates: true, notifyPromotions: true },
    });
    return row;
  }

  @Patch('me')
  @ApiBearerAuth()
  @ApiOkResponse({ type: AuthUserDto })
  async updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto): Promise<AuthUserDto> {
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data['name'] = dto.name;
    if (dto.phone !== undefined) data['phone'] = dto.phone;
    if (dto.email !== undefined) data['email'] = dto.email.toLowerCase();
    if (dto.dateOfBirth !== undefined) data['dateOfBirth'] = new Date(dto.dateOfBirth);
    if (dto.locale !== undefined) data['locale'] = dto.locale;
    if (dto.currency !== undefined) data['currency'] = dto.currency;

    try {
      const updated = await this.prisma.user.update({ where: { id: user.id }, data });
      return this.auth.toAuthUser(updated);
    } catch (err) {
      if (err instanceof Error && 'code' in err && (err as { code?: string }).code === 'P2002') {
        throw new ConflictException('Email or phone already in use');
      }
      throw err;
    }
  }
}
