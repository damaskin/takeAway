import type { CategoryKind } from '@takeaway/shared-types';

import type { VariationType } from '../../core/catalog/admin-catalog.service';

const ALL_VARIATION_TYPES: readonly VariationType[] = ['SIZE', 'TEMPERATURE', 'MILK', 'CUP'];

/**
 * What the product editor offers for a product of a category kind. Caffeine
 * and diet tags used to follow the kind too; they left the menu on
 * 2026-11-05, so only the options editor's choice groups are left.
 */
export interface ProductFields {
  /** Choice groups the options editor can add: milk and cups are for drinks. */
  variationTypes: readonly VariationType[];
}

/**
 * The fields of a product of this kind. OTHER (and a category from an API
 * without kinds) keeps everything, as the editor was before kinds.
 */
export function productFieldsFor(kind: CategoryKind | null | undefined): ProductFields {
  switch (kind) {
    case 'FOOD':
    case 'BAKERY':
      return { variationTypes: ['SIZE'] };
    default:
      return { variationTypes: ALL_VARIATION_TYPES };
  }
}
