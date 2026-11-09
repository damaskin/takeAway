import type { ProductOptionGroup } from '@takeaway/shared-types';

import type { ProductOptionGroupsService } from '../product-option-groups.service';

/**
 * Test-only {@link ProductOptionGroupsService}: the given products have these
 * groups, every other product none (by default, no product has any).
 */
export function optionGroupsStub(byProduct: Record<string, ProductOptionGroup[]> = {}): ProductOptionGroupsService {
  const groupsOf = (id: string): ProductOptionGroup[] => byProduct[id] ?? [];
  const stub: Pick<ProductOptionGroupsService, 'forProducts' | 'forProduct'> = {
    async forProducts(ids) {
      const map = new Map<string, ProductOptionGroup[]>();
      for (const id of ids) if (groupsOf(id).length > 0) map.set(id, groupsOf(id));
      return map;
    },
    async forProduct(id) {
      return groupsOf(id);
    },
  };
  return stub as ProductOptionGroupsService;
}
