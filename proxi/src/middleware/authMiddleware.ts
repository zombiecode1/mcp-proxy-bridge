import { Request, Response, NextFunction } from 'express';

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const defaultKey = process.env.GROQ_API_KEY;

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    (req as any).apiKey = defaultKey;
    return next();
  }

  const token = authHeader.replace('Bearer ', '').trim();
  (req as any).apiKey = token || defaultKey;
  next();
};
