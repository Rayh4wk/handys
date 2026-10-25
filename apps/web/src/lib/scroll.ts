/** Width at which styles.css stacks the detail panel under the list (keep the two in sync). */
export const STACKED_LAYOUT_QUERY = '(max-width: 1080px)';

/**
 * Ref callback: on narrow screens (single-column layout) the detail panel renders below the list,
 * so bring it into view when it opens. No-op on wide screens and in test environments.
 */
export function scrollIntoViewOnNarrow(el: HTMLElement | null): void {
  if (!el || typeof window.matchMedia !== 'function' || typeof el.scrollIntoView !== 'function') {
    return;
  }
  if (!window.matchMedia(STACKED_LAYOUT_QUERY).matches) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}
