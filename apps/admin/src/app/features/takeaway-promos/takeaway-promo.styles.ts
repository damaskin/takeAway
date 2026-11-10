/**
 * What the «Акции takeAway» pages share: the status chip, the welcome badge,
 * the budget meter and the row buttons. Component styles are scoped, so each
 * page lists this next to its own.
 */
export const TAKEAWAY_PROMO_STYLES = `
  .tp-status {
    display: inline-block;
    padding: 4px 10px;
    border-radius: 9999px;
    font-size: 11px;
    font-weight: 700;
    white-space: nowrap;
    background: var(--color-surface-variant);
    color: var(--color-text-secondary);
  }
  .tp-status[data-status='ACTIVE'] {
    background: #7bc4a433;
    color: #3e8868;
  }
  .tp-status[data-status='SCHEDULED'] {
    background: var(--color-caramel-light);
    color: var(--color-caramel);
  }
  .tp-status[data-status='EXHAUSTED'] {
    background: #d94b5e22;
    color: #8f2f3c;
  }
  .tp-badge {
    display: inline-block;
    margin-left: 6px;
    padding: 2px 8px;
    border-radius: 9999px;
    background: var(--color-caramel-light);
    color: var(--color-caramel);
    font-size: 11px;
    font-weight: 700;
    white-space: nowrap;
    vertical-align: middle;
  }
  .tp-meter {
    height: 6px;
    min-width: 120px;
    border-radius: 9999px;
    background: var(--chart-track);
    overflow: hidden;
  }
  .tp-meter span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--color-caramel);
  }
  .tp-meter[data-full='true'] span {
    background: var(--color-berry);
  }
  .tp-action {
    height: 28px;
    padding: 0 10px;
    display: inline-flex;
    align-items: center;
    border-radius: 9999px;
    border: 1px solid var(--color-border);
    background: var(--color-foam);
    color: var(--color-text-primary);
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 600;
    text-decoration: none;
    white-space: nowrap;
    cursor: pointer;
  }
  .tp-action:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .tp-action-main {
    background: var(--color-caramel);
    border-color: transparent;
    color: white;
  }
  .tp-action-danger {
    color: var(--color-berry);
  }
`;
