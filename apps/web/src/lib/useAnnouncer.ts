import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Text for an always-mounted polite live region. Each announce() clears the region first and
 * fills it on the next tick, so a message identical to the previous one is still read out.
 */
export function useAnnouncer(): [string, (text: string) => void] {
  const [message, setMessage] = useState('');
  const timer = useRef<number | undefined>(undefined);
  const announce = useCallback((text: string) => {
    window.clearTimeout(timer.current);
    setMessage('');
    if (!text) return;
    timer.current = window.setTimeout(() => setMessage(text), 50);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [message, announce];
}
