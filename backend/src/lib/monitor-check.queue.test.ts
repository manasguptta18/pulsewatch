import { describe, expect, it, vi } from "vitest";
import {
    buildMonitorCheckJobId,
    createMonitorCheckQueueOptions,
    enqueueMonitorCheckOnQueue,
    MONITOR_CHECK_DEFAULT_JOB_OPTIONS,
    MONITOR_CHECK_FAILED_RECOVERY_COOLDOWN_MS,
    MONITOR_CHECK_NON_RETRYABLE_FAILURE_PREFIX,
    MONITOR_CHECK_RETRYABLE_FAILURE_REASON,
    MONITOR_CHECK_RETRY_BACKOFF_MS,
    MONITOR_CHECK_ATTEMPTS,
    MONITOR_CHECK_JOB_NAME,
    MONITOR_CHECK_QUEUE_NAME,
    type MonitorCheckJobData,
} from "./monitor-check.queue.js";

describe("monitor-check queue configuration", () => {
    const occurrence: MonitorCheckJobData = {
        monitorId: "monitor-123",
        scheduledOccurrenceId: "2026-10-25T12:00:00.000Z",
    };

    it("defines a shared queue and documented job name", () => {
        expect(MONITOR_CHECK_QUEUE_NAME).toBe("monitor-checks");
        expect(MONITOR_CHECK_JOB_NAME).toBe("check-monitor");
    });

    it("creates the same ID for the same monitor occurrence", () => {
        expect(buildMonitorCheckJobId(occurrence)).toBe(
            buildMonitorCheckJobId({ ...occurrence }),
        );
        expect(buildMonitorCheckJobId(occurrence)).toMatch(/^monitor-check-[a-f0-9]{64}$/);
        expect(buildMonitorCheckJobId(occurrence)).not.toContain(":");
    });

    it("uses a different ID for a different scheduled occurrence", () => {
        expect(buildMonitorCheckJobId(occurrence)).not.toBe(
            buildMonitorCheckJobId({
                ...occurrence,
                scheduledOccurrenceId: "2026-10-25T12:01:00.000Z",
            }),
        );
    });

    it("uses a small exponential retry policy and bounded retention", () => {
        expect(MONITOR_CHECK_DEFAULT_JOB_OPTIONS).toEqual({
            attempts: MONITOR_CHECK_ATTEMPTS,
            backoff: { type: "exponential", delay: MONITOR_CHECK_RETRY_BACKOFF_MS },
            removeOnComplete: { age: 24 * 60 * 60, count: 10_000 },
            removeOnFail: { age: 7 * 24 * 60 * 60, count: 1_000 },
        });
    });

    it("does not enqueue another copy while the same occurrence is still present", async () => {
        const existing = {
            finishedOn: undefined,
            getState: async () => "waiting",
            retry: async () => undefined,
        };
        const queue = {
            getJob: async () => existing,
            add: async () => { throw new Error("should not add a duplicate"); },
        };

        await expect(enqueueMonitorCheckOnQueue(queue as never, occurrence, 100_000))
            .resolves.toBe(existing);
    });

    it("waits through the recovery cooldown before retrying a terminal failed job", async () => {
        const retry = vi.fn(async () => undefined);
        const existing = {
            finishedOn: 100_000,
            failedReason: MONITOR_CHECK_RETRYABLE_FAILURE_REASON,
            getState: async () => "failed",
            retry,
        };
        const queue = {
            getJob: async () => existing,
            add: async () => { throw new Error("should retry the existing ID"); },
        };

        await enqueueMonitorCheckOnQueue(queue as never, occurrence,
            100_000 + MONITOR_CHECK_FAILED_RECOVERY_COOLDOWN_MS - 1);
        expect(retry).not.toHaveBeenCalled();

        await enqueueMonitorCheckOnQueue(queue as never, occurrence,
            100_000 + MONITOR_CHECK_FAILED_RECOVERY_COOLDOWN_MS);
        expect(retry).toHaveBeenCalledExactlyOnceWith("failed", {
            resetAttemptsMade: true,
            resetAttemptsStarted: true,
        });
    });

    it("retries a terminal failed occurrence using the same stable job ID", async () => {
        const retry = vi.fn(async () => undefined);
        const existing = {
            finishedOn: 1,
            failedReason: MONITOR_CHECK_RETRYABLE_FAILURE_REASON,
            getState: async () => "failed",
            retry,
        };
        const add = vi.fn();
        const queue = { getJob: async () => existing, add };

        await enqueueMonitorCheckOnQueue(queue as never, occurrence,
            1 + MONITOR_CHECK_FAILED_RECOVERY_COOLDOWN_MS);

        expect(retry).toHaveBeenCalledOnce();
        expect(add).not.toHaveBeenCalled();
        expect(buildMonitorCheckJobId(occurrence)).toMatch(/^monitor-check-/);
    });

    it("does not periodically retry explicitly non-retryable failed jobs", async () => {
        const retry = vi.fn(async () => undefined);
        const existing = {
            finishedOn: 1,
            failedReason: `${MONITOR_CHECK_NON_RETRYABLE_FAILURE_PREFIX} invalid job`,
            getState: async () => "failed",
            retry,
        };
        const queue = {
            getJob: async () => existing,
            add: async () => { throw new Error("should preserve failed job"); },
        };

        await enqueueMonitorCheckOnQueue(queue as never, occurrence,
            1 + MONITOR_CHECK_FAILED_RECOVERY_COOLDOWN_MS * 2);

        expect(retry).not.toHaveBeenCalled();
    });

    it("can configure queue options without creating Redis or database connections", () => {
        const connection = {} as import("ioredis").default;
        const options = createMonitorCheckQueueOptions(connection);

        expect(options.connection).toBe(connection);
        expect(options.defaultJobOptions).toBe(MONITOR_CHECK_DEFAULT_JOB_OPTIONS);
    });

    it("rejects missing identity values before enqueueing", () => {
        expect(() => buildMonitorCheckJobId({ ...occurrence, monitorId: " " })).toThrow(
            "Monitor check jobs require monitor and occurrence IDs",
        );
    });
});
