import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { ROLE_HOME } from '../api/types';
import { useAuth } from './authContext';

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

  return (
    <main className="login">
      <form className="card login-card" onSubmit={onSubmit} aria-labelledby="login-title">
        <div className="login-brand">
          <span className="brand-mark brand-mark-lg" aria-hidden />
          <h1 id="login-title">청소 일정 점검</h1>
        </div>
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
      </form>
    </main>
  );
}
