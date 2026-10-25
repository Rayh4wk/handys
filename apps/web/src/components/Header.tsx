import { useNavigate } from 'react-router-dom';
import { ROLE_LABEL } from '../api/types';
import { useAuth } from '../auth/authContext';
import { formatKstClock } from '../lib/kst';
import { useRealtime, type RealtimeState } from '../realtime/realtimeContext';

const STATE_LABEL: Record<RealtimeState, string> = {
  open: '연결됨',
  reconnecting: '재연결 중',
  disconnected: '끊김',
  connecting: '연결 중',
};

export default function Header() {
  const { me, logout } = useAuth();
  const { state, lastUpdatedAt, paused, pause, resume } = useRealtime();
  const navigate = useNavigate();
  if (!me) return null;

  const stale = state === 'disconnected' || state === 'reconnecting';

  async function onLogout() {
    await logout().catch(() => undefined);
    navigate('/login', { replace: true });
  }

  return (
    <header className="app-header">
      <div className="header-row">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          청소 일정 점검
        </div>
        <div className="realtime">
          <span className={`conn conn-${state}`}>
            <span className={`sse-dot sse-${state}`} aria-hidden />
            <span data-testid="sse-state" data-state={state}>
              {STATE_LABEL[state]}
            </span>
          </span>
          <span className="last-updated">
            마지막 갱신{' '}
            <span className="tnum" data-testid="last-updated">
              {lastUpdatedAt ? formatKstClock(lastUpdatedAt.toISOString()) : '-'}
            </span>
          </span>
          <button
            type="button"
            className={`btn-ghost btn-small ${paused ? 'btn-resume' : ''}`}
            data-testid="sse-toggle"
            onClick={paused ? resume : pause}
          >
            {paused ? '다시 연결' : '실시간 연결 끊기(시연용)'}
          </button>
        </div>
        <div className="account">
          <span className="account-name">{me.displayName}</span>
          <span className={`role-badge role-${me.role}`}>{ROLE_LABEL[me.role]}</span>
          <button type="button" className="btn-small" data-testid="logout" onClick={onLogout}>
            로그아웃
          </button>
        </div>
      </div>
      {stale && (
        <div className="sse-warning" role="status" data-testid="sse-warning">
          실시간 연결이 끊겼습니다. 화면이 최신이 아닐 수 있습니다.
        </div>
      )}
    </header>
  );
}
