import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { Public } from '../auth/decorators/public.decorator';
import { BusinessService } from './business.service';
import { BusinessRegisterResponseDto } from './dto/business-register-response.dto';
import { BusinessRegisterDto } from './dto/business-register.dto';

const IS_DEV = process.env['NODE_ENV'] !== 'production';
const DEV_MULTIPLIER = IS_DEV ? 10 : 1;

@ApiTags('business')
@Controller('business')
export class BusinessController {
  constructor(private readonly business: BusinessService) {}

  /**
   * Public self-serve business signup. Creates a Brand (PENDING moderation)
   * + a BRAND_ADMIN user + returns an auth session so the owner lands
   * straight in the admin panel.
   */
  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5 * DEV_MULTIPLIER, ttl: 60_000 } })
  @ApiCreatedResponse({ type: BusinessRegisterResponseDto })
  register(@Body() dto: BusinessRegisterDto): Promise<BusinessRegisterResponseDto> {
    return this.business.register(dto);
  }
}
