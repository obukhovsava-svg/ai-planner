import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative base so the build works on GitHub Pages / any sub-path.
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // allowedHosts: lets the dev server be opened through an HTTPS tunnel for testing inside Telegram.
  server: { host: true, port: 5173, allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.pinggy-free.link', '.pinggy.net', '.pinggy.link'] },
});
