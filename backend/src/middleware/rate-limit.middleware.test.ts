import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
    createRateLimitMiddleware,
    type RateLimitCounter,
} from "./rate-limit.middleware.js";

function createApp(counter: RateLimitCounter) {
    const app = express();
    app.post("/login", createRateLimitMiddleware({
        scope: "login",
        limit: 2,
        windowSeconds: 60,
        counter,
    }), (_request, response) => response.json({ ok: true }));
    return app;
}

describe("authentication rate limit middleware", () => {
    it("allows requests within the configured limit and scopes by client address", async () => {
        const consume = vi.fn(async () => ({ count: 1, retryAfterSeconds: 60 }));
        const response = await request(createApp({ consume })).post("/login");

        expect(response.status).toBe(200);
        expect(consume).toHaveBeenCalledWith("login", expect.any(String), 60);
    });

    it("returns 429 and Retry-After after the configured limit", async () => {
        const consume = vi.fn(async () => ({ count: 3, retryAfterSeconds: 27 }));
        const response = await request(createApp({ consume })).post("/login");

        expect(response.status).toBe(429);
        expect(response.headers["retry-after"]).toBe("27");
        expect(response.body).toEqual({ message: "Too many requests" });
    });

    it("fails closed with a safe response when the counter is unavailable", async () => {
        const consume = vi.fn(async () => { throw new Error("redis secret detail"); });
        const response = await request(createApp({ consume })).post("/login");

        expect(response.status).toBe(503);
        expect(response.body).toEqual({
            message: "Authentication is temporarily unavailable",
        });
        expect(JSON.stringify(response.body)).not.toContain("redis secret detail");
    });
});
