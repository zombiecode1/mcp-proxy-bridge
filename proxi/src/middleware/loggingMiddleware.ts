import { Request, Response, NextFunction } from 'express';

export const loggingMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  const originalSend = res.send;
  const originalJson = res.json;

  (res as any).__body = null;

  res.json = function (data: any) {
    (res as any).__body = data;
    return originalJson.call(this, data);
  };

  res.send = function (data) {
    const duration = Date.now() - startTime;
    const logLine = `[${new Date().toISOString()}] ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`;
    if (res.statusCode >= 400) {
      console.error(`\x1b[31m${logLine}\x1b[0m`);
    } else {
      console.log(`\x1b[32m${logLine}\x1b[0m`);
    }
    return originalSend.call(this, data);
  };

  next();
};
