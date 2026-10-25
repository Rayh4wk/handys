import { timingSafeEqual } from 'crypto';

export type Role = 'RESERVATION_AGENT' | 'OPERATIONS_MANAGER';

export interface Account {
  id: string;
  username: string;
  displayName: string;
  role: Role;
}

export const DEMO_ACCOUNTS: Account[] = [
  { id: 'agent-01', username: 'agent', displayName: '예약 담당 김예약', role: 'RESERVATION_AGENT' },
  { id: 'ops-01', username: 'ops', displayName: '현장 운영 박현장', role: 'OPERATIONS_MANAGER' },
];

const DEMO_PASSWORD = 'demo1234';

export function findAccountById(id: string): Account | undefined {
  return DEMO_ACCOUNTS.find((a) => a.id === id);
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function verifyCredentials(username: string, password: string): Account | null {
  const account = DEMO_ACCOUNTS.find((a) => a.username === username);
  const passwordOk = safeEqual(String(password ?? ''), DEMO_PASSWORD);
  return account && passwordOk ? account : null;
}
