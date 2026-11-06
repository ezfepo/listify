import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { connectServerEvents } from './lib/serverEvents';
import './index.css';

const queryClient = new QueryClient();

/** Keeps this window in step with changes made from other tabs/browsers. */
function ServerSync() {
  useEffect(() => connectServerEvents(() => void queryClient.invalidateQueries()), []);
  return null;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ServerSync />
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
