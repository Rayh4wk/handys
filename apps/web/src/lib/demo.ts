const KEY = 'handys.demo';

/**
 * Demo controls (the realtime disconnect toggle) are hidden unless the app is opened with
 * `?demo=1`. The flag is remembered for the tab (sessionStorage); `?demo=0` turns it off.
 */
export function captureDemoFlag(search: string = window.location.search): void {
  const v = new URLSearchParams(search).get('demo');
  if (v === null) return;
  try {
    if (v === '1') sessionStorage.setItem(KEY, '1');
    else sessionStorage.removeItem(KEY);
  } catch {
    // Storage unavailable (private mode etc.): demo controls simply stay hidden.
  }
}

export function isDemoMode(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
