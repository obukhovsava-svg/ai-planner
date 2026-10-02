import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initTelegram } from '@/lib/telegram';
import { installKeyboardWatcher } from '@/lib/keyboard';
import { ThemeProvider } from '@/providers/ThemeProvider';
import App from './App';
import './index.css';

initTelegram();
installKeyboardWatcher();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
