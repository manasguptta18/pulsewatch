import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";

const mocks = vi.hoisted(() => ({
    findUnique: vi.fn(),
    compare: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
    prisma: { user: { findUnique: mocks.findUnique } },
}));
vi.mock("bcrypt", () => ({ default: { compare: mocks.compare } }));

import { loginUser } from "./auth.service.js";

describe("loginUser", () => {
    beforeEach(() => {
        mocks.findUnique.mockReset();
        mocks.compare.mockReset();
        vi.stubEnv("JWT_SECRET", "test-signing-secret-at-least-32-bytes-long");
    });

    afterEach(() => vi.unstubAllEnvs());

    it("returns a signed token and safe user data for valid credentials", async () => {
        mocks.findUnique.mockResolvedValue({
            id: 7,
            name: "Test User",
            email: "test@example.com",
            password: "stored-hash",
        });
        mocks.compare.mockResolvedValue(true);

        const result = await loginUser({ email: "test@example.com", password: "valid-password" });

        expect(mocks.findUnique).toHaveBeenCalledWith({ where: { email: "test@example.com" } });
        expect(mocks.compare).toHaveBeenCalledWith("valid-password", "stored-hash");
        expect(result.user).toEqual({ id: 7, name: "Test User", email: "test@example.com" });
        expect(result).not.toHaveProperty("password");
        expect(jwt.verify(result.token, process.env.JWT_SECRET!, { algorithms: ["HS256"] }))
            .toMatchObject({ userId: 7 });
    });

    it("rejects a wrong password without exposing which credential failed", async () => {
        mocks.findUnique.mockResolvedValue({
            id: 7,
            name: "Test User",
            email: "test@example.com",
            password: "stored-hash",
        });
        mocks.compare.mockResolvedValue(false);

        await expect(loginUser({ email: "test@example.com", password: "wrong-password" }))
            .rejects.toMatchObject({ statusCode: 401, message: "Invalid email or password" });
    });

    it("rejects an unknown email without comparing a password", async () => {
        mocks.findUnique.mockResolvedValue(null);

        await expect(loginUser({ email: "missing@example.com", password: "some-password" }))
            .rejects.toMatchObject({ statusCode: 401, message: "Invalid email or password" });
        expect(mocks.compare).not.toHaveBeenCalled();
    });
});
