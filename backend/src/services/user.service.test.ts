import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    createUser: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    hash: vi.fn(async () => "hashed-password"),
    compare: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
    prisma: { user: { create: mocks.createUser, findUnique: mocks.findUnique, updateMany: mocks.updateMany } },
}));
vi.mock("bcrypt", () => ({ default: { hash: mocks.hash, compare: mocks.compare } }));

import { changeUserPassword, createUser } from "./user.service.js";

describe("createUser", () => {
    beforeEach(() => {
        mocks.createUser.mockReset();
        mocks.findUnique.mockReset();
        mocks.updateMany.mockReset();
        mocks.hash.mockClear();
        mocks.compare.mockReset();
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

describe("changeUserPassword", () => {
    beforeEach(() => {
        mocks.findUnique.mockReset();
        mocks.updateMany.mockReset();
        mocks.hash.mockClear();
        mocks.compare.mockReset();
        mocks.findUnique.mockResolvedValue({ password: "old-hash" });
    });

    it("verifies the current password and updates only the authenticated user", async () => {
        mocks.compare.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        mocks.updateMany.mockResolvedValue({ count: 1 });

        await expect(changeUserPassword(7, "old-secret", "new-secret"))
            .resolves.toEqual({ message: "Password updated" });
        expect(mocks.findUnique).toHaveBeenCalledWith({
            where: { id: 7 },
            select: { password: true },
        });
        expect(mocks.compare).toHaveBeenNthCalledWith(1, "old-secret", "old-hash");
        expect(mocks.compare).toHaveBeenNthCalledWith(2, "new-secret", "old-hash");
        expect(mocks.hash).toHaveBeenCalledWith("new-secret", 10);
        expect(mocks.updateMany).toHaveBeenCalledWith({
            where: { id: 7, password: "old-hash" },
            data: { password: "hashed-password" },
        });
    });

    it("rejects an incorrect current password without writing", async () => {
        mocks.compare.mockResolvedValue(false);
        await expect(changeUserPassword(7, "wrong-secret", "new-secret"))
            .rejects.toMatchObject({ statusCode: 400, message: "Current password is incorrect" });
        expect(mocks.hash).not.toHaveBeenCalled();
        expect(mocks.updateMany).not.toHaveBeenCalled();
    });

    it("rejects reuse of the current password", async () => {
        mocks.compare.mockResolvedValue(true);
        await expect(changeUserPassword(7, "old-secret", "old-secret"))
            .rejects.toMatchObject({ statusCode: 400, message: "New password must be different" });
        expect(mocks.updateMany).not.toHaveBeenCalled();
    });

    it("does not overwrite a concurrent password update", async () => {
        mocks.compare.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        mocks.updateMany.mockResolvedValue({ count: 0 });
        await expect(changeUserPassword(7, "old-secret", "new-secret"))
            .rejects.toMatchObject({ statusCode: 409 });
    });
});
