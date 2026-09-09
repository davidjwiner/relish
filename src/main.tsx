import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Providers } from './app/providers';
import { AppRouter } from './app/router';
import { RecoveryBoundary } from './components/Recovery';
import './styles/global.css';
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RecoveryBoundary>
      <Providers>
        <AppRouter />
      </Providers>
    </RecoveryBoundary>
  </StrictMode>,
);
