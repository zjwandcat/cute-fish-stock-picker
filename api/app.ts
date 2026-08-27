/**
 * Express application entry.
 *
 * Sets up middleware, mounts API routers, and registers
 * health check, 404 and error handlers.
 */
import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import stockRoutes from './routes/stocks.js';
import alertRoutes from './routes/alerts.js';

// Load .env into process.env
dotenv.config();

const app: express.Application = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/**
 * API Routers
 */
app.use('/api', stockRoutes);
app.use('/api', alertRoutes);

/**
 * Health check
 */
app.get('/api/health', (_req: Request, res: Response): void => {
  res.status(200).json({
    success: true,
    message: 'ok',
  });
});

/**
 * 404 handler (no matching route)
 */
app.use((_req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    error: 'API not found',
  });
});

/**
 * Error handler (must have 4 args to be recognized by Express)
 */

app.use((err: Error, _req: Request, res: Response, _next: NextFunction): void => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Server internal error',
  });
});

export default app;
