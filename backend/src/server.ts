import { createServer } from "node:http";
import { app } from "./app.js";
import { closeMonitorCheckQueue } from "./lib/monitor-check.queue.js";
import { closeRedisConnection } from "./lib/redis.js";
import { closeSocketAdapter, initializeSocket } from "./lib/socket.js";
import { prisma } from "./lib/prisma.js";
import { startMonitorScheduler } from "./services/monitor.scheduler.js";
import { parseApiPort, validateRuntimeEnvironment } from "./lib/runtime-env.js";

const port = parseApiPort(process.env.PORT);
export const API_SHUTDOWN_TIMEOUT_MS = 30_000;
const SHUTDOWN_STEP_TIMEOUT_MS = 5_000;

async function settleShutdownStep(
    operation: Promise<unknown>,
    timeoutMs = SHUTDOWN_STEP_TIMEOUT_MS,
): Promise<"complete" | "failed" | "timed-out"> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            operation.then(
                () => "complete" as const,
                () => "failed" as const,
            ),
            new Promise<"timed-out">((resolveTimeout) => {
                timer = setTimeout(() => resolveTimeout("timed-out"), timeoutMs);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

const httpServer = createServer(app);
validateRuntimeEnvironment("api");
const socketServer = initializeSocket(httpServer);

httpServer.listen(port, () => {
    console.log(`server running on port ${port}`);
});

const stopScheduler = startMonitorScheduler();

async function shutdown(): Promise<void> {
    const deadline = Date.now() + API_SHUTDOWN_TIMEOUT_MS;
    const remaining = () => Math.max(0, deadline - Date.now());

    // Stop accepting new HTTP/socket work first. Socket close also closes the
    // HTTP listener; if clients do not drain, force-close HTTP connections.
    const serverClose = new Promise<void>((resolveClose) => {
        socketServer.close(() => resolveClose());
    });
    const serverCloseResult = await settleShutdownStep(
        serverClose,
        Math.min(SHUTDOWN_STEP_TIMEOUT_MS, remaining()),
    );
    if (serverCloseResult !== "complete") {
        console.error("HTTP and Socket.IO server shutdown reached its deadline");
        httpServer.closeAllConnections();
    }

    // A scan may be waiting on Redis. Its own deadline lets shutdown progress;
    // closing Redis below interrupts a pending queue operation after that limit.
    const schedulerResult = await settleShutdownStep(
        stopScheduler(),
        Math.min(10_000, remaining()),
    );
    if (schedulerResult !== "complete") {
        console.error("Monitor scheduler did not stop before the shutdown deadline");
    }

    const cleanup = [
        ["monitor queue", closeMonitorCheckQueue],
        ["Socket.IO Redis adapter", closeSocketAdapter],
        ["Redis", closeRedisConnection],
        ["Prisma", () => prisma.$disconnect()],
    ] as const;

    for (const [resourceName, closeResource] of cleanup) {
        const result = await settleShutdownStep(
            Promise.resolve().then(closeResource),
            Math.min(SHUTDOWN_STEP_TIMEOUT_MS, remaining()),
        );
        if (result !== "complete") {
            console.error(`${resourceName} shutdown failed`);
        }
    }
}

let shutdownPromise: Promise<void> | undefined;
function handleShutdownSignal(): void {
    shutdownPromise ??= shutdown().catch(() => {
        console.error("API shutdown failed");
        process.exitCode = 1;
    });
}

process.once("SIGINT", handleShutdownSignal);
process.once("SIGTERM", handleShutdownSignal);
