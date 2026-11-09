import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { CatalogGroup, CatalogOption } from '@takeaway/shared-types';

import { Roles } from '../../auth/decorators/roles.decorator';
import { AdminOptionCatalogService } from './admin-option-catalog.service';
import {
  CatalogGroupDto,
  CatalogOptionDto,
  CreateCatalogGroupDto,
  CreateCatalogOptionDto,
  UpdateCatalogGroupDto,
  UpdateCatalogOptionDto,
} from './dto/admin-options.dto';

/**
 * The platform's options catalog («Добавки и варианты», docs/option-groups.md):
 * groups and their options, for every brand. The takeAway team only.
 *
 * Errors: 400 OPTION_GROUP_INVALID (type D, a variant counter, min/max on B
 * or C, min above max, a counter outside 0 ≤ min ≤ default ≤ max ≤ 20, a
 * condition on the group's own option); 409 OPTION_NAME_TAKEN; 409
 * OPTION_GROUP_IN_USE (delete of a group attached to a product).
 */
@ApiTags('admin: option catalog')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN)
@Controller('admin/option-groups')
export class AdminOptionGroupsController {
  constructor(private readonly catalog: AdminOptionCatalogService) {}

  @Get()
  @ApiOkResponse({ type: CatalogGroupDto, isArray: true })
  list(): Promise<CatalogGroup[]> {
    return this.catalog.list();
  }

  @Post()
  @ApiCreatedResponse({ type: CatalogGroupDto })
  create(@Body() dto: CreateCatalogGroupDto): Promise<CatalogGroup> {
    return this.catalog.createGroup(dto);
  }

  @Patch(':id')
  @ApiOkResponse({ type: CatalogGroupDto })
  update(@Param('id') id: string, @Body() dto: UpdateCatalogGroupDto): Promise<CatalogGroup> {
    return this.catalog.updateGroup(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string): Promise<void> {
    await this.catalog.deleteGroup(id);
  }

  @Post(':id/options')
  @ApiCreatedResponse({ type: CatalogOptionDto })
  createOption(@Param('id') groupId: string, @Body() dto: CreateCatalogOptionDto): Promise<CatalogOption> {
    return this.catalog.createOption(groupId, dto);
  }
}

@ApiTags('admin: option catalog')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN)
@Controller('admin/option-items')
export class AdminOptionItemsController {
  constructor(private readonly catalog: AdminOptionCatalogService) {}

  @Patch(':id')
  @ApiOkResponse({ type: CatalogOptionDto })
  update(@Param('id') id: string, @Body() dto: UpdateCatalogOptionDto): Promise<CatalogOption> {
    return this.catalog.updateOption(id, dto);
  }

  /** Takes its brand prices, store stops and product overrides with it. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string): Promise<void> {
    await this.catalog.deleteOption(id);
  }
}
