import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { AnalyticsScopeResolver } from '../analytics/analytics-scope';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { RequiresPlanFeature } from '../plans/plan-feature.guard';
import { CustomersService } from './customers.service';
import { CustomerDetailDto, CustomerPageDto, CustomerScopeQueryDto, CustomersQueryDto } from './dto/customers.dto';

/** The business's customers and each one's history with it — a PRO feature. */
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
    const scope = await this.scopes.resolve(user, query.brandId, query.storeId);
    return this.customers.list(scope, query);
  }

  @Get(':id')
  @ApiOkResponse({ type: CustomerDetailDto })
  async detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: CustomerScopeQueryDto,
  ): Promise<CustomerDetailDto> {
    const scope = await this.scopes.resolve(user, query.brandId, query.storeId);
    return this.customers.detail(scope, id);
  }
}
