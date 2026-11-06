import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { Public } from './decorators/public.decorator';
import { PasswordForgotDto, PasswordForgotResponseDto } from './dto/password-forgot.dto';
import { PasswordResetDto } from './dto/password-reset.dto';
import { PasswordResetService } from './services/password-reset.service';

// Same dev multiplier as the other auth routes, so iterating locally does
// not keep hitting the 429.
const IS_DEV = process.env['NODE_ENV'] !== 'production';
const DEV_MULTIPLIER = IS_DEV ? 10 : 1;
const limits = {
  // Per client; each account also gets at most one link a minute
  // (PasswordResetService), whoever asks for it.
  passwordForgot: 3 * DEV_MULTIPLIER,
  passwordReset: 10 * DEV_MULTIPLIER,
};

/** «Забыли пароль?» for staff: ask for a one-time link, then set a new password with it. */
@ApiTags('auth')
@Controller('auth/password')
export class PasswordResetController {
  constructor(private readonly passwordReset: PasswordResetService) {}

  /**
   * Sends a one-time link to the account's email and to the Telegram chat
   * it linked, whichever it has. `identifier` is an email or a staff login.
   * The answer is the same for every identifier and only lists what this
   * server can send through; 503 `PASSWORD_RESET_UNAVAILABLE` when it can
   * send through nothing.
   */
  @Public()
  @Post('forgot')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: limits.passwordForgot, ttl: 60_000 } })
  @ApiOkResponse({ type: PasswordForgotResponseDto })
  @ApiTooManyRequestsResponse({ description: 'Too many requests from this client' })
  @ApiServiceUnavailableResponse({ description: 'PASSWORD_RESET_UNAVAILABLE — no SMTP and no Telegram bot' })
  forgot(@Body() dto: PasswordForgotDto): Promise<PasswordForgotResponseDto> {
    return this.passwordReset.request(dto.identifier ?? dto.email ?? '');
  }

  /** Sets the new password from the link (email or Telegram — the same token) and signs out every session. */
  @Public()
  @Post('reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: limits.passwordReset, ttl: 60_000 } })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ description: 'The link was used already or ran out' })
  async reset(@Body() dto: PasswordResetDto): Promise<void> {
    await this.passwordReset.reset(dto.token, dto.newPassword);
  }
}
