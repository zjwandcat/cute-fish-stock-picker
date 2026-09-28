import type { RequestHandler } from 'express';

function loopback(host: string): boolean {
  return ['127.0.0.1', 'localhost', '[::1]', '::1', '::ffff:127.0.0.1'].includes(host.toLowerCase());
}

/** AI credentials and personal memory belong to the local desktop installation. */
export const localAiAccess: RequestHandler = (req, res, next): void => {
  res.setHeader('Cache-Control', 'no-store');
  let valid = loopback(req.socket.remoteAddress || '');
  try {
    valid &&= loopback(new URL(`http://${req.headers.host || ''}`).hostname);
    if (req.headers.origin) {
      const origin = new URL(req.headers.origin);
      valid &&= ['http:', 'https:'].includes(origin.protocol) && loopback(origin.hostname);
    }
  } catch {
    valid = false;
  }
  if (!valid || req.headers['sec-fetch-site'] === 'cross-site' || process.env.VERCEL) {
    res.status(403).json({ success: false, error: 'AI 配置和研究仅在本机应用中开放。' });
    return;
  }
  next();
};
