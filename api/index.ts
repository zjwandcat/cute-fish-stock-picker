/**
 * Vercel Serverless deployment entry.
 * Do not modify: required for Vercel Functions.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import app from './app.js';

export default function handler(req: VercelRequest, res: VercelResponse): void {
  return app(req, res);
}
