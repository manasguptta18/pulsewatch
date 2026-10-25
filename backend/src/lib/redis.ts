import Redis from "ioredis";

const REDIS_URL_ERROR = "REDIS_URL must be a valid Redis connection URL";
const REDIS_SHUTDOWN_TIMEOUT_MS = 5_000;

/** Validate a Redis connection URL without including its contents in errors. */
export function validateRedisUrl(redisUrl: string | undefined): string {
    if (!redisUrl || redisUrl.trim() !== redisUrl) {
        throw new Error(REDIS_URL_ERROR);
    }

    let parsed: URL;
    try {
        parsed = new URL(redisUrl);
    } catch {
        throw new Error(REDIS_URL_ERROR);
    }

    if (
        (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") ||
        !parsed.hostname ||
        parsed.search ||
        parsed.hash ||
        !/^(?:\/\d*)?$/.test(parsed.pathname)
    ) {
        throw new Error(REDIS_URL_ERROR);
    }

    return redisUrl;
}

/** Create a lazy ioredis connection suitable for BullMQ. */
export function createRedisConnection(redisUrl = process.env.REDIS_URL) {
    return new Redis(validateRedisUrl(redisUrl), {
        // BullMQ requires this so blocking commands can wait for jobs safely.
        maxRetriesPerRequest: null,
        // Importing or configuring the queue must not connect to Redis by itself.
        lazyConnect: true,
    });
}

let redisConnection: ReturnType<typeof createRedisConnection> | undefined;
let queueProducerConnection: ReturnType<typeof createRedisConnection> | undefined;

/** Return the shared Redis connection, creating it only when requested. */
export function getRedisConnection() {
    redisConnection ??= createRedisConnection();
    return redisConnection;
}

/**
 * Queue producers need bounded Redis commands. Workers keep the BullMQ-required
 * retrying connection from getRedisConnection because their blocking reads are
 * intentionally long-lived.
 */
export function getQueueProducerConnection() {
    queueProducerConnection ??= createQueueProducerConnection();
    return queueProducerConnection;
}

export function createQueueProducerConnection(redisUrl = process.env.REDIS_URL) {
    return new Redis(validateRedisUrl(redisUrl), {
        maxRetriesPerRequest: null,
        lazyConnect: true,
        connectTimeout: 5_000,
        commandTimeout: 8_000,
        enableOfflineQueue: false,
        retryStrategy: (attempt) => attempt <= 3 ? attempt * 250 : null,
    });
}

/** Quit a Redis client within a deadline, then disconnect it if Redis is down. */
export async function closeRedisClient(
    connection: Pick<ReturnType<typeof createRedisConnection>, "status" | "quit" | "disconnect">,
    timeoutMs = REDIS_SHUTDOWN_TIMEOUT_MS,
): Promise<void> {
    if (connection.status === "wait" || connection.status === "end") {
        connection.disconnect();
        return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const result = await Promise.race([
            connection.quit().then(
                () => "closed" as const,
                () => "failed" as const,
            ),
            new Promise<"timed-out">((resolveTimeout) => {
                timer = setTimeout(() => resolveTimeout("timed-out"), timeoutMs);
            }),
        ]);

        if (result !== "closed") {
            connection.disconnect();
            if (result === "failed") {
                throw new Error("Redis client could not quit cleanly");
            }
        }
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/** Close the shared connection during process shutdown. */
export async function closeRedisConnection(): Promise<void> {
    if (!redisConnection) return;

    const connection = redisConnection;
    redisConnection = undefined;
    await closeRedisClient(connection);
}

/** Force-close a failed producer so a later scheduler scan can reconnect. */
export function resetQueueProducerConnection(): void {
    const connection = queueProducerConnection;
    queueProducerConnection = undefined;
    if (connection && connection.status !== "end") connection.disconnect();
}

export async function closeQueueProducerConnection(): Promise<void> {
    if (!queueProducerConnection) return;
    const connection = queueProducerConnection;
    queueProducerConnection = undefined;
    await closeRedisClient(connection);
}
