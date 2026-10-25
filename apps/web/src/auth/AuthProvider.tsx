import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { ApiError, api, queryKeys } from '../api/client';
import type { Me } from '../api/types';
import { AuthContext, type AuthValue } from './authContext';

async function fetchMe(): Promise<Me | null> {
  try {
    return await api.me();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const meQuery = useQuery({
    queryKey: queryKeys.me,
    queryFn: fetchMe,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  // Any 401 from another query or a mutation means the session is gone.
  useEffect(() => {
    const onError = (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        queryClient.setQueryData(queryKeys.me, null);
      }
    };
    const unsubQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') onError(event.action.error);
    });
    const unsubMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') onError(event.action.error);
    });
    return () => {
      unsubQueries();
      unsubMutations();
    };
  }, [queryClient]);

  const login = useCallback(
    async (username: string, password: string) => {
      const me = await api.login(username, password);
      queryClient.setQueryData(queryKeys.me, me);
      return me;
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      queryClient.setQueryData(queryKeys.me, null);
    }
  }, [queryClient]);

  const value = useMemo<AuthValue>(
    () => ({ me: meQuery.data ?? null, loading: meQuery.isPending, login, logout }),
    [meQuery.data, meQuery.isPending, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
