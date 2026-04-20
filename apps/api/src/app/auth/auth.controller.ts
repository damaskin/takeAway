import {
  Body,
  Controller,
  ConflictException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { AuthSessionDto, AuthTokensDto, AuthUserDto } from './dto/auth-response.dto';
import { PasswordChangeSelfDto } from './dto/password-change-self.dto';
import { PasswordForgotDto } from './dto/password-forgot.dto';
import { PasswordLoginDto } from './dto/password-login.dto';
import { PasswordResetDto } from './dto/password-reset.dto';
import { NotificationPrefsDto, UpdateNotificationPrefsDto } from './dto/notification-prefs.dto';
import { RefreshDto } from './dto/refresh.dto';
import { TelegramAuthDto } from './dto/telegram-auth.dto';
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
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Post('password/login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: limits.passwordLogin, ttl: 60_000 } })
  @ApiOkResponse({ type: AuthSessionDto })
  passwordLogin(@Body() dto: PasswordLoginDto): Promise<AuthSessionDto> {
    return this.auth.loginWithPassword(dto.email, dto.password);
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
   * Telegram Login Widget entry-point (different wire shape from Mini App
   * init-data). Used by apps/web.
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
