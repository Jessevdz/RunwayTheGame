import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/layers.css';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/app-tokens.css';
import './styles/components.css';
import './styles/ds-components.css';
import './styles/ds-mobile.css';
import './styles/shells.css';
import './index.css';
import './styles/pwa-shell.css';
import { AppRoutes } from './routes/AppRoutes';
import { updateManager } from './core/pwa/updateManager';
import { analytics } from './core/analytics/analyticsClient';
import { ThemeProvider } from './design-system/theme/ThemeProvider';
import { ConfirmProvider } from './design-system/overlays/ConfirmSheet';
import { ToastRegion } from './design-system/overlays/ToastRegion';
import { installDiagnostics } from './core/diagnostics/errorBuffer';
import { ingestPlaytestFlag } from './core/diagnostics/playtest';

// Both run before render: the flag may arrive in the URL of this very load, and
// an error thrown during first paint is exactly the one worth capturing.
ingestPlaytestFlag();
installDiagnostics();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <ConfirmProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
        <ToastRegion position="top" />
      </ConfirmProvider>
    </ThemeProvider>
  </StrictMode>
);

updateManager.init();
// Initializes analytics tracking based on server configuration.
analytics.init();
