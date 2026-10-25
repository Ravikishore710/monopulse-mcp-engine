import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createMonoPulseApp } from './src/server/app.ts';
import { logger } from './src/server/logger.ts';
import { closeSqliteDb } from './src/server/sqliteEngine.ts';

async function startServer() {
  const app = createMonoPulseApp();
  const PORT = Number(process.env.PORT) || 3000;

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info(
      { port: PORT, env: process.env.NODE_ENV || 'development' },
      `MonoPulse MCP Engine & Operations Workbench listening on http://localhost:${PORT}`
    );
  });

  const handleGracefulShutdown = (signal: string) => {
    logger.info({ signal }, 'Received shutdown signal, draining connections and closing SQLite...');
    server.close(() => {
      closeSqliteDb();
      logger.info('Graceful shutdown complete.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
}

startServer();
