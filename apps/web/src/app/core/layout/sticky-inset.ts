/**
 * How much of the top of the viewport the stuck bars cover: the header,
 * plus whatever a page pins under it — the menu's store bar on a desktop,
 * its category chips on a phone. A bar opts in with `data-sticky-top`;
 * one that is hidden or not sticky at the current width does not count.
 *
 * Measured from the bar's `top` and height rather than its current
 * position, so the answer is the same before the page has scrolled.
 */
export function stickyTopInset(doc: Document = document): number {
  let inset = 0;
  for (const bar of Array.from(doc.querySelectorAll<HTMLElement>('[data-sticky-top]'))) {
    const style = getComputedStyle(bar);
    if (style.position !== 'sticky' || style.display === 'none') continue;
    inset = Math.max(inset, (parseFloat(style.top) || 0) + bar.offsetHeight);
  }
  return inset;
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
