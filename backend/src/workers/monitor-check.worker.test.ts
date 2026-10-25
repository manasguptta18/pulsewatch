import { describe, expect, it, vi } from "vitest";
import { UnrecoverableError } from "bullmq";
import { AppError } from "../errors/app-error.js";
import {
    ActiveMonitorJobTracker,
    createMonitorCheckProcessor,
    createMonitorCheckWorkerOptions,
    DEFAULT_MONITOR_WORKER_CONCURRENCY,
    MAX_MONITOR_WORKER_CONCURRENCY,
    parseMonitorCheckJobData,
    parseMonitorWorkerConcurrency,
    shutdownMonitorCheckWorker,
    type MonitorWorkerShutdownResources,
} from "./monitor-check.worker.js";

describe("monitor check worker", () => {
    it("uses the existing monitor check function for valid jobs", async () => {
        const checkMonitor = vi.fn(async (monitorId: number) => ({ monitorId }));
        const process = createMonitorCheckProcessor(checkMonitor);

        await expect(process({
            monitorId: "42",
            scheduledOccurrenceId: "due-2026-10-25T12:00:00Z",
        })).resolves.toEqual({ monitorId: 42 });
        expect(checkMonitor).toHaveBeenCalledExactlyOnceWith(
            42,
            "due-2026-10-25T12:00:00Z",
        );
    });

    it("marks infrastructure failures retryable without storing internal details", async () => {
        const failure = new Error("database://private-connection-details");
        const checkMonitor = vi.fn(async () => { throw failure; });
        const process = createMonitorCheckProcessor(checkMonitor);

        const result = process({
            monitorId: "42",
            scheduledOccurrenceId: "due-1",
        });

        await expect(result).rejects.toThrow(
            "Retryable monitor check infrastructure failure",
        );
        await expect(result).rejects.not.toThrow("private-connection-details");
    });

    it("marks deleted monitors non-retryable", async () => {
        const process = createMonitorCheckProcessor(vi.fn(async () => {
            throw new AppError("Monitor not found", 404);
        }));

        await expect(process({
            monitorId: "42",
            scheduledOccurrenceId: "due-1",
        })).rejects.toMatchObject({
            name: new UnrecoverableError("test").name,
            message: expect.stringContaining("no longer applicable"),
        });
    });

    it.each([
        null,
        [],
        {},
        { monitorId: "0", scheduledOccurrenceId: "due-1" },
        { monitorId: "1.5", scheduledOccurrenceId: "due-1" },
        { monitorId: "9007199254740992", scheduledOccurrenceId: "due-1" },
        { monitorId: "1", scheduledOccurrenceId: " " },
        { monitorId: "1", scheduledOccurrenceId: "x".repeat(257) },
    ])("rejects invalid job data before calling the monitoring function", async (data) => {
        const checkMonitor = vi.fn(async () => undefined);
        const process = createMonitorCheckProcessor(checkMonitor);

        await expect(process(data)).rejects.toMatchObject({
            name: new UnrecoverableError("test").name,
            message: expect.stringContaining("Invalid monitor check job data"),
        });
        expect(checkMonitor).not.toHaveBeenCalled();
    });

    it("normalizes only a validated monitor ID from the shared payload", () => {
        expect(parseMonitorCheckJobData({
            monitorId: "12",
            scheduledOccurrenceId: "slot-12",
        })).toEqual({ monitorId: 12, scheduledOccurrenceId: "slot-12" });
    });

    it("uses a bounded default and strictly validates configured concurrency", () => {
        expect(parseMonitorWorkerConcurrency(undefined)).toBe(
            DEFAULT_MONITOR_WORKER_CONCURRENCY,
        );
        expect(parseMonitorWorkerConcurrency("1")).toBe(1);
        expect(parseMonitorWorkerConcurrency(String(MAX_MONITOR_WORKER_CONCURRENCY))).toBe(
            MAX_MONITOR_WORKER_CONCURRENCY,
        );

        for (const value of ["", "0", "01", "1.5", "-1", "33", "NaN"]) {
            expect(() => parseMonitorWorkerConcurrency(value)).toThrow(
                "MONITOR_WORKER_CONCURRENCY must be an integer",
            );
        }
    });

    it("passes the validated concurrency to BullMQ", () => {
        const connection = {} as import("ioredis").default;
        expect(createMonitorCheckWorkerOptions(connection, 7)).toEqual({
            connection,
            concurrency: 7,
        });
        expect(() => createMonitorCheckWorkerOptions(connection, 0)).toThrow(
            "MONITOR_WORKER_CONCURRENCY must be an integer",
        );
    });

    it("closes this worker's resources when no jobs are active", async () => {
        const calls: string[] = [];
        const resources: MonitorWorkerShutdownResources = {
            worker: {
                pause: vi.fn(async () => { calls.push("pause"); }),
                close: vi.fn(async (force = false) => { calls.push(`close:${force}`); }),
            },
            tracker: new ActiveMonitorJobTracker(),
            eventPublisherRedis: {
                quit: vi.fn(async () => { calls.push("event-redis"); }),
                disconnect: vi.fn(),
            },
            stopOutboxProcessor: vi.fn(async () => { calls.push("outbox"); return true; }),
            closeQueueRedis: vi.fn(async () => { calls.push("queue-redis"); }),
            disconnectPrisma: vi.fn(async () => { calls.push("prisma"); }),
        };

        await shutdownMonitorCheckWorker(resources, 50);

        expect(calls).toEqual([
            "outbox",
            "pause",
            "close:false",
            "event-redis",
            "queue-redis",
            "prisma",
        ]);
    });

    it("force closes after the drain deadline", async () => {
        let finishJob: (() => void) | undefined;
        const tracker = new ActiveMonitorJobTracker();
        const activeJob = tracker.track(() => new Promise<void>((resolve) => {
            finishJob = resolve;
        }));
        const close = vi.fn(async (force = false) => force);
        const resources: MonitorWorkerShutdownResources = {
            worker: {
                pause: vi.fn(async () => undefined),
                close,
            },
            tracker,
            eventPublisherRedis: {
                quit: vi.fn(async () => "OK"),
                disconnect: vi.fn(),
            },
            stopOutboxProcessor: vi.fn(async () => true),
            closeQueueRedis: vi.fn(async () => undefined),
            disconnectPrisma: vi.fn(async () => undefined),
        };

        await shutdownMonitorCheckWorker(resources, 1);
        expect(close).toHaveBeenCalledExactlyOnceWith(true);

        finishJob?.();
        await activeJob;
    });

    it("bounds a worker pause that cannot complete during Redis failure", async () => {
        const close = vi.fn(async () => undefined);
        const resources: MonitorWorkerShutdownResources = {
            worker: {
                pause: vi.fn(() => new Promise<void>(() => undefined)),
                close,
            },
            tracker: new ActiveMonitorJobTracker(),
            eventPublisherRedis: {
                status: "ready",
                quit: vi.fn(async () => "OK"),
                disconnect: vi.fn(),
            },
            stopOutboxProcessor: vi.fn(async () => true),
            closeQueueRedis: vi.fn(async () => undefined),
            disconnectPrisma: vi.fn(async () => undefined),
        };

        await shutdownMonitorCheckWorker(resources, 1);

        expect(close).toHaveBeenCalledExactlyOnceWith(true);
        expect(resources.closeQueueRedis).toHaveBeenCalledOnce();
        expect(resources.disconnectPrisma).toHaveBeenCalledOnce();
    });
});
