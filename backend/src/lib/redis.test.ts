import { describe, expect, it, vi } from "vitest";
import {
    closeRedisClient,
    createRedisConnection,
    createQueueProducerConnection,
    validateRedisUrl,
} from "./redis.js";

describe("validateRedisUrl", () => {
    it.each([
        "redis://localhost:6379/0",
        "rediss://user:secret@redis.example.com:6380/2",
        "redis://[::1]:6379",
    ])("accepts a Redis URL: %s", (redisUrl) => {
        expect(validateRedisUrl(redisUrl)).toBe(redisUrl);
    });

    it.each([
        undefined,
        "",
        " redis://localhost:6379",
        "http://localhost:6379",
        "redis://",
        "redis://localhost:6379/?unexpected=true",
        "redis://localhost:6379/#fragment",
        "redis://localhost:6379/not-a-database",
        "rediss://user:secret@",
    ])("rejects invalid Redis configuration without echoing it: %s", (redisUrl) => {
        try {
            validateRedisUrl(redisUrl);
            throw new Error("Expected Redis URL validation to fail");
        } catch (error) {
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toBe(
                "REDIS_URL must be a valid Redis connection URL",
            );
            expect((error as Error).message).not.toContain("secret");
        }
    });
});

describe("closeRedisClient", () => {
    it("disconnects when Redis QUIT does not finish before the deadline", async () => {
        const disconnect = vi.fn();
        const connection = {
            status: "ready",
            quit: vi.fn(() => new Promise(() => undefined)),
            disconnect,
        };

        await closeRedisClient(connection as never, 1);

        expect(disconnect).toHaveBeenCalledOnce();
    });
});

describe("queue producer Redis connection", () => {
    it("uses finite connection and command bounds without an offline command backlog", () => {
        const connection = createQueueProducerConnection("redis://127.0.0.1:6379/15");

        expect(connection.options.connectTimeout).toBe(5_000);
        expect(connection.options.commandTimeout).toBe(8_000);
        expect(connection.options.enableOfflineQueue).toBe(false);
        expect(connection.options.maxRetriesPerRequest).toBeNull();
        expect(connection.status).toBe("wait");
        connection.disconnect();
    });

    it("logs safe error codes without exposing connection details", () => {
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const connection = createRedisConnection("redis://127.0.0.1:6379/15");
        connection.emit("error", Object.assign(
            new Error("redis://user:secret@internal.example:6379"),
            { code: "ECONNREFUSED" },
        ));

        expect(errorLog).toHaveBeenCalledExactlyOnceWith("Redis connection error", {
            errorName: "Error",
            errorCodes: ["ECONNREFUSED"],
        });
        expect(JSON.stringify(errorLog.mock.calls)).not.toContain("secret");
        connection.disconnect();
        errorLog.mockRestore();
    });
});
