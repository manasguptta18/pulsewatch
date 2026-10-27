import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userRoutes from "./user.routes.js";
import { errorMiddleware } from "../middleware/error.middleware.js";

const mocks = vi.hoisted(() => ({
    changeUserPassword: vi.fn(),
    consumeRateLimit: vi.fn(),
}));
vi.mock("../services/user.service.js", () => ({
    createUser: vi.fn(),
    changeUserPassword: mocks.changeUserPassword,
}));
vi.mock("../lib/rate-limit.js", () => ({
    consumeRateLimit: mocks.consumeRateLimit,
}));

const app = express();
app.use(express.json());
app.use("/api/v1/users", userRoutes);
app.use(errorMiddleware);
const body = {
    currentPassword: "old-password",
    newPassword: "new-password",
    confirmPassword: "new-password",
};
function tokenFor(userId: number) {
    return jwt.sign({ userId }, "password-route-test-secret");
}

describe("POST /api/v1/users/me/password", () => {
    beforeEach(() => {
        vi.stubEnv("JWT_SECRET", "password-route-test-secret");
        mocks.changeUserPassword.mockReset();
        mocks.consumeRateLimit.mockReset().mockResolvedValue({ count: 1, retryAfterSeconds: 900 });
    });
    afterEach(() => vi.unstubAllEnvs());

    it("rejects missing and invalid authentication without changing a password", async () => {
        const missing = await request(app).post("/api/v1/users/me/password").send(body);
        const invalid = await request(app).post("/api/v1/users/me/password")
            .set("Authorization", "Bearer invalid").send(body);
        expect(missing.status).toBe(401);
        expect(invalid.status).toBe(401);
        expect(mocks.changeUserPassword).not.toHaveBeenCalled();
    });

    it("uses the verified token user ID and never a client-supplied ID", async () => {
        mocks.changeUserPassword.mockResolvedValue({ message: "Password updated" });
        const response = await request(app).post("/api/v1/users/me/password")
            .set("Authorization", `Bearer ${tokenFor(7)}`)
            .send({ ...body, userId: 999 });
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ message: "Password updated" });
        expect(mocks.changeUserPassword).toHaveBeenCalledWith(7, "old-password", "new-password");
    });

    it("rejects mismatched confirmation before reaching the service", async () => {
        const response = await request(app).post("/api/v1/users/me/password")
            .set("Authorization", `Bearer ${tokenFor(7)}`)
            .send({ ...body, confirmPassword: "different" });
        expect(response.status).toBe(400);
        expect(mocks.changeUserPassword).not.toHaveBeenCalled();
    });
});
