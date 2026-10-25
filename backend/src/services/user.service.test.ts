import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    createUser: vi.fn(),
    hash: vi.fn(async () => "hashed-password"),
}));

vi.mock("../lib/prisma.js", () => ({
    prisma: { user: { create: mocks.createUser } },
}));
vi.mock("bcrypt", () => ({ default: { hash: mocks.hash } }));

import { createUser } from "./user.service.js";

describe("createUser", () => {
    beforeEach(() => {
        mocks.createUser.mockReset();
        mocks.hash.mockClear();
    });

    it("returns a safe user representation and hashes the password", async () => {
        mocks.createUser.mockResolvedValue({
            id: 8,
            name: "A User",
            email: "a@example.com",
            password: "hashed-password",
            createdAt: new Date("2026-01-01T00:00:00Z"),
        });

        await expect(createUser({
            name: "A User",
            email: "a@example.com",
            password: "secret-password",
        })).resolves.toEqual({
            id: 8,
            name: "A User",
            email: "a@example.com",
            createdAt: new Date("2026-01-01T00:00:00Z"),
        });
        expect(mocks.hash).toHaveBeenCalledWith("secret-password", 10);
        expect(mocks.createUser).toHaveBeenCalledWith({
            data: {
                name: "A User",
                email: "a@example.com",
                password: "hashed-password",
            },
        });
    });

    it("returns a conflict for an already-registered email", async () => {
        mocks.createUser.mockRejectedValue({ code: "P2002" });

        await expect(createUser({
            name: "A User",
            email: "a@example.com",
            password: "secret-password",
        })).rejects.toMatchObject({
            statusCode: 409,
            message: "An account with this email already exists",
        });
    });
});
