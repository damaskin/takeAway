# Option presets

Ready-made option sets per category kind (`OPTION_PRESETS` in `option-presets.ts`). They are the
platform's starting point for a category's options, nothing more:

1. In the admin, a category's «Опции категории» panel offers «Добавить набор для …» for the
   category's kind (any kind's set for an OTHER category).
2. The preview lists the set. The business unticks what it does not sell and types its prices;
   an add-on its «Добавки» library already has (by name or one of the `aliases`) is reused with
   the price it has there.
3. On confirm the admin sends the ticked options to `POST /admin/categories/:id/options`: missing
   library entries are created (with the typed price and the group as their default group) and
   the options become the category's option set (`CategoryOption` rows).
4. «Применить к товарам категории» copies the set onto the category's products; a new product in
   the category gets it when created.

Nothing reads these constants at order time, so changing them never touches a live menu — only
what the next preview offers.

## Changing a preset

Edit `option-presets.ts`, keep the shape:

- `kind: 'VARIATION'` groups are pick-one choices (`variationType`: `SIZE`, `MILK`, `TEMPERATURE`,
  `CUP`); at most one item has `isDefault: true`.
- `kind: 'MODIFIER'` groups are optional add-ons; the group `name` becomes `Modifier.group`
  (at most 40 characters) and the customer apps show the add-ons under it.
- Every item has a `key` unique within its kind (the same item keeps its key across kinds), a
  Russian and an English `name`, and `priceCents` in the brand's minor units — 0 unless the
  price is the same in every currency (free «Без лука» and such).
- `aliases` are lower case.

`option-presets.spec.ts` checks the rules above; run `pnpm nx test shared-types`.

There is no editor for presets in the super-admin panel (v1): they are code, reviewed like code.
