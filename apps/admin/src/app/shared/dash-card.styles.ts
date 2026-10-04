/**
 * The card every dashboard and analytics block sits in: foam fill, light
 * border, 20px radius, a header with a title and a link. Component styles
 * are scoped, so each component lists this next to its own.
 */
export const DASH_CARD_STYLES = `
  .dash-card {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
    height: 100%;
    box-sizing: border-box;
    padding: 20px;
    background: var(--color-foam);
    border: 1px solid var(--color-border-light);
    border-radius: 20px;
  }
  .dash-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
  }
  .dash-card-head h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 700;
    color: var(--color-espresso);
  }
  .dash-card-head a,
  .dash-link {
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 500;
    color: var(--color-caramel);
  }
  .dash-muted {
    margin: 0;
    font-family: var(--font-sans);
    font-size: 13px;
    color: var(--color-text-secondary);
  }
  .dash-hint {
    margin: 0;
    font-family: var(--font-sans);
    font-size: 12px;
    color: var(--color-text-tertiary);
  }
  .dash-error {
    margin: 0;
    font-family: var(--font-sans);
    font-size: 13px;
    color: var(--color-berry);
  }
`;
