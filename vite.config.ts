import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { handleSalesPlayRequest } from './src/server/salesplayApi.ts';

function salesPlayApiPlugin(): Plugin {
  return {
    name: 'salesplay-api-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.startsWith('/api/salesplay')) {
          const handled = await handleSalesPlayRequest(req, res);
          if (handled) return;
        }
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.startsWith('/api/salesplay')) {
          const handled = await handleSalesPlayRequest(req, res);
          if (handled) return;
        }
        next();
      });
    },
  };
}

function disableHmrWsPlugin(): Plugin {
  return {
    name: 'disable-hmr-ws-plugin',
    apply: 'serve',
    enforce: 'pre',
    transform(code, id) {
      if (id.includes('vite/dist/client/client.mjs') || id.endsWith('/@vite/client')) {
        return code.replace(
          /let wsTransport = createWebSocketModuleRunnerTransport\(\{[\s\S]*?pingInterval: hmrTimeout\s*\}\);/,
          'let wsTransport = { async connect() {}, async disconnect() {}, send() {} };'
        );
      }
      return null;
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [
      disableHmrWsPlugin(),
      react(),
      tailwindcss(),
      salesPlayApiPlugin(),
      VitePWA({
        registerType: 'autoUpdate',
        devOptions: {
          enabled: false,
        },
        includeAssets: ['favicon.png', 'apple-touch-icon.png', 'icon.svg', 'pwa-192x192.png', 'pwa-512x512.png', 'pwa-maskable-512x512.png', 'catalog-seed.json'],
        manifest: {
          id: '/',
          name: 'Makarem Al-Khair Modern Grocery',
          short_name: 'Makarem',
          description: 'Online grocery shopping and customer account portal for Makarem Al-Khair Modern Grocery.',
          theme_color: '#047857',
          background_color: '#ffffff',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          clientsClaim: true,
          skipWaiting: true,
          cleanupOutdatedCaches: true,
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              urlPattern: /\/api\//i,
              handler: 'NetworkOnly',
            },
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      hmr: false as const,
      ws: false as const,
    },
  };
});
