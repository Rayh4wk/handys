import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext, type AuthValue } from '../auth/authContext';
import { RealtimeContext, type RealtimeState } from '../realtime/realtimeContext';
import Header from './Header';

function renderHeader(state: RealtimeState) {
  const auth: AuthValue = {
    me: { username: 'ops', displayName: '현장 운영 박현장', role: 'OPERATIONS_MANAGER' },
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
  };
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={auth}>
        <RealtimeContext.Provider
          value={{
            state,
            lastUpdatedAt: new Date('2026-10-25T12:47:05.000Z'),
            paused: false,
            pause: vi.fn(),
            resume: vi.fn(),
          }}
        >
          <Header />
        </RealtimeContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe('Header', () => {
  it('shows only a dot while connected; text and time stay for assistive tech', () => {
    renderHeader('open');
    const state = screen.getByTestId('sse-state');
    expect(state).toHaveAttribute('data-state', 'open');
    expect(state).toHaveTextContent('실시간 연결됨');
    expect(state).toHaveClass('sr-only');
    expect(screen.getByTestId('last-updated').parentElement).toHaveClass('sr-only');
    expect(screen.getByText('현장 운영 박현장')).toBeInTheDocument();
    // the role is already in the display name; no separate role chip
    expect(screen.queryByText('현장 운영', { exact: true })).not.toBeInTheDocument();
  });

  it('shows the state and last update time when disconnected', () => {
    renderHeader('disconnected');
    const state = screen.getByTestId('sse-state');
    expect(state).toHaveTextContent('끊김');
    expect(state).not.toHaveClass('sr-only');
    expect(screen.getByTestId('last-updated')).toHaveTextContent('21:47:05');
    expect(screen.getByTestId('last-updated').parentElement).toHaveClass('last-updated');
    expect(screen.getByTestId('sse-warning')).toBeInTheDocument();
  });
});
