/**
 * Layout of the two dashboards (a business's and the platform's): KPI rows,
 * paired panels, the sortable table. Component styles are scoped, so each
 * page lists this next to DASH_CARD_STYLES.
 */
export const OVERVIEW_STYLES = `
  .ov {
    padding: clamp(16px, 4vw, 32px);
    display: flex;
    flex-direction: column;
    gap: 16px;
    font-family: var(--font-sans);
  }
  .ov-kpis {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px;
  }
  .ov-kpis-sm {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 12px;
  }
  .ov-panels {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
    gap: 16px;
  }
  .ov-panels-even {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .ov-panels > * {
    min-width: 0;
  }
  .ov-hint {
    font-size: 12px;
    color: var(--color-text-tertiary);
  }
  .ov-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    height: 20px;
    margin-left: 6px;
    padding: 0 7px;
    border-radius: 9999px;
    background: var(--chart-track);
    color: var(--color-text-secondary);
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 600;
    vertical-align: middle;
  }
  .ov-search {
    height: 34px;
    width: 220px;
    max-width: 100%;
    padding: 0 12px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-input);
    background: var(--color-cream);
    color: var(--color-text-primary);
    font-family: var(--font-sans);
    font-size: 13px;
  }
  .ov-select {
    height: 32px;
    max-width: 220px;
    padding: 0 10px;
    border: 1px solid var(--color-border-light);
    border-radius: var(--radius-button);
    background: var(--color-foam);
    color: var(--color-text-secondary);
    font-family: var(--font-sans);
    font-size: 13px;
  }
  .ov-chip {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 6px 0 12px;
    border-radius: 9999px;
    background: var(--color-caramel-light);
    color: var(--color-text-primary);
    font-size: 13px;
    font-weight: 500;
  }
  .ov-chip button {
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--color-text-secondary);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
  }
  .ov-state {
    padding: 40px 16px;
    text-align: center;
  }
  .ov-table-wrap {
    overflow-x: auto;
    margin: 0 -20px -20px;
    padding: 0 20px 12px;
  }
  .ov-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }
  .ov-table th {
    padding: 8px 10px;
    border-bottom: 1px solid var(--color-border-light);
    font-size: 12px;
    font-weight: 500;
    color: var(--color-text-tertiary);
    text-align: right;
    white-space: nowrap;
  }
  .ov-table th:first-child,
  .ov-table td:first-child {
    text-align: left;
    position: sticky;
    left: 0;
    z-index: 1;
    background: var(--color-foam);
  }
  .ov-table th button {
    border: 0;
    padding: 0;
    background: none;
    font: inherit;
    color: inherit;
    cursor: pointer;
    white-space: nowrap;
  }
  .ov-table th[aria-sort='ascending'],
  .ov-table th[aria-sort='descending'] {
    color: var(--color-text-primary);
    font-weight: 600;
  }
  .ov-table td {
    padding: 10px;
    border-bottom: 1px solid var(--color-border-light);
    color: var(--color-text-primary);
    text-align: right;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .ov-table td.is-sorted {
    font-weight: 600;
  }
  .ov-table tbody tr {
    cursor: pointer;
  }
  .ov-table tbody tr:hover td,
  .ov-table tbody tr:focus-visible td {
    background: color-mix(in srgb, var(--color-text-primary) 4%, var(--color-foam));
  }
  .ov-table tbody tr.is-picked td {
    background: var(--color-caramel-light);
  }
  .ov-table tbody tr:focus-visible {
    outline: 2px solid var(--color-caramel);
    outline-offset: -2px;
  }
  .ov-name {
    font-weight: 600;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ov-sub {
    display: block;
    font-size: 11px;
    font-weight: 400;
    color: var(--color-text-tertiary);
  }
  .ov-pos {
    color: var(--color-positive);
  }
  .ov-neg {
    color: var(--color-negative);
  }
  .ov-muted-cell {
    color: var(--color-text-tertiary);
  }
  .ov-section-title {
    margin: 12px 0 0;
    font-family: var(--font-display);
    font-size: 20px;
    font-weight: 700;
    color: var(--color-espresso);
  }
  .ov-empty-row {
    padding: 24px 0;
    text-align: center !important;
    color: var(--color-text-tertiary);
  }
  @media (max-width: 1200px) {
    .ov-kpis {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .ov-kpis-sm {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  @media (max-width: 1024px) {
    .ov-kpis {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .ov-panels,
    .ov-panels-even {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (max-width: 640px) {
    .ov-kpis {
      grid-template-columns: minmax(0, 1fr);
      gap: 12px;
    }
    .ov-kpis-sm {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    /* An odd last card takes the whole row rather than leaving a hole. */
    .ov-kpis-sm > :last-child:nth-child(odd) {
      grid-column: 1 / -1;
    }
    .ov-name {
      max-width: 120px;
      white-space: normal;
    }
    .ov-search {
      width: 100%;
    }
    .ov-table-wrap {
      margin: 0 -16px -16px;
      padding: 0 16px 8px;
    }
  }
`;
