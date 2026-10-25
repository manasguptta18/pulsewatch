import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("dotenv/config", () => ({}));

import { authMiddleware } from "./auth.middleware.js";

const secret = "test-only-signing-secret";
const previousSecret = process.env.JWT_SECRET;

function createApp() {
    const app = express();
    app.get("/private", authMiddleware, (req, res) => res.json({ userId: req.userId }));
    return app;
}

afterEach(() => {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
});

describe("authMiddleware", () => {
    it("accepts a verified HS256 token with a positive integer user ID", async () => {
        process.env.JWT_SECRET = secret;
        const token = jwt.sign({ userId: 12 }, secret, { algorithm: "HS256" });
        const response = await request(createApp())
            .get("/private")
            .set("Authorization", `Bearer ${token}`);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ userId: 12 });
    });

    it("rejects a signed token with an invalid user ID claim", async () => {
        process.env.JWT_SECRET = secret;
        const token = jwt.sign({ userId: "12" }, secret, { algorithm: "HS256" });
        const response = await request(createApp())
            .get("/private")
            .set("Authorization", `Bearer ${token}`);

        expect(response.status).toBe(401);
        expect(response.body.message).toBe("Invalid or expired token");
    });

    it("rejects tokens signed with an unsupported algorithm", async () => {
        process.env.JWT_SECRET = secret;
        const token = jwt.sign({ userId: 12 }, secret, { algorithm: "HS384" });
        const response = await request(createApp())
            .get("/private")
            .set("Authorization", `Bearer ${token}`);

        expect(response.status).toBe(401);
    });
});
