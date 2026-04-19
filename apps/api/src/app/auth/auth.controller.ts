import { Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { AuthSessionDto, AuthTokensDto, AuthUserDto } from './dto/auth-response.dto';
import { PasswordForgotDto } from './dto/password-forgot.dto';
import { PasswordLoginDto } from './dto/password-login.dto';
import { PasswordResetDto } from './dto/password-reset.dto';
import { RefreshDto } from './dto/refresh.dto';
import { TelegramAuthDto } from './dto/telegram-auth.dto';
import { TelegramWidgetAuthDto } from './dto/telegram-widget.dto';
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
}
