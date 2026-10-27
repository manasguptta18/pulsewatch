import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.stubEnv("FRONTEND_ORIGIN", "http://localhost:5173");
const { app } = await import("./app.js");

describe("incident pagination CORS headers", () => {
    afterAll(() => vi.unstubAllEnvs());

    it("exposes pagination headers to the browser without querying a database", async () => {
        const response = await request(app)
            .get("/api/v1/incidents")
            .set("Origin", "http://localhost:5173");
        expect(response.status).toBe(401);
        expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
        expect(response.headers["access-control-expose-headers"]).toContain("X-Has-More");
        expect(response.headers["access-control-expose-headers"]).toContain("X-Next-Cursor");
    });
});
