/**
 * Test-only: the option tables {@link ProductOptionGroupsService} reads, as
 * a Prisma fake to spread into a mocked client. Each product of `sellable`
 * has a variant and an add-on group (customers see it), each of
 * `variantOnly` a variant alone (they do not); every other product has none.
 * Plain functions, no jest: files outside `*.spec.ts` are part of the build.
 */
export function optionTablesFake(sellable: readonly string[], variantOnly: readonly string[] = []) {
  const group = (productId: string, kind: 'VARIANT' | 'ADDON') => ({
    productId,
    sortOrder: kind === 'VARIANT' ? 0 : 1,
    group: {
      id: `fake-${kind}`,
      kind,
      type: 'B' as const,
      name: kind,
      minSelect: null,
      maxSelect: null,
      showIfOptionId: null,
      showIfOption: null,
      sortOrder: 0,
      options: [
        {
          id: `fake-${kind}-option`,
          name: kind,
          note: null,
          isDefault: false,
          minQty: null,
          maxQty: null,
          defaultQty: null,
          sortOrder: 0,
        },
      ],
    },
  });
  const rows = [
    ...sellable.flatMap((id) => [group(id, 'VARIANT'), group(id, 'ADDON')]),
    ...variantOnly.map((id) => group(id, 'VARIANT')),
  ];
  return {
    productOptionGroup: {
      findMany: async ({ where }: { where: { productId: { in: string[] } } }) =>
        rows.filter((r) => where.productId.in.includes(r.productId)),
    },
    productOptionOverride: { findMany: async () => [] },
    brandOptionSetting: { findMany: async () => [] },
    storeOptionStop: { findMany: async () => [] },
  };
}
