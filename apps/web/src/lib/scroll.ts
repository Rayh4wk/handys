/** Width at which styles.css stacks the detail panel under the list (keep the two in sync). */
export const STACKED_LAYOUT_QUERY = '(max-width: 1080px)';

export function isStackedLayout(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(STACKED_LAYOUT_QUERY).matches;
}

/**
 * Ref callback for a detail panel: on narrow screens (single-column layout) it renders below the
 * list, so bring it into view when it opens and move focus to its heading (`[data-detail-heading]`)
 * so the next Tab continues inside the panel. No-op on wide screens and in test environments.
 */
export function scrollIntoViewOnNarrow(el: HTMLElement | null): void {
  if (!el || typeof el.scrollIntoView !== 'function' || !isStackedLayout()) return;
  el.querySelector<HTMLElement>('[data-detail-heading]')?.focus({ preventScroll: true });
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

/** Focus the selection button of a list row (after the detail panel closes, or on j/k). */
export function focusRow(testId: string): void {
  const btn = document.querySelector<HTMLElement>(`[data-testid="${testId}"] .row-select`);
  if (!btn) return;
  btn.focus({ preventScroll: true });
  if (typeof btn.scrollIntoView === 'function') btn.scrollIntoView({ block: 'nearest' });
}
