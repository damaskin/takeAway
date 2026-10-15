# Product placeholders

Shown instead of a product photo when a business hasn't uploaded one, so the menu
keeps one visual style (owner's style sheet, 2026-10-10: product cut out on white,
paper cup for hot drinks, clear cup for cold ones, no third-party logos).

Picked by the product's category kind (`CategoryKind` in libs/shared-types):

| kind            | file           |
| --------------- | -------------- |
| HOT_DRINKS      | hot-drink.svg  |
| COLD_DRINKS     | cold-drink.svg |
| FOOD            | food.svg       |
| BAKERY          | bakery.svg     |
| OTHER / missing | other.svg      |

Flat illustrations on a transparent background, 200×200 viewBox. Web and TMA serve
them from `/ui-kit/product-placeholders/`. The Flutter app does not use them: App
Review rejected stand-in art as placeholder content (Guideline 2.1(a), 2026-10), so
there a product without a photo is laid out as text.
