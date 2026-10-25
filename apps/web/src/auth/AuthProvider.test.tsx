import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError, api } from '../api/client';
import { AuthProvider } from './AuthProvider';
import { useAuth } from './authContext';

vi.mock('../api/client', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../api/client')>();
  return { ...orig, api: { ...orig.api, me: vi.fn() } };
});

function Probe() {
  const { me } = useAuth();
  const m = useMutation({
    mutationFn: async () => {
      throw new ApiError(401, { message: 'UNAUTHORIZED' });
    },
  });
  return (
    <div>
      <span data-testid="me">{me ? me.username : 'none'}</span>
      <button type="button" onClick={() => m.mutate()}>
        go
      </button>
    </div>
  );
}

describe('AuthProvider', () => {
  it('clears me when a mutation fails with 401', async () => {
    vi.mocked(api.me).mockResolvedValue({ username: 'agent', displayName: 'A', role: 'RESERVATION_AGENT' });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('agent')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    await waitFor(() => expect(screen.getByTestId('me')).toHaveTextContent('none'));
  });
});
