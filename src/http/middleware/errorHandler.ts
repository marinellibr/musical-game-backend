import { Request, Response, NextFunction } from "express";

export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  const code = err.code || "INTERNAL_ERROR";
  const message = err.message || "Internal server error";
  res.status(err.status || 500).json({ error: { code, message } });
}
