import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    eval: vi.fn(),
    reset: vi.fn(),
}));

vi.mock("./redis.js", () => ({
    getQueueProducerConnection: () => ({ eval: mocks.eval }),
    resetQueueProducerConnection: mocks.reset,
}));

import { consumeRateLimit } from "./rate-limit.js";

describe("consumeRateLimit", () => {
    beforeEach(() => {
        mocks.eval.mockReset();
        mocks.reset.mockReset();
    });

    it("returns the incremented count and TTL", async () => {
        mocks.eval.mockResolvedValue([2, 47]);

        await expect(consumeRateLimit("login", "127.0.0.1", 60)).resolves.toEqual({
            count: 2,
            retryAfterSeconds: 47,
        });
        expect(mocks.reset).not.toHaveBeenCalled();
    });

    it("drops a failed cached Redis producer without surfacing connection details", async () => {
        mocks.eval.mockRejectedValue(new Error("redis://private:password@host"));

        await expect(consumeRateLimit("login", "127.0.0.1", 60))
            .rejects.toThrow("Rate limit store is unavailable");
        expect(mocks.reset).toHaveBeenCalledOnce();
    });

    it("rejects malformed Redis results", async () => {
        mocks.eval.mockResolvedValue(["one", -1]);

        await expect(consumeRateLimit("login", "127.0.0.1", 60))
            .rejects.toThrow("Rate limit store returned an invalid result");
    });
});
