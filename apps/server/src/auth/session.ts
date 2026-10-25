import { createHmac, timingSafeEqual } from 'crypto';

export const SESSION_COOKIE = 'sid';

export function getSessionSecret(): string {
  return process.env.SESSION_SECRET || 'dev-only-secret';
}

function mac(id: string, secret: string): string {
  return createHmac('sha256', secret).update(id).digest('base64url');
}

export function signSession(accountId: string, secret: string): string {
  return `${accountId}.${mac(accountId, secret)}`;
}

export function verifySession(token: string | undefined, secret: string): string | null {
  if (typeof token !== 'string') return null;
  const idx = token.lastIndexOf('.');
  if (idx <= 0) return null;
  const id = token.slice(0, idx);
  const given = Buffer.from(token.slice(idx + 1));
  const expected = Buffer.from(mac(id, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return id;
}
