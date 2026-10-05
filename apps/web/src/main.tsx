import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { ApiRequestError } from './api/client';
import './index.css';

// Offline, queries and mutations must FAIL (with a clear message) instead of waiting forever for the network.
// Network errors are not retried: the user can retry; other errors keep the default of 3 attempts.
const queryClient = new QueryClient({
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
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
