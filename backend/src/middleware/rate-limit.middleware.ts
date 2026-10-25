import type { NextFunction, Request, Response } from "express";

export interface RateLimitCounter {
    consume: (scope: string, clientAddress: string, windowSeconds: number) => Promise<{
        count: number;
        retryAfterSeconds: number;
    }>;
}

export function createRateLimitMiddleware(
    options: {
        scope: string;
        limit: number;
        windowSeconds: number;
        counter: RateLimitCounter;
    },
) {
    return async (request: Request, response: Response, next: NextFunction) => {
        const clientAddress = request.ip || request.socket.remoteAddress || "unknown";
        try {
            const result = await options.counter.consume(
                options.scope,
                clientAddress,
                options.windowSeconds,
            );
            if (result.count > options.limit) {
                response.setHeader("Retry-After", String(result.retryAfterSeconds));
                return response.status(429).json({ message: "Too many requests" });
            }
            return next();
        } catch {
            // Authentication routes fail closed when the shared limiter is down.
            return response.status(503).json({
                message: "Authentication is temporarily unavailable",
            });
        }
    };
}
