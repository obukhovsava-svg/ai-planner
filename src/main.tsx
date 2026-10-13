import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initTelegram } from '@/lib/telegram';
import { installKeyboardWatcher } from '@/lib/keyboard';
import { handleDeepLink } from '@/lib/deeplink';
import { installFastTap } from '@/lib/fastTap';
import { ThemeProvider } from '@/providers/ThemeProvider';
import App from './App';
import './index.css';

initTelegram();
installKeyboardWatcher();
installFastTap();
handleDeepLink();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
