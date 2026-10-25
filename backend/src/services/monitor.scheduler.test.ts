import { afterEach, describe, expect, it, vi } from "vitest";
import {
    buildMonitorCheckJobId,
    type MonitorCheckJobData,
} from "../lib/monitor-check.queue.js";
import {
    createMonitorScheduler,
    MONITOR_SCHEDULER_BATCH_SIZE,
    MONITOR_SCHEDULER_ENQUEUE_TIMEOUT_MS,
    MONITOR_SCHEDULER_QUEUE_FAILURE_BACKOFF_MS,
    MONITOR_SCHEDULER_SCAN_INTERVAL_MS,
    type LatestMonitorCheck,
    type MonitorSchedulerDependencies,
    type ScheduledMonitor,
} from "./monitor.scheduler.js";

vi.mock("../lib/prisma.js", () => ({
    prisma: {
        monitor: { findMany: vi.fn() },
        monitorCheck: { findFirst: vi.fn() },
    },
}));

const now = Date.parse("2026-10-25T12:00:00.000Z");

function activeMonitor(overrides: Partial<ScheduledMonitor> = {}): ScheduledMonitor {
    return {
        id: 17,
        isActive: true,
        intervalSeconds: 60,
        latestCheck: latestCheck(),
        ...overrides,
    };
}

function latestCheck(overrides: Partial<LatestMonitorCheck> = {}): LatestMonitorCheck {
    return {
        id: 42,
        checkedAt: new Date(now - 60_000),
        ...overrides,
    };
}

function schedulerDependencies(
    overrides: Partial<MonitorSchedulerDependencies> = {},
): MonitorSchedulerDependencies {
    return {
        findActiveMonitors: async () => [activeMonitor()],
        enqueue: async () => undefined,
        now: () => now,
        ...overrides,
    };
}

async function scan(dependencies: MonitorSchedulerDependencies) {
    const scheduler = createMonitorScheduler(dependencies);
    scheduler.start();
    await scheduler.scanOnce();
    await scheduler.stop();
}

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("monitor scheduler queueing", () => {
    it("enqueues a due monitor with its preceding-check occurrence ID", async () => {
        const enqueue = vi.fn(async (_data: MonitorCheckJobData) => undefined);
        await scan(schedulerDependencies({ enqueue }));

        expect(enqueue).toHaveBeenCalledExactlyOnceWith({
            monitorId: "17",
            scheduledOccurrenceId: "after-check-42",
        });
    });

    it("does not enqueue a monitor before its configured interval has elapsed", async () => {
        const enqueue = vi.fn(async () => undefined);
        await scan(schedulerDependencies({
            findActiveMonitors: async () => [activeMonitor({ latestCheck: latestCheck({
                checkedAt: new Date(now - 59_999),
            }) })],
            enqueue,
        }));

        expect(enqueue).not.toHaveBeenCalled();
    });

    it("uses the same occurrence and queue ID across repeated scans", async () => {
        const enqueue = vi.fn(async (_data: MonitorCheckJobData) => undefined);
        const dependencies = schedulerDependencies({
            findActiveMonitors: async () => [activeMonitor({ latestCheck: null })],
            enqueue,
        });
        const scheduler = createMonitorScheduler(dependencies);
        scheduler.start();

        await scheduler.scanOnce();
        await scheduler.scanOnce();
        await scheduler.stop();

        expect(enqueue).toHaveBeenNthCalledWith(1, {
            monitorId: "17",
            scheduledOccurrenceId: "initial-check",
        });
        expect(enqueue).toHaveBeenNthCalledWith(2, {
            monitorId: "17",
            scheduledOccurrenceId: "initial-check",
        });
        const jobData = enqueue.mock.calls[0]?.[0];
        expect(jobData).toBeDefined();
        expect(buildMonitorCheckJobId(jobData!)).toBe(
            buildMonitorCheckJobId(enqueue.mock.calls[1]![0]),
        );
    });

    it("does not inspect or enqueue inactive monitors", async () => {
        const enqueue = vi.fn(async () => undefined);
        await scan(schedulerDependencies({
            findActiveMonitors: async () => [activeMonitor({ isActive: false })],
            enqueue,
        }));

        expect(enqueue).not.toHaveBeenCalled();
    });

    it("continues after enqueue failure and retries it on a later scan", async () => {
        let scanNow = now;
        const enqueue = vi.fn()
            .mockRejectedValueOnce(new Error("redis://private-secret"))
            .mockResolvedValue(undefined);
        const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const dependencies = schedulerDependencies({ enqueue, now: () => scanNow });
        const scheduler = createMonitorScheduler(dependencies);
        scheduler.start();

        await scheduler.scanOnce();
        await scheduler.scanOnce();
        expect(enqueue).toHaveBeenCalledOnce();
        scanNow += MONITOR_SCHEDULER_QUEUE_FAILURE_BACKOFF_MS;
        await scheduler.scanOnce();
        await scheduler.stop();

        expect(enqueue).toHaveBeenCalledTimes(2);
        expect(log).toHaveBeenCalledWith(
            "Monitor scheduler could not enqueue a check",
            { monitorId: 17 },
        );
        expect(JSON.stringify(log.mock.calls)).not.toContain("private-secret");
    });

    it("prevents overlapping scans in one scheduler process", async () => {
        let resolveMonitors: ((monitors: ScheduledMonitor[]) => void) | undefined;
        const findActiveMonitors = vi.fn(() => new Promise<ScheduledMonitor[]>((resolve) => {
            resolveMonitors = resolve;
        }));
        const scheduler = createMonitorScheduler(schedulerDependencies({ findActiveMonitors }));
        scheduler.start();

        const firstScan = scheduler.scanOnce();
        const overlappingScan = scheduler.scanOnce();

        expect(overlappingScan).toBe(firstScan);
        expect(findActiveMonitors).toHaveBeenCalledTimes(1);
        resolveMonitors?.([]);
        await firstScan;
        await scheduler.stop();
    });

    it("reads active monitors in bounded pages", async () => {
        vi.spyOn(console, "log").mockImplementation(() => undefined);
        const page = Array.from({ length: MONITOR_SCHEDULER_BATCH_SIZE }, (_, index) =>
            activeMonitor({ id: index + 1, intervalSeconds: 60 }),
        );
        const findActiveMonitors = vi.fn()
            .mockResolvedValueOnce(page)
            .mockResolvedValueOnce([]);
        const scheduler = createMonitorScheduler(schedulerDependencies({
            findActiveMonitors,
            enqueue: async () => undefined,
        }));
        scheduler.start();

        await scheduler.scanOnce();
        await scheduler.stop();

        expect(findActiveMonitors).toHaveBeenNthCalledWith(1, undefined, MONITOR_SCHEDULER_BATCH_SIZE);
        expect(findActiveMonitors).toHaveBeenNthCalledWith(2, MONITOR_SCHEDULER_BATCH_SIZE, MONITOR_SCHEDULER_BATCH_SIZE);
    });

    it("bounds a Redis enqueue wait and stops the current scan", async () => {
        vi.useFakeTimers();
        const enqueue = vi.fn(() => new Promise<unknown>(() => undefined));
        const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const scheduler = createMonitorScheduler(schedulerDependencies({ enqueue }));
        scheduler.start();

        const scanPromise = scheduler.scanOnce();
        await vi.advanceTimersByTimeAsync(MONITOR_SCHEDULER_ENQUEUE_TIMEOUT_MS);
        await scanPromise;
        await scheduler.scanOnce();
        await scheduler.stop();

        expect(enqueue).toHaveBeenCalledOnce();
        expect(log).toHaveBeenCalledWith(
            "Monitor scheduler could not enqueue a check",
            { monitorId: 17 },
        );
    });

    it("handles a successful queue command that settles after the caller timeout", async () => {
        vi.useFakeTimers();
        let resolveFirst: (() => void) | undefined;
        let scanNow = now;
        const enqueue = vi.fn()
            .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveFirst = resolve; }))
            .mockResolvedValue(undefined);
        const scheduler = createMonitorScheduler(schedulerDependencies({
            enqueue,
            now: () => scanNow,
        }));
        scheduler.start();

        const firstScan = scheduler.scanOnce();
        await vi.waitFor(() => expect(enqueue).toHaveBeenCalledOnce());
        await vi.advanceTimersByTimeAsync(MONITOR_SCHEDULER_ENQUEUE_TIMEOUT_MS);
        await firstScan;
        resolveFirst?.();
        await Promise.resolve();
        await Promise.resolve();

        scanNow += MONITOR_SCHEDULER_QUEUE_FAILURE_BACKOFF_MS;
        await scheduler.scanOnce();
        await scheduler.stop();

        expect(enqueue).toHaveBeenCalledTimes(2);
        expect(enqueue.mock.calls[0]?.[0]).toEqual(enqueue.mock.calls[1]?.[0]);
    });

    it("handles a late queue rejection and permits a later retry without an unhandled rejection", async () => {
        vi.useFakeTimers();
        let rejectFirst: ((error: Error) => void) | undefined;
        let scanNow = now;
        const enqueue = vi.fn()
            .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectFirst = reject; }))
            .mockResolvedValue(undefined);
        const scheduler = createMonitorScheduler(schedulerDependencies({
            enqueue,
            now: () => scanNow,
        }));
        scheduler.start();

        const firstScan = scheduler.scanOnce();
        await vi.waitFor(() => expect(enqueue).toHaveBeenCalledOnce());
        await vi.advanceTimersByTimeAsync(MONITOR_SCHEDULER_ENQUEUE_TIMEOUT_MS);
        await firstScan;
        rejectFirst?.(new Error("late Redis failure"));
        await Promise.resolve();
        await Promise.resolve();

        scanNow += MONITOR_SCHEDULER_QUEUE_FAILURE_BACKOFF_MS;
        await scheduler.scanOnce();
        await scheduler.stop();

        expect(enqueue).toHaveBeenCalledTimes(2);
        expect(enqueue.mock.calls[0]?.[0]).toEqual(enqueue.mock.calls[1]?.[0]);
    });

    it("returns at its shutdown deadline when a scan is still blocked", async () => {
        let finishEnqueue: (() => void) | undefined;
        const enqueue = vi.fn(async () => new Promise<void>((resolve) => {
            finishEnqueue = resolve;
        }));
        const scheduler = createMonitorScheduler(schedulerDependencies({
            enqueue,
        }));
        scheduler.start();
        const scanPromise = scheduler.scanOnce();
        await vi.waitFor(() => expect(enqueue).toHaveBeenCalledOnce());
        const stopPromise = scheduler.stop(1);

        await expect(stopPromise).resolves.toBe(false);
        finishEnqueue?.();
        await scanPromise;
    });

    it("scans every 10 seconds to support the minimum accepted interval", async () => {
        vi.useFakeTimers();
        const findActiveMonitors = vi.fn(async () => []);
        const scheduler = createMonitorScheduler(
            schedulerDependencies({ findActiveMonitors }),
        );
        scheduler.start();

        await vi.advanceTimersByTimeAsync(MONITOR_SCHEDULER_SCAN_INTERVAL_MS - 1);
        expect(findActiveMonitors).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(findActiveMonitors).toHaveBeenCalledTimes(1);

        await scheduler.stop();
    });
});
