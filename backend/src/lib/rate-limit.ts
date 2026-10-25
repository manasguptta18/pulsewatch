import { createHash } from "node:crypto";
import { getQueueProducerConnection, resetQueueProducerConnection } from "./redis.js";

const FIXED_WINDOW_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return { count, redis.call('TTL', KEYS[1]) }
`;

/**
 * Consume one Redis-backed fixed-window rate-limit slot. Redis failure is
 * surfaced so authentication routes can fail closed with a generic response.
 */
export async function consumeRateLimit(
    scope: string,
    clientAddress: string,
    windowSeconds: number,
): Promise<{ count: number; retryAfterSeconds: number }> {
    const addressDigest = createHash("sha256").update(clientAddress).digest("hex");
    const key = `pulsewatch:rate-limit:${scope}:${addressDigest}`;
    let result: unknown;
    try {
        result = await getQueueProducerConnection().eval(
            FIXED_WINDOW_SCRIPT,
            1,
            key,
            String(windowSeconds),
        );
    } catch {
        // A producer that exhausted its bounded reconnect attempts may be in
        // the ended state. Drop the cached client so a later request can retry
        // with a fresh connection after Redis recovers.
        resetQueueProducerConnection();
        throw new Error("Rate limit store is unavailable");
    }
    if (
        !Array.isArray(result) ||
        typeof result[0] !== "number" ||
        typeof result[1] !== "number"
    ) {
        throw new Error("Rate limit store returned an invalid result");
    }
    return {
        count: result[0],
        retryAfterSeconds: Math.max(1, result[1]),
    };
}
