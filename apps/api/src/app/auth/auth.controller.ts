import { Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { AuthSessionDto, AuthTokensDto, AuthUserDto, SendOtpResponseDto } from './dto/auth-response.dto';
import { RefreshDto } from './dto/refresh.dto';
import { SendOtpDto } from './dto/send-otp.dto';
import { TelegramAuthDto } from './dto/telegram-auth.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import type { AuthenticatedUser } from './strategies/jwt.strategy';

// Per-route throttle limits. Dev gets a 10× multiplier so that local login
// iteration doesn't blow through the strict production OTP cap (5 sends/min).
// The OTP per-phone rate-limit inside OtpService is the real abuse defense;
// these decorators are just a per-IP belt-and-braces layer.
const IS_DEV = process.env['NODE_ENV'] !== 'production';
const DEV_MULTIPLIER = IS_DEV ? 10 : 1;
const limits = {
  otpSend: 5 * DEV_MULTIPLIER,
  otpVerify: 10 * DEV_MULTIPLIER,
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
  @Post('otp/send')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: limits.otpSend, ttl: 60_000 } })
  @ApiOkResponse({ type: SendOtpResponseDto })
  sendOtp(@Body() dto: SendOtpDto): Promise<SendOtpResponseDto> {
    return this.auth.sendOtp(dto.phone);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: limits.otpVerify, ttl: 60_000 } })
  @ApiOkResponse({ type: AuthSessionDto })
  verifyOtp(@Body() dto: VerifyOtpDto): Promise<AuthSessionDto> {
    return this.auth.verifyOtp(dto);
  }

  @Public()
  @Post('telegram')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: limits.telegram, ttl: 60_000 } })
  @ApiOkResponse({ type: AuthSessionDto })
  verifyTelegram(@Body() dto: TelegramAuthDto): Promise<AuthSessionDto> {
    return this.auth.verifyTelegram(dto.initData);
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
