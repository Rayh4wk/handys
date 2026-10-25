import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ROLE_HOME } from './api/types';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import LoginPage from './auth/LoginPage';
import RequireRole from './auth/RequireRole';
import Header from './components/Header';
import { RealtimeProvider } from './realtime/useRealtime';

function AuthedRealtime({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  return <RealtimeProvider enabled={!!me}>{children}</RealtimeProvider>;
}

function HomeRedirect() {
  const { me, loading } = useAuth();
  if (loading) return <p className="muted page">불러오는 중…</p>;
  return <Navigate to={me ? ROLE_HOME[me.role] : '/login'} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AuthedRealtime>
          <Header />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/reservations"
              element={
                <RequireRole role="RESERVATION_AGENT">
                  <main className="page">
                    <h1>예약·고객 응대 — 체크아웃 변경</h1>
                  </main>
                </RequireRole>
              }
            />
            <Route
              path="/operations"
              element={
                <RequireRole role="OPERATIONS_MANAGER">
                  <main className="page">
                    <h1>현장 운영 — 청소 일정 점검</h1>
                  </main>
                </RequireRole>
              }
            />
            <Route path="*" element={<HomeRedirect />} />
          </Routes>
        </AuthedRealtime>
      </AuthProvider>
    </BrowserRouter>
  );
}
