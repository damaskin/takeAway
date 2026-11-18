import type { ProductOptionGroup } from '@takeaway/shared-types';
import { offersVariantAndAddon } from '@takeaway/utils';

import type { ProductOptionGroupsService } from '../product-option-groups.service';

/**
 * The least a product needs to be shown to customers (a variant and an add-on,
 * `offersVariantAndAddon`) and to go in the cart in one tap at its base
 * price: one size picked by default at no surcharge, one free add-on left
 * off. What every product of a test gets unless the test says otherwise.
 */
export const SELLABLE_GROUPS: ProductOptionGroup[] = [
  {
    id: 'stub-size',
    kind: 'VARIANT',
    type: 'A',
    name: 'Размер',
    minSelect: 1,
    maxSelect: 1,
    showIfOptionId: null,
    options: [
      {
        id: 'stub-size-m',
        name: 'M',
        note: null,
        isDefault: true,
        minQty: null,
        maxQty: null,
        defaultQty: null,
        priceCents: 0,
        available: true,
        sortOrder: 0,
      },
    ],
  },
  {
    id: 'stub-sugar',
    kind: 'ADDON',
    type: 'B',
    name: 'Сахар',
    minSelect: null,
    maxSelect: null,
    showIfOptionId: null,
    options: [
      {
        id: 'stub-sugar-yes',
        name: 'Сахар',
        note: null,
        isDefault: false,
        minQty: null,
        maxQty: null,
        defaultQty: null,
        priceCents: 0,
        available: true,
        sortOrder: 0,
      },
    ],
  },
];

/**
 * Test-only {@link ProductOptionGroupsService}: the given products have these
 * groups, every other product `fallback` — {@link SELLABLE_GROUPS} unless the
 * test passes something else (`[]`: no product has any, so none is shown).
 * A product given `[]` has none.
 */
export function optionGroupsStub(
  byProduct: Record<string, ProductOptionGroup[]> = {},
  fallback: ProductOptionGroup[] = SELLABLE_GROUPS,
): ProductOptionGroupsService {
  const groupsOf = (id: string): ProductOptionGroup[] => byProduct[id] ?? fallback;
  const stub: Pick<ProductOptionGroupsService, 'forProducts' | 'forProduct' | 'offeringVariantAndAddon'> = {
    async forProducts(ids) {
      const map = new Map<string, ProductOptionGroup[]>();
      for (const id of ids) if (groupsOf(id).length > 0) map.set(id, groupsOf(id));
      return map;
    },
    async forProduct(id) {
      return groupsOf(id);
    },
    async offeringVariantAndAddon(products) {
      return new Set(products.filter((p) => offersVariantAndAddon(groupsOf(p.id))).map((p) => p.id));
    },
  };
  return stub as ProductOptionGroupsService;
}
