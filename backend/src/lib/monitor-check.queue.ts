import { createHash } from "node:crypto";
import { Queue, type JobsOptions, type QueueOptions } from "bullmq";
import type Redis from "ioredis";
import {
    closeQueueProducerConnection,
    getQueueProducerConnection,
    resetQueueProducerConnection,
} from "./redis.js";

export const MONITOR_CHECK_QUEUE_NAME = "monitor-checks";
export const MONITOR_CHECK_JOB_NAME = "check-monitor";

/**
 * Data for one scheduled check. `scheduledOccurrenceId` must identify the
 * particular due occurrence, so repeat scheduler scans generate the same job.
 */
export interface MonitorCheckJobData {
    monitorId: string;
    scheduledOccurrenceId: string;
}

export const MONITOR_CHECK_ATTEMPTS = 3;
export const MONITOR_CHECK_RETRY_BACKOFF_MS = 5_000;
// A terminal failure can be retried after this cooldown, using the same job ID.
export const MONITOR_CHECK_FAILED_RECOVERY_COOLDOWN_MS = 5 * 60_000;
export const MONITOR_CHECK_RETRYABLE_FAILURE_REASON =
    "Retryable monitor check infrastructure failure";
export const MONITOR_CHECK_NON_RETRYABLE_FAILURE_PREFIX =
    "Non-retryable monitor check:";

// Only unhandled infrastructure failures reach BullMQ. Normal HTTP failures are
// saved as DOWN checks by checkMonitor and complete the job successfully.
export const MONITOR_CHECK_DEFAULT_JOB_OPTIONS: JobsOptions = Object.freeze({
    attempts: MONITOR_CHECK_ATTEMPTS,
    backoff: {
        type: "exponential",
        delay: MONITOR_CHECK_RETRY_BACKOFF_MS,
    },
    removeOnComplete: { age: 24 * 60 * 60, count: 10_000 },
    removeOnFail: { age: 7 * 24 * 60 * 60, count: 1_000 },
});

/** Build a stable BullMQ-safe ID from the monitor and its scheduled occurrence. */
export function buildMonitorCheckJobId(data: MonitorCheckJobData): string {
    if (!data.monitorId.trim() || !data.scheduledOccurrenceId.trim()) {
        throw new Error("Monitor check jobs require monitor and occurrence IDs");
    }

    const digest = createHash("sha256")
        .update(JSON.stringify([data.monitorId, data.scheduledOccurrenceId]))
        .digest("hex");
    return `monitor-check-${digest}`;
}

export function createMonitorCheckQueueOptions(
    connection: Redis = getQueueProducerConnection(),
): QueueOptions {
    return {
        connection,
        defaultJobOptions: MONITOR_CHECK_DEFAULT_JOB_OPTIONS,
    };
}

let monitorCheckQueue: Queue<MonitorCheckJobData> | undefined;

/** Lazily create the shared queue; module import performs no I/O or DB work. */
export function getMonitorCheckQueue(): Queue<MonitorCheckJobData> {
    monitorCheckQueue ??= new Queue<MonitorCheckJobData>(
        MONITOR_CHECK_QUEUE_NAME,
        createMonitorCheckQueueOptions(),
    );
    return monitorCheckQueue;
}

/** Close this process's queue handle without closing the shared Redis client. */
export async function closeMonitorCheckQueue(): Promise<void> {
    const queue = monitorCheckQueue;
    monitorCheckQueue = undefined;
    const closeQueue = queue?.close() ?? Promise.resolve();
    const closeRedis = closeQueueProducerConnection();
    const results = await Promise.allSettled([closeQueue, closeRedis]);
    if (results.some((result) => result.status === "rejected")) {
        throw new Error("Monitor check queue cleanup was incomplete");
    }
}

/** Enqueue one scheduled occurrence with a deterministic duplicate key. */
export function enqueueMonitorCheck(data: MonitorCheckJobData) {
    const queue = getMonitorCheckQueue();
    return enqueueMonitorCheckOnQueue(queue, data).catch((error) => {
        if (monitorCheckQueue === queue) monitorCheckQueue = undefined;
        // Closing the producer rejects any command that was left in flight.
        // Its job ID remains stable, so a later scan can safely inspect/add it.
        resetQueueProducerConnection();
        void queue.close().catch(() => undefined);
        throw error;
    });
}

/**
 * Enqueue once per occurrence. BullMQ keeps failed jobs under their job ID, so
 * after a cooldown we explicitly retry that failed job instead of silently
 * treating every later scheduler scan as a duplicate.
 */
export async function enqueueMonitorCheckOnQueue(
    queue: Pick<Queue<MonitorCheckJobData>, "add" | "getJob">,
    data: MonitorCheckJobData,
    now = Date.now(),
) {
    const jobId = buildMonitorCheckJobId(data);
    const existing = await queue.getJob(jobId);

    if (existing) {
        const state = await existing.getState();
        const failedLongEnough =
            state === "failed" &&
            existing.failedReason === MONITOR_CHECK_RETRYABLE_FAILURE_REASON &&
            existing.finishedOn !== undefined &&
            now - existing.finishedOn >= MONITOR_CHECK_FAILED_RECOVERY_COOLDOWN_MS;

        if (failedLongEnough) {
            try {
                // BullMQ moves this same job atomically from failed to waiting.
                // Competing scheduler processes cannot both retry the same state.
                await existing.retry("failed", {
                    resetAttemptsMade: true,
                    resetAttemptsStarted: true,
                });
            } catch (error) {
                // Another scheduler may have won the state transition. Treat that
                // as deduplicated only after confirming the job is no longer failed.
                const latestState = await existing.getState();
                if (latestState === "failed" || latestState === "unknown") {
                    throw error;
                }
            }
        }

        return existing;
    }

    return queue.add(MONITOR_CHECK_JOB_NAME, data, { jobId });
}
