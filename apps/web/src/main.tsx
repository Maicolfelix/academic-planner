import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { ApiRequestError } from './api/client';
import { markSessionExpired } from './auth/sessionExpiry';
import { ME_KEY } from './auth/useAuth';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

// Offline, queries and mutations must FAIL (with a clear message) instead of waiting forever for the network.
// Network errors are not retried: the user can retry; other errors keep the default of 3 attempts.
/**
 * A 401 while the student was signed in means the server ended the session (it expired, or was closed elsewhere).
 * Say so once and send them to the login, instead of leaving every screen with its own error. The login and
 * "who am I" calls are not affected: they have no session to lose.
 */
function onApiError(error: unknown) {
  if (
    error instanceof ApiRequestError &&
    error.status === 401 &&
    queryClient.getQueryData(ME_KEY)
  ) {
    markSessionExpired();
    queryClient.setQueryData(ME_KEY, null);
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onApiError }),
  mutationCache: new MutationCache({ onError: onApiError }),
  defaultOptions: {
    queries: {
      networkMode: 'always',
      retry: (count, error) =>
        count < 3 && !(error instanceof ApiRequestError && error.status === 0),
    },
    mutations: { networkMode: 'always' },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
