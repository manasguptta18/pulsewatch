import { prisma } from "../lib/prisma.js";
import {
    enqueueMonitorCheck,
    type MonitorCheckJobData,
} from "../lib/monitor-check.queue.js";

// Monitor validation permits intervals as short as 10 seconds, so scan at that
// cadence to avoid silently making those configured intervals impossible.
export const MONITOR_SCHEDULER_SCAN_INTERVAL_MS = 10_000;
export const MONITOR_SCHEDULER_BATCH_SIZE = 200;
export const MONITOR_SCHEDULER_ENQUEUE_TIMEOUT_MS = 5_000;
export const MONITOR_SCHEDULER_QUEUE_FAILURE_BACKOFF_MS = 30_000;
export const MONITOR_SCHEDULER_SHUTDOWN_TIMEOUT_MS = 10_000;

export interface ScheduledMonitor {
    id: number;
    isActive: boolean;
    intervalSeconds: number;
    latestCheck: LatestMonitorCheck | null;
}

export interface LatestMonitorCheck {
    id: number;
    checkedAt: Date;
}

export interface MonitorSchedulerDependencies {
    findActiveMonitors: (afterId?: number, take?: number) => Promise<ScheduledMonitor[]>;
    enqueue: (data: MonitorCheckJobData) => Promise<unknown>;
    now?: () => number;
}

const defaultDependencies: MonitorSchedulerDependencies = {
    findActiveMonitors: async (afterId, take = MONITOR_SCHEDULER_BATCH_SIZE) => {
        const monitors = await prisma.monitor.findMany({
            where: {
                isActive: true,
                ...(afterId === undefined ? {} : { id: { gt: afterId } }),
            },
            orderBy: { id: "asc" },
            take,
            select: {
                id: true,
                isActive: true,
                intervalSeconds: true,
                checks: {
                    orderBy: [{ checkedAt: "desc" }, { id: "desc" }],
                    take: 1,
                    select: { id: true, checkedAt: true },
                },
            },
        });
        return monitors.map(({ checks, ...monitor }) => ({
            ...monitor,
            latestCheck: checks[0] ?? null,
        }));
    },
    enqueue: enqueueMonitorCheck,
};

/**
 * Create a scheduler instance. Exposed dependencies keep the scan testable
 * without Redis or database connections.
 */
export function createMonitorScheduler(
    dependencies: MonitorSchedulerDependencies = defaultDependencies,
    scanIntervalMs = MONITOR_SCHEDULER_SCAN_INTERVAL_MS,
) {
    let timer: ReturnType<typeof setInterval> | undefined;
    let stopped = true;
    let inFlightScan: Promise<void> | undefined;
    let pendingQueueCommand: Promise<unknown> | undefined;
    let queueUnavailableUntil = 0;

    async function enqueueWithinTimeout(data: MonitorCheckJobData): Promise<void> {
        if (pendingQueueCommand) {
            throw new Error("A prior monitor enqueue is still pending");
        }

        const queueCommand = dependencies.enqueue(data);
        pendingQueueCommand = queueCommand;
        // Promise.race bounds this scan's wait; it does not cancel Redis work.
        // The production producer has finite connect/command bounds. Retain the
        // promise until it settles so a late success cannot create parallel adds.
        void queueCommand.then(
            () => {
                if (pendingQueueCommand === queueCommand) pendingQueueCommand = undefined;
            },
            () => {
                if (pendingQueueCommand === queueCommand) pendingQueueCommand = undefined;
            },
        );

        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([
                queueCommand,
                new Promise<never>((_, reject) => {
                    timer = setTimeout(
                        () => reject(new Error("Monitor check enqueue timed out")),
                        MONITOR_SCHEDULER_ENQUEUE_TIMEOUT_MS,
                    );
                }),
            ]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    async function performScan(): Promise<void> {
        try {
            const now = dependencies.now?.() ?? Date.now();
            if (now < queueUnavailableUntil || pendingQueueCommand) return;
            let afterId: number | undefined;

            while (!stopped) {
                const monitors = await dependencies.findActiveMonitors(
                    afterId,
                    MONITOR_SCHEDULER_BATCH_SIZE,
                );
                if (monitors.length === 0) break;

                for (const monitor of monitors) {
                    if (stopped) return;
                    // Defend against stale or mocked rows even though the query filters active monitors.
                    if (!monitor.isActive) continue;

                    const latestCheck = monitor.latestCheck;

                    const isDue =
                        !latestCheck ||
                        now - latestCheck.checkedAt.getTime() >=
                            monitor.intervalSeconds * 1000;
                    if (!isDue) continue;

                    // The preceding check ID identifies the next due occurrence.
                    // Repeated scans (and scheduler instances) derive the same ID
                    // until a new check is recorded.
                    const scheduledOccurrenceId = latestCheck
                        ? `after-check-${latestCheck.id}`
                        : "initial-check";

                    try {
                        await enqueueWithinTimeout({
                            monitorId: String(monitor.id),
                            scheduledOccurrenceId,
                        });
                        console.log("Monitor check enqueued", { monitorId: monitor.id });
                    } catch {
                        // Avoid generating a queue of pending Redis commands while
                        // the queue is unhealthy. Pause queue attempts briefly;
                        // then resume with the same deterministic occurrence ID.
                        queueUnavailableUntil =
                            (dependencies.now?.() ?? Date.now()) +
                            MONITOR_SCHEDULER_QUEUE_FAILURE_BACKOFF_MS;
                        console.error("Monitor scheduler could not enqueue a check", {
                            monitorId: monitor.id,
                        });
                        return;
                    }
                }

                afterId = monitors[monitors.length - 1]!.id;
                if (monitors.length < MONITOR_SCHEDULER_BATCH_SIZE) break;
            }
        } catch {
            // Avoid logging raw Redis/Prisma errors that may contain internal details.
            console.error("Monitor scheduler scan failed; it will retry on the next scan");
        }
    }

    function scanOnce(): Promise<void> {
        if (stopped) return Promise.resolve();
        if (inFlightScan) return inFlightScan;

        const scan = performScan();
        inFlightScan = scan.finally(() => {
            inFlightScan = undefined;
        });
        return inFlightScan;
    }

    function start(): () => Promise<boolean> {
        if (timer !== undefined) return stop;

        stopped = false;
        timer = setInterval(() => {
            void scanOnce();
        }, scanIntervalMs);
        return stop;
    }

    async function stop(
        timeoutMs = MONITOR_SCHEDULER_SHUTDOWN_TIMEOUT_MS,
    ): Promise<boolean> {
        stopped = true;
        if (timer !== undefined) {
            clearInterval(timer);
            timer = undefined;
        }
        if (!inFlightScan) return true;

        let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([
                inFlightScan.then(() => true, () => true),
                new Promise<boolean>((resolve) => {
                    shutdownTimer = setTimeout(() => resolve(false), timeoutMs);
                }),
            ]);
        } finally {
            if (shutdownTimer) clearTimeout(shutdownTimer);
        }
    }

    return { start, stop, scanOnce };
}

let stopActiveScheduler: (() => Promise<boolean>) | undefined;

/** Start at most one scheduler instance in this API process. */
export function startMonitorScheduler(): () => Promise<boolean> {
    if (stopActiveScheduler) return stopActiveScheduler;

    const scheduler = createMonitorScheduler();
    const stopInstance = scheduler.start();
    const stop = async () => {
        const stopped = await stopInstance();
        if (stopped && stopActiveScheduler === stop) {
            stopActiveScheduler = undefined;
        }
        return stopped;
    };
    stopActiveScheduler = stop;
    return stop;
}
