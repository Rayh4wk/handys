import { signSession, verifySession } from './session';

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
});
