import { useEffect, useState } from 'react';

/**
 * Edit state for one server value under optimistic locking.
 *
 * `baseVersion` is the version the user is editing against and is what a save must send. When a
 * newer version arrives (SSE refetch) and the user has not touched the input, the input and base
 * version follow it — but not while the input has focus (a native date picker may be open); the
 * resync then happens on blur. When the input has been edited, the typed value and the old base
 * version are kept (a save then gets a 409) and `remoteChanged` tells the form to offer the
 * latest value.
 */
export function useServerDraft(serverValue: string, serverVersion: number, paused: boolean) {
  const [input, setInput] = useState(serverValue);
  const [baseVersion, setBaseVersion] = useState(serverVersion);
  const [dirty, setDirty] = useState(false);
  const [focused, setFocused] = useState(false);

  // Versions only grow; a lower one is the list cache catching up with our own save.
  const remoteAhead = serverVersion > baseVersion;

  useEffect(() => {
    if (paused || focused || dirty || !remoteAhead) return;
    setInput(serverValue);
    setBaseVersion(serverVersion);
  }, [paused, focused, dirty, remoteAhead, serverValue, serverVersion]);

  return {
    input,
    baseVersion,
    dirty,
    remoteChanged: remoteAhead && dirty && !paused,
    edit(value: string) {
      setInput(value);
      setDirty(true);
    },
    /** Adopt a value the server confirmed (own save, 409 refresh, "최신 값 불러오기"). */
    reset(value: string, version: number) {
      setInput(value);
      setBaseVersion(version);
      setDirty(false);
    },
    /** Spread onto the input so a resync never lands under the user's cursor or picker. */
    inputProps: {
      onFocus: () => setFocused(true),
      onBlur: () => setFocused(false),
    },
  };
}
