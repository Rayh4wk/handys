import { useEffect, useState } from 'react';

/**
 * Edit state for one server value under optimistic locking.
 *
 * `baseVersion` is the version the user is editing against and is what a save must send. When a
 * newer version arrives (SSE refetch) and the user has not touched the input, the input and base
 * version follow it. When the input has been edited, the typed value and the old base version are
 * kept (a save then gets a 409) and `remoteChanged` tells the form to offer the latest value.
 */
export function useServerDraft(serverValue: string, serverVersion: number, paused: boolean) {
  const [input, setInput] = useState(serverValue);
  const [baseVersion, setBaseVersion] = useState(serverVersion);
  const [dirty, setDirty] = useState(false);

  // Versions only grow; a lower one is the list cache catching up with our own save.
  const remoteAhead = serverVersion > baseVersion;

  useEffect(() => {
    if (paused || dirty || !remoteAhead) return;
    setInput(serverValue);
    setBaseVersion(serverVersion);
  }, [paused, dirty, remoteAhead, serverValue, serverVersion]);

  return {
    input,
    baseVersion,
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
  };
}
