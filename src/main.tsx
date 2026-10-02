import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initTelegram } from '@/lib/telegram';
import { ThemeProvider } from '@/providers/ThemeProvider';
import App from './App';
import './index.css';

initTelegram();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
