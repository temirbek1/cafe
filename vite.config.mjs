import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });
export default defineConfig({
  root: 'frontend',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: Object.fromEntries(
      [
        '/auth',
        '/orders',
        '/menu',
        '/tables',
        '/shifts',
        '/reports',
        '/settings',
        '/health',
        '/socket.io',
      ].map((prefix) => [
        prefix,
        { target: process.env.API_TARGET || 'http://127.0.0.1:3000', ws: true },
      ]),
    ),
  },
});
