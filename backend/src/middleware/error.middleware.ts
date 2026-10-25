import type {
    Request,
    Response,
    NextFunction,
} from "express";

import { AppError } from "../errors/app-error.js";

export function notFoundMiddleware(
    _request: Request,
    response: Response,
){
    return response.status(404).json({ message: "Not found" });
}

export function errorMiddleware(
    error: unknown,
    req: Request,
    res: Response,
    next: NextFunction
){
    if (res.headersSent) return next(error);

    if(error instanceof AppError){
        return res.status(error.statusCode).json({
            message: error.message,
        });
    }

    if (typeof error === "object" && error !== null && "type" in error) {
        if (error.type === "entity.parse.failed") {
            return res.status(400).json({ message: "Invalid JSON request body" });
        }
        if (error.type === "entity.too.large") {
            return res.status(413).json({ message: "Request body too large" });
        }
    }

    // Do not print raw Prisma, network, or provider errors; they may contain
    // query details, internal addresses, or connection metadata.
    console.error("Unhandled API error", {
        errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return res.status(500).json({
        message: "Internal server error",
    });
}
