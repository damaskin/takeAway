/**
 * «Запуск бренда»: what a brand needs before customers can order, and when
 * it counts as launched. One rule for the API (the owner's checklist, the
 * platform's «Зарегистрировались, но не запустились» list) and the admin
 * (which recounts after a moderation decision without reloading the list).
 *
 * Required: a store customers can order from (address and opening hours), a
 * menu with at least one product customers can see, payments (nothing to do:
 * card acceptance is the platform's switch, until then guests pay on
 * pickup) and the platform's approval. A logo and product photos are
 * recommended, not required: a product without a photo still sells — the
 * app shows it as a text row, the website and Telegram with an
 * illustration.
 *
 * A brand that has sold — an order that was not cancelled or expired — has
 * launched, whatever the checklist says.
 */
export const BRAND_LAUNCH_STEPS = ['store', 'menu', 'payments', 'approved'] as const;
export type BrandLaunchStep = (typeof BRAND_LAUNCH_STEPS)[number];

/** Recommended, shown beside the steps and never counted towards the launch. */
export const BRAND_LAUNCH_RECOMMENDATIONS = ['brandProfile', 'photos'] as const;
export type BrandLaunchRecommendation = (typeof BRAND_LAUNCH_RECOMMENDATIONS)[number];

export interface BrandLaunchFacts {
  /** A store with an address and opening hours. */
  store: boolean;
  /** A product customers can see: visible, in a visible category that is not add-ons only. */
  menu: boolean;
  approved: boolean;
  /** An order that was not cancelled or expired. */
  hasOrders: boolean;
}

export interface BrandLaunch {
  /** Required steps done, of {@link total}; payments always count. */
  done: number;
  total: number;
  /** Launched: every required step done, or the brand has sold already. */
  complete: boolean;
}

export function brandLaunch(facts: BrandLaunchFacts): BrandLaunch {
  const done = BRAND_LAUNCH_STEPS.filter((step) => step === 'payments' || facts[step]).length;
  const total = BRAND_LAUNCH_STEPS.length;
  return { done, total, complete: done === total || facts.hasOrders };
}
