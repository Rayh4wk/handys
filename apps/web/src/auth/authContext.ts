import { createContext, useContext } from 'react';
import type { Me } from '../api/types';

export interface AuthValue {
  me: Me | null;
  loading: boolean;
  login(username: string, password: string): Promise<Me>;
  logout(): Promise<void>;
}

export const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
