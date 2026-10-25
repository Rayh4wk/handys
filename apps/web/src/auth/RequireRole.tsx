import type { ReactNode } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ROLE_HOME, ROLE_LABEL, type Role } from '../api/types';
import { useAuth } from './authContext';

export default function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { me, loading } = useAuth();
  if (loading) return <p className="muted page">불러오는 중…</p>;
  if (!me) return <Navigate to="/login" replace />;
  if (me.role !== role) {
    return (
      <div className="page">
        <div className="notice" data-testid="forbidden-notice">
          <p>이 화면은 {ROLE_LABEL[role]} 담당자 전용입니다.</p>
          <Link to={ROLE_HOME[me.role]}>내 화면({ROLE_LABEL[me.role]})으로 이동</Link>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
