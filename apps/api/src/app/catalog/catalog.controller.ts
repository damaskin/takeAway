import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { Public } from '../auth/decorators/public.decorator';
import { CatalogService } from './catalog.service';
import { ListStoresQueryDto } from './dto/list-stores-query.dto';
import { MenuDto, ProductDetailDto } from './dto/product.dto';
import { StoreDetailDto, StoreListItemDto } from './dto/store.dto';

@ApiTags('catalog')
@Controller()
@Public()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('stores')
  @ApiOkResponse({ type: StoreListItemDto, isArray: true })
  listStores(@Query() query: ListStoresQueryDto): Promise<StoreListItemDto[]> {
    return this.catalog.listStores(query);
  }

  @Get('stores/:idOrSlug')
  @ApiOkResponse({ type: StoreDetailDto })
  getStore(@Param('idOrSlug') idOrSlug: string): Promise<StoreDetailDto> {
    return this.catalog.getStore(idOrSlug);
  }

  @Get('stores/:idOrSlug/menu')
  @ApiOkResponse({ type: MenuDto })
  getStoreMenu(@Param('idOrSlug') idOrSlug: string): Promise<MenuDto> {
    return this.catalog.getMenu(idOrSlug);
  }

  @Get('products/:idOrSlug')
  @ApiOkResponse({ type: ProductDetailDto })
  getProduct(@Param('idOrSlug') idOrSlug: string): Promise<ProductDetailDto> {
    return this.catalog.getProduct(idOrSlug);
  }
}
