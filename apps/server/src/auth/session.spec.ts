import { getSessionSecret, signSession, verifySession } from './session';

describe('session', () => {
  const secret = 'test-secret';

  it('round-trips the account id', () => {
    expect(verifySession(signSession('agent-01', secret), secret)).toBe('agent-01');
  });

  it('rejects a tampered signature', () => {
    expect(verifySession('agent-01.xxx', secret)).toBeNull();
  });

  it('rejects a swapped id', () => {
    const sig = signSession('agent-01', secret).split('.')[1];
    expect(verifySession(`ops-01.${sig}`, secret)).toBeNull();
  });

  it('rejects a different secret', () => {
    expect(verifySession(signSession('agent-01', secret), 'other')).toBeNull();
  });

  it('rejects undefined and malformed tokens', () => {
    expect(verifySession(undefined, secret)).toBeNull();
    expect(verifySession('nodot', secret)).toBeNull();
  });

  describe('getSessionSecret', () => {
    const original = process.env.SESSION_SECRET;
    afterEach(() => {
      if (original === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = original;
    });

    it('uses SESSION_SECRET when set', () => {
      process.env.SESSION_SECRET = 'configured';
      expect(getSessionSecret()).toBe('configured');
    });

    it('falls back when SESSION_SECRET is unset or empty', () => {
      delete process.env.SESSION_SECRET;
      expect(getSessionSecret()).toBe('dev-only-secret');
      process.env.SESSION_SECRET = '';
      expect(getSessionSecret()).toBe('dev-only-secret');
    });
  });
});
