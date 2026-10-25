import "dotenv/config";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Emitter } from "@socket.io/redis-emitter";
import { UnrecoverableError, Worker, type Job, type WorkerOptions } from "bullmq";
import type Redis from "ioredis";
import {
    MONITOR_CHECK_NON_RETRYABLE_FAILURE_PREFIX,
    MONITOR_CHECK_QUEUE_NAME,
    MONITOR_CHECK_RETRYABLE_FAILURE_REASON,
    type MonitorCheckJobData,
} from "../lib/monitor-check.queue.js";
import {
    closeRedisConnection,
    createRedisConnection,
    getRedisConnection,
} from "../lib/redis.js";
import { setSocketEventPublisher } from "../lib/socket.js";
import { AppError } from "../errors/app-error.js";
import { startNotificationOutboxProcessor } from "../services/notification-outbox.service.js";
import { validateRuntimeEnvironment } from "../lib/runtime-env.js";

export const DEFAULT_MONITOR_WORKER_CONCURRENCY = 5;
export const MAX_MONITOR_WORKER_CONCURRENCY = 32;
export const WORKER_SHUTDOWN_TIMEOUT_MS = 30_000;

const CONCURRENCY_ERROR =
    `MONITOR_WORKER_CONCURRENCY must be an integer from 1 to ${MAX_MONITOR_WORKER_CONCURRENCY}`;
const INVALID_JOB_ERROR = "Invalid monitor check job data";

export interface ValidMonitorCheckJobData {
    monitorId: number;
    scheduledOccurrenceId: string;
}

/** Parse worker concurrency strictly; absent configuration uses the default. */
export function parseMonitorWorkerConcurrency(
    value: string | undefined,
): number {
    if (value === undefined) return DEFAULT_MONITOR_WORKER_CONCURRENCY;
    if (!/^[1-9]\d*$/.test(value)) throw new Error(CONCURRENCY_ERROR);

    const concurrency = Number(value);
    if (
        !Number.isSafeInteger(concurrency) ||
        concurrency > MAX_MONITOR_WORKER_CONCURRENCY
    ) {
        throw new Error(CONCURRENCY_ERROR);
    }

    return concurrency;
}

/** Validate Redis job data before using it to select a monitor. */
export function parseMonitorCheckJobData(
    value: unknown,
): ValidMonitorCheckJobData {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(INVALID_JOB_ERROR);
    }

    const data = value as Partial<MonitorCheckJobData>;
    if (
        typeof data.monitorId !== "string" ||
        !/^[1-9]\d*$/.test(data.monitorId) ||
        !Number.isSafeInteger(Number(data.monitorId)) ||
        typeof data.scheduledOccurrenceId !== "string" ||
        data.scheduledOccurrenceId.trim().length === 0 ||
        data.scheduledOccurrenceId.length > 256
    ) {
        throw new Error(INVALID_JOB_ERROR);
    }

    return {
        monitorId: Number(data.monitorId),
        scheduledOccurrenceId: data.scheduledOccurrenceId,
    };
}

export class ActiveMonitorJobTracker {
    private activeJobs = 0;
    private readonly idleWaiters = new Set<() => void>();

    async track<T>(operation: () => Promise<T>): Promise<T> {
        this.activeJobs += 1;
        try {
            return await operation();
        } finally {
            this.activeJobs -= 1;
            if (this.activeJobs === 0) {
                for (const resolveIdle of this.idleWaiters) resolveIdle();
                this.idleWaiters.clear();
            }
        }
    }

    waitForIdle(): Promise<void> {
        if (this.activeJobs === 0) return Promise.resolve();
        return new Promise((resolveIdle) => this.idleWaiters.add(resolveIdle));
    }
}

export type MonitorCheckFunction = (
    monitorId: number,
    scheduledOccurrenceId?: string,
) => Promise<unknown>;

/** The processor uses the established check pipeline and nothing else. */
export function createMonitorCheckProcessor(
    checkMonitor: MonitorCheckFunction,
    tracker = new ActiveMonitorJobTracker(),
) {
    return async (data: unknown) => {
        let validData: ValidMonitorCheckJobData;
        try {
            validData = parseMonitorCheckJobData(data);
        } catch {
            throw new UnrecoverableError(
                `${MONITOR_CHECK_NON_RETRYABLE_FAILURE_PREFIX} ${INVALID_JOB_ERROR}`,
            );
        }

        try {
            return await tracker.track(() => checkMonitor(
                validData.monitorId,
                validData.scheduledOccurrenceId,
            ));
        } catch (error) {
            if (error instanceof AppError) {
                // A deleted monitor is not an infrastructure outage; retrying it
                // cannot produce a check and would only retain a dead job.
                throw new UnrecoverableError(
                    `${MONITOR_CHECK_NON_RETRYABLE_FAILURE_PREFIX} monitor is no longer applicable`,
                );
            }
            // Store a useful category in BullMQ without copying database or
            // network errors (which can contain connection details) into Redis.
            throw new Error(MONITOR_CHECK_RETRYABLE_FAILURE_REASON);
        }
    };
}

export function createMonitorCheckWorkerOptions(
    connection: Redis,
    concurrency: number,
): WorkerOptions {
    if (
        !Number.isSafeInteger(concurrency) ||
        concurrency < 1 ||
        concurrency > MAX_MONITOR_WORKER_CONCURRENCY
    ) {
        throw new Error(CONCURRENCY_ERROR);
    }

    return { connection, concurrency };
}

interface WorkerLifecycle {
    pause(doNotWaitActive?: boolean): Promise<void>;
    close(force?: boolean): Promise<void>;
}

interface RedisLifecycle {
    status?: string;
    quit(): Promise<unknown>;
    disconnect(): void;
}

type TimedOperationResult = "resolved" | "rejected" | "timed-out";

async function settleWithin(
    operation: Promise<unknown>,
    timeoutMs: number,
): Promise<TimedOperationResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            operation.then(
                () => "resolved" as const,
                () => "rejected" as const,
            ),
            new Promise<TimedOperationResult>((resolveTimeout) => {
                timer = setTimeout(() => resolveTimeout("timed-out"), timeoutMs);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

export interface MonitorWorkerShutdownResources {
    worker: WorkerLifecycle;
    tracker: ActiveMonitorJobTracker;
    eventPublisherRedis: RedisLifecycle;
    stopOutboxProcessor: (timeoutMs: number) => Promise<boolean>;
    closeQueueRedis: () => Promise<void>;
    disconnectPrisma: () => Promise<void>;
}

/** Stop intake and drain work within a deadline before closing local resources. */
export async function shutdownMonitorCheckWorker(
    resources: MonitorWorkerShutdownResources,
    timeoutMs = WORKER_SHUTDOWN_TIMEOUT_MS,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const remaining = () => Math.max(0, deadline - Date.now());

    const outboxStopResult = await settleWithin(
        Promise.resolve().then(() => resources.stopOutboxProcessor(Math.min(5_000, remaining()))),
        remaining(),
    );
    if (outboxStopResult !== "resolved") {
        console.error("Notification outbox processor did not stop before the worker deadline");
    }

    // Pause only this worker. Bound this Redis-backed operation too, since Redis
    // may be unavailable while the process is stopping.
    const pauseResult = await settleWithin(
        Promise.resolve().then(() => resources.worker.pause(true)),
        remaining(),
    );
    let drained = false;
    if (pauseResult === "resolved") {
        drained = (await settleWithin(
            resources.tracker.waitForIdle(),
            remaining(),
        )) === "resolved";
    } else {
        console.error("Monitor worker could not pause before the shutdown deadline");
    }

    if (!drained) {
        console.error("Monitor worker shutdown deadline reached; active jobs may be retried");
    }

    // A hard deadline cannot cancel arbitrary JavaScript, database, or network
    // work. Force close makes unfinished jobs recoverable by BullMQ; resources
    // are then closed so this process can exit.
    const workerClose = Promise.resolve().then(() => resources.worker.close(!drained));
    const workerCloseResult = await settleWithin(
        workerClose,
        remaining(),
    );
    if (workerCloseResult !== "resolved") {
        console.error("Monitor worker could not close cleanly");
    }

    setSocketEventPublisher(null);
    const eventRedisClose = resources.eventPublisherRedis.status === "wait"
        ? Promise.resolve(resources.eventPublisherRedis.disconnect())
        : Promise.resolve().then(() => resources.eventPublisherRedis.quit());
    const eventRedisResult = await settleWithin(eventRedisClose, remaining());
    if (eventRedisResult !== "resolved") {
        resources.eventPublisherRedis.disconnect();
        console.error("Monitor worker event Redis cleanup was incomplete");
    }

    for (const [resourceName, cleanup] of [
        ["queue Redis", resources.closeQueueRedis],
        ["Prisma", resources.disconnectPrisma],
    ] as const) {
        const result = await settleWithin(
            Promise.resolve().then(cleanup),
            remaining(),
        );
        if (result !== "resolved") {
            console.error(`Monitor worker ${resourceName} cleanup was incomplete`);
        }
    }
}

export async function startMonitorCheckWorkerProcess() {
    validateRuntimeEnvironment("worker");
    const concurrency = parseMonitorWorkerConcurrency(
        process.env.MONITOR_WORKER_CONCURRENCY,
    );
    const queueRedis = getRedisConnection();
    const eventPublisherRedis = createRedisConnection();
    eventPublisherRedis.on("error", () => {
        console.error("Monitor worker event publisher Redis connection error");
    });

    let prismaClient: typeof import("../lib/prisma.js").prisma | undefined;
    let worker: Worker<MonitorCheckJobData, unknown, string> | undefined;
    let stopOutboxProcessor: ReturnType<typeof startNotificationOutboxProcessor> | undefined;
    try {
        await eventPublisherRedis.connect();
        const emitter = new Emitter(eventPublisherRedis);

        // checkMonitor and the incident services derive owner IDs from Prisma.
        // The job payload contains no user or room identity.
        setSocketEventPublisher((room, event, payload) => {
            emitter.to(room).emit(event, payload);
        });

        const [{ checkMonitor }, { prisma }] = await Promise.all([
            import("../services/monitor.service.js"),
            import("../lib/prisma.js"),
        ]);
        prismaClient = prisma;

        const tracker = new ActiveMonitorJobTracker();
        const processor = createMonitorCheckProcessor(checkMonitor, tracker);
        worker = new Worker<MonitorCheckJobData, unknown, string>(
            MONITOR_CHECK_QUEUE_NAME,
            (job: Job<MonitorCheckJobData>) => processor(job.data),
            createMonitorCheckWorkerOptions(queueRedis, concurrency),
        );
        worker.on("failed", (job) => {
            console.error("Monitor check job failed", job?.id ? { jobId: job.id } : {});
        });
        worker.on("error", () => {
            console.error("Monitor check worker encountered an error");
        });
        await worker.waitUntilReady();
        stopOutboxProcessor = startNotificationOutboxProcessor();

        return {
            worker,
            tracker,
            eventPublisherRedis,
            async shutdown() {
                await shutdownMonitorCheckWorker({
                    worker: worker!,
                    tracker,
                    eventPublisherRedis,
                    stopOutboxProcessor: stopOutboxProcessor!,
                    closeQueueRedis: closeRedisConnection,
                    disconnectPrisma: () => prisma.$disconnect(),
                });
            },
        };
    } catch {
        if (stopOutboxProcessor) await stopOutboxProcessor(0).catch(() => false);
        setSocketEventPublisher(null);
        if (worker) await worker.close(true).catch(() => undefined);
        eventPublisherRedis.disconnect();
        await closeRedisConnection().catch(() => undefined);
        if (prismaClient) await prismaClient.$disconnect().catch(() => undefined);
        throw new Error("Monitor worker failed to initialize");
    }
}

function isDirectEntrypoint(): boolean {
    const entrypoint = process.argv[1];
    return entrypoint !== undefined && pathToFileURL(resolve(entrypoint)).href === import.meta.url;
}

if (isDirectEntrypoint()) {
    void startMonitorCheckWorkerProcess()
        .then((runtime) => {
            let shutdownStarted = false;
            const shutdown = () => {
                if (shutdownStarted) return;
                shutdownStarted = true;
                void runtime.shutdown().catch(() => {
                    console.error("Monitor worker shutdown failed");
                    process.exitCode = 1;
                });
            };

            process.once("SIGTERM", shutdown);
            process.once("SIGINT", shutdown);
        })
        .catch(() => {
            console.error("Monitor worker failed to start");
            process.exitCode = 1;
        });
}
