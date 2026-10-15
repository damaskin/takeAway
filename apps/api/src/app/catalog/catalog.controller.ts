import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';

import { Public } from '../auth/decorators/public.decorator';
import { CatalogService } from './catalog.service';
import { ListStoresQueryDto } from './dto/list-stores-query.dto';
import { PickupSlotDto } from './dto/pickup-slot.dto';
import { MenuDto, ProductDetailDto } from './dto/product.dto';
import { StoreDetailDto, StoreListItemDto } from './dto/store.dto';
import { StoreSuggestionsDto, SuggestionsQueryDto } from './dto/suggestions.dto';
import { SuggestionsService } from './suggestions.service';

@ApiTags('catalog')
@Controller()
@Public()
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly suggestions: SuggestionsService,
  ) {}

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

  /**
   * Scheduled pickup windows for the next 24 hours — also while the shift is
   * closed. Checkout renders these instead of a free time field — a
   * customer can only ask for a time the kitchen can actually hit.
   */
  @Get('stores/:idOrSlug/pickup-slots')
  @ApiOkResponse({ type: PickupSlotDto, isArray: true })
  @ApiQuery({
    name: 'cartId',
    required: false,
    description: "The customer's cart at this store: a slot without room for its kitchen work comes back unavailable",
  })
  getPickupSlots(@Param('idOrSlug') idOrSlug: string, @Query('cartId') cartId?: string): Promise<PickupSlotDto[]> {
    return this.catalog.getPickupSlots(idOrSlug, cartId || undefined);
  }

  @Get('stores/:idOrSlug/menu')
  @ApiOkResponse({ type: MenuDto })
  getStoreMenu(@Param('idOrSlug') idOrSlug: string): Promise<MenuDto> {
    return this.catalog.getMenu(idOrSlug);
  }

  /**
   * What to offer next to the products in hand: the cart's lines, or the
   * product on screen. Ranked by what customers bought together when there
   * are enough orders for it (`source: copurchase`), else bakery and food
   * next to a drink (`source: rule`). Only in-stock products of this
   * store's menu.
   */
  @Get('stores/:idOrSlug/suggestions')
  @ApiOkResponse({ type: StoreSuggestionsDto })
  getSuggestions(
    @Param('idOrSlug') idOrSlug: string,
    @Query() query: SuggestionsQueryDto,
  ): Promise<StoreSuggestionsDto> {
    return this.suggestions.suggest(idOrSlug, query.productIds ?? [], query.limit);
  }

  @Get('products/:idOrSlug')
  @ApiOkResponse({ type: ProductDetailDto })
  @ApiQuery({
    name: 'store',
    required: false,
    description: 'Id or slug of the store being browsed; product slugs are unique per brand only',
  })
  getProduct(@Param('idOrSlug') idOrSlug: string, @Query('store') store?: string): Promise<ProductDetailDto> {
    return this.catalog.getProduct(idOrSlug, store || undefined);
  }
}
