import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { ROLE_HOME } from '../api/types';
import { useAuth } from './authContext';

const DEMO_PASSWORD = 'demo1234';
const DEMO_ACCOUNTS = [
  { id: 'agent', role: '예약·고객 응대 담당', desc: '체크아웃 시각을 변경하고 결과를 확인합니다.' },
  { id: 'ops', role: '현장 운영 담당', desc: '어긋난 청소 일정을 찾아 수정합니다.' },
];

export default function LoginPage() {
  const { me, loading, login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && me) return <Navigate to={ROLE_HOME[me.role]} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await login(username.trim(), password);
      navigate(ROLE_HOME[user.role], { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? '아이디 또는 비밀번호가 올바르지 않습니다.'
          : '로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  function fill(account: string) {
    setUsername(account);
    setPassword(DEMO_PASSWORD);
    setError(null);
  }

  return (
    <main className="login">
      <section className="login-intro" aria-labelledby="login-title">
        <h1 id="login-title">청소 일정 점검</h1>
        <p className="login-lead">
          체크아웃 시각이 바뀌면 퇴실 청소 일정과 맞는지 바로 확인하고, 어긋난 일정은 현장에서
          조정합니다.
        </p>
      </section>

      <form className="card login-card" onSubmit={onSubmit}>
        <p className="muted login-hint">데모 계정으로 로그인하세요.</p>
        <label className="field">
          <span className="field-label">아이디</span>
          <input
            data-testid="login-username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span className="field-label">비밀번호</span>
          <input
            data-testid="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && (
          <p className="inline-notice notice-error" role="alert" data-testid="login-error">
            {error}
          </p>
        )}
        <button
          type="submit"
          className="primary btn-block"
          data-testid="login-submit"
          disabled={submitting}
        >
          {submitting ? '로그인 중…' : '로그인'}
        </button>

        <div className="demo-accounts">
          <strong>데모 계정</strong>
          <ul>
            {DEMO_ACCOUNTS.map((a) => (
              <li key={a.id}>
                <button type="button" className="demo-account" onClick={() => fill(a.id)}>
                  <code>{a.id}</code>
                  <span className="demo-account-head">{a.role}</span>
                  <span className="demo-account-desc">{a.desc}</span>
                </button>
              </li>
            ))}
          </ul>
          <p>
            비밀번호: <code>{DEMO_PASSWORD}</code>
          </p>
        </div>
      </form>
    </main>
  );
}
