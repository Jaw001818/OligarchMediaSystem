import type { IncomingMessage, ServerResponse } from "http";
import app from "../server";

/**
 * Vercel Serverless Function entry point.
 * Routes all /api/* requests directly through Express.
 */
export default function handler(req: IncomingMessage, res: ServerResponse) {
  return (app as any)(req, res);
}
