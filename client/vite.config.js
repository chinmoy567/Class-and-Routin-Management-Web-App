import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Class & Routine Management',
        short_name: 'Routine',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#0f172a',
        icons: [
          { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        // FND-33: API responses and the socket are never cached or served from the shell
        navigateFallbackDenylist: [/^\/api\//, /^\/socket\.io\//],
        runtimeCaching: [
          { urlPattern: /^\/api\//, handler: 'NetworkOnly' },
          { urlPattern: /^\/socket\.io\//, handler: 'NetworkOnly' },
        ],
      },
    }),
  ],
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: {
    proxy: {
      '/api': 'http://localhost:4000',
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    globals: false,
  },
});
