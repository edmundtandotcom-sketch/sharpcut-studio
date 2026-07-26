import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { useAppStore } from './store/useAppStore';
import './styles/index.css';

// Diagnostics only: expose the store when the page is opened with ?debug.
if (window.location.search.includes('debug')) {
  (window as unknown as Record<string, unknown>).__store = useAppStore;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
