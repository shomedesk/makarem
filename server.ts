import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { handleSalesPlayRequest } from './src/server/salesplayApi.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const distPath = path.resolve(__dirname, 'dist');
  const distIndex = path.join(distPath, 'index.html');
  const isExplicitDev =
    process.env.npm_lifecycle_event === 'dev' ||
    process.argv.some((arg) => arg.includes('tsx')) ||
    (process.env.NODE_ENV === 'development' && !fs.existsSync(distIndex));
  const isProd =
    process.env.NODE_ENV === 'production' ||
    (!isExplicitDev && fs.existsSync(distIndex));

  // Parse JSON payloads
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, mode: isProd ? 'production' : 'development', timestamp: new Date().toISOString() });
  });

  // Mount SalesPlay POS proxy endpoints (works in both dev & live production)
  app.all('/api/salesplay/*', async (req, res, next) => {
    try {
      const handled = await handleSalesPlayRequest(req, res);
      if (!handled) next();
    } catch (err) {
      next(err);
    }
  });

  if (!isProd) {
    // Development mode: attach Vite dev server middleware
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
      appType: 'spa',
    });

    app.use(vite.middlewares);
  } else {
    // Production mode: serve built assets from dist
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html') || filePath.endsWith('sw.js') || filePath.endsWith('registerSW.js')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
          } else if (filePath.endsWith('manifest.webmanifest')) {
            res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
            res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
          }
        },
      })
    );

    // Fallback all frontend routes (e.g. /, /profile, /profile/001) to index.html for SPA
    app.get('*', (req, res, next) => {
      if (req.url.startsWith('/api')) {
        return next();
      }
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.sendFile(distIndex);
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Makarem Server listening on http://0.0.0.0:${PORT} (${isProd ? 'production' : 'development'})`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server error:', err);
  process.exit(1);
});
