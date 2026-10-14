import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { AnalyticsScopeResolver } from '../analytics/analytics-scope';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { RequiresPlanFeature } from '../plans/plan-feature.guard';
import { CustomersService } from './customers.service';
import { CustomerDetailDto, CustomerPageDto, CustomerScopeQueryDto, CustomersQueryDto } from './dto/customers.dto';

/**
 * The business's customers and each one's history with it — a PRO feature.
 * People are counted over every store of the brand, whatever it prices in —
 * the segments mean the same people as the campaign audiences. Spend is
 * revenue as everywhere in analytics (sales less discounts), in one
 * currency: when the stores price in several, the one asked for (`currency`)
 * or the brand's.
 */
@ApiTags('customers')
@ApiBearerAuth()
@Controller('admin/customers')
@Roles('BRAND_ADMIN', 'SUPER_ADMIN')
@RequiresPlanFeature('customers')
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly scopes: AnalyticsScopeResolver,
  ) {}

  @Get()
  @ApiOkResponse({ type: CustomerPageDto })
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: CustomersQueryDto): Promise<CustomerPageDto> {
    const { scope, currency, currencies } = await this.scopes.people(user, {
      brandId: query.brandId,
      storeId: query.storeId,
      currency: query.currency,
    });
    return this.customers.list(scope, query, new Date(), { currency, currencies });
  }

  @Get(':id')
  @ApiOkResponse({ type: CustomerDetailDto })
  async detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: CustomerScopeQueryDto,
  ): Promise<CustomerDetailDto> {
    const { scope, currency, currencies } = await this.scopes.people(user, {
      brandId: query.brandId,
      storeId: query.storeId,
      currency: query.currency,
    });
    return this.customers.detail(scope, id, new Date(), { currency, currencies });
  }
}
