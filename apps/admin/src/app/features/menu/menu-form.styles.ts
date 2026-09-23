/**
 * The handful of classes the menu editor's components share. Everything
 * else stays inline like the rest of the admin; these exist because a
 * label, a control or an error line must look the same in the product
 * form, the options panel and the category rail, and component styles do
 * not cross component boundaries.
 */
export const MENU_FORM_STYLES = `
  .field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .label { font-family: var(--font-sans); font-size: 12px; font-weight: 500; color: var(--color-text-secondary); }
  .hint { font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary); }
  .error { font-family: var(--font-sans); font-size: 12px; color: var(--color-berry); }
  .notice {
    margin: 0; padding: 10px 12px; background: var(--color-foam); border-left: 3px solid var(--color-mint);
    border-radius: 8px; font-family: var(--font-sans); font-size: 13px; color: var(--color-text-primary);
  }
  .control {
    height: 40px; padding: 0 12px; background: var(--color-foam); border: 1px solid var(--color-border);
    border-radius: var(--radius-input); font-family: var(--font-sans); font-size: 14px; color: var(--color-text-primary);
  }
  .control.small { height: 32px; padding: 0 8px; border-radius: 8px; font-size: 13px; }
  textarea.control { height: auto; padding: 10px 12px; resize: vertical; }
  .mono { font-family: var(--font-mono); font-size: 13px; }
  .check {
    display: flex; align-items: center; gap: 6px;
    font-family: var(--font-sans); font-size: 13px; color: var(--color-text-primary);
  }
  .box {
    display: flex; flex-direction: column; gap: 12px; min-width: 0; margin: 0;
    padding: 12px 14px 14px; border: 1px solid var(--color-border); border-radius: 12px;
  }
  .box > legend { padding: 0 6px; font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); }
  .primary {
    height: 40px; padding: 0 20px; background: var(--color-caramel); color: white; border-radius: var(--radius-button);
    font-family: var(--font-sans); font-size: 14px; font-weight: 600;
  }
  .primary.small { height: 32px; padding: 0 12px; border-radius: 8px; font-size: 12px; }
  .link { padding: 0; font-family: var(--font-sans); font-size: 12px; font-weight: 600; color: var(--color-caramel); }
  .link.danger { color: var(--color-berry); font-weight: 500; }
  .link.muted { color: var(--color-text-secondary); font-weight: 500; }
`;
