import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorMiddleware, notFoundMiddleware } from "./error.middleware.js";

describe("errorMiddleware", () => {
    afterEach(() => vi.restoreAllMocks());

    it("returns a generic 500 and logs only a safe error category", async () => {
        const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const app = express();
        app.get("/failure", (_request, _response, next) => {
            next(new Error("postgres://user:password@private-host/database"));
        });
        app.use(errorMiddleware);

        const response = await request(app).get("/failure");
        expect(response.status).toBe(500);
        expect(response.body).toEqual({ message: "Internal server error" });
        expect(JSON.stringify(log.mock.calls)).not.toContain("password");
        expect(JSON.stringify(log.mock.calls)).not.toContain("private-host");
    });

    it("returns a consistent JSON 404 for unknown routes", async () => {
        const app = express();
        app.use(notFoundMiddleware);
        app.use(errorMiddleware);

        const response = await request(app).get("/missing");
        expect(response.status).toBe(404);
        expect(response.body).toEqual({ message: "Not found" });
    });

    it("returns a safe 400 response for malformed JSON", async () => {
        const app = express();
        app.use(express.json());
        app.post("/body", (_request, response) => response.json({ ok: true }));
        app.use(errorMiddleware);

        const response = await request(app)
            .post("/body")
            .set("Content-Type", "application/json")
            .send("{");
        expect(response.status).toBe(400);
        expect(response.body).toEqual({ message: "Invalid JSON request body" });
    });
});
