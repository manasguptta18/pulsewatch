import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createHealthRouter } from "./health.routes.js";

function createTestApp(dependencies: {
    database: () => Promise<unknown>;
    redis: () => Promise<unknown>;
}, timeoutMs = 25) {
    const app = express();
    app.use("/health", createHealthRouter(dependencies, timeoutMs));
    return app;
}

describe("health routes", () => {
    it("returns liveness without checking dependencies", async () => {
        const database = vi.fn(async () => undefined);
        const redis = vi.fn(async () => undefined);
        const response = await request(createTestApp({ database, redis }))
            .get("/health/live");

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ status: "ok" });
        expect(database).not.toHaveBeenCalled();
        expect(redis).not.toHaveBeenCalled();
    });

    it("reports readiness only when both required dependencies respond", async () => {
        const response = await request(createTestApp({
            database: async () => undefined,
            redis: async () => "PONG",
        })).get("/health/ready");

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            status: "ready",
            dependencies: { database: "ok", redis: "ok" },
        });
    });

    it("keeps /health as a readiness alias", async () => {
        const response = await request(createTestApp({
            database: async () => undefined,
            redis: async () => "PONG",
        })).get("/health");

        expect(response.status).toBe(200);
        expect(response.body.status).toBe("ready");
    });

    it("returns a sanitized unavailable result when a dependency fails", async () => {
        const response = await request(createTestApp({
            database: async () => { throw new Error("private connection detail"); },
            redis: async () => "PONG",
        })).get("/health/ready");

        expect(response.status).toBe(503);
        expect(response.body).toEqual({
            status: "not_ready",
            dependencies: { database: "unavailable", redis: "ok" },
        });
        expect(JSON.stringify(response.body)).not.toContain("private connection detail");
    });

    it("bounds dependency checks and reports timeout without leaking details", async () => {
        const response = await request(createTestApp({
            database: () => new Promise(() => undefined),
            redis: async () => "PONG",
        }, 5)).get("/health/ready");

        expect(response.status).toBe(503);
        expect(response.body).toEqual({
            status: "not_ready",
            dependencies: { database: "timeout", redis: "ok" },
        });
    });
});
