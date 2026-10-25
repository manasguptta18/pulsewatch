
export const NOTIFICATION_OUTBOX_MAX_ATTEMPTS = 8;
export const NOTIFICATION_OUTBOX_BASE_BACKOFF_MS = 30_000;
export const NOTIFICATION_OUTBOX_MAX_BACKOFF_MS = 60 * 60_000;
export const NOTIFICATION_OUTBOX_LEASE_MS = 5 * 60_000;
export const NOTIFICATION_OUTBOX_POLL_INTERVAL_MS = 5_000;
export const NOTIFICATION_OUTBOX_BATCH_SIZE = 20;
export const NOTIFICATION_OUTBOX_STOP_TIMEOUT_MS = 5_000;

export interface NotificationOutboxItem {
    id: number;
    channel: string;
    destination: string;
    payload: unknown;
    status: string;
    attempts: number;
    lockedUntil: Date | null;
    nextAttemptAt: Date;
}

export interface NotificationOutboxDependencies {
    findNext: (now: Date) => Promise<NotificationOutboxItem | null>;
    claim: (item: NotificationOutboxItem, now: Date, leaseUntil: Date) => Promise<boolean>;
    markSent: (item: NotificationOutboxItem, leaseUntil: Date, at: Date) => Promise<void>;
    markFailed: (item: NotificationOutboxItem, leaseUntil: Date, failure: {
        permanent: boolean;
        attempts: number;
        nextAttemptAt: Date;
        errorCode: string;
    }) => Promise<void>;
    deliverEmail: (destination: string, payload: {
        monitorName: string;
        incidentType: string;
        reason: string;
    }) => Promise<unknown>;
    now?: () => Date;
}

function emailPayload(value: unknown) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const payload = value as Record<string, unknown>;
    if (
        typeof payload.monitorName !== "string" ||
        typeof payload.incidentType !== "string" ||
        typeof payload.reason !== "string"
    ) return null;
    return {
        monitorName: payload.monitorName,
        incidentType: payload.incidentType,
        reason: payload.reason,
    };
}

function isRetryableFailure(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return true;
    if ("retryable" in error && error.retryable === false) return false;
    return true;
}

function backoffForAttempt(attempt: number): number {
    return Math.min(
        NOTIFICATION_OUTBOX_MAX_BACKOFF_MS,
        NOTIFICATION_OUTBOX_BASE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1),
    );
}

function prismaOutboxDependencies(): NotificationOutboxDependencies {
    return {
        findNext: async (now) => {
            const { prisma } = await import("../lib/prisma.js");
            return await prisma.notificationOutbox.findFirst({
                where: {
                    OR: [
                        { status: "PENDING", nextAttemptAt: { lte: now } },
                        { status: "PROCESSING", lockedUntil: { lte: now } },
                    ],
                },
                orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
            }) as NotificationOutboxItem | null;
        },
        claim: async (item, now, leaseUntil) => {
            const { prisma } = await import("../lib/prisma.js");
            const where = item.status === "PENDING"
                ? {
                    id: item.id,
                    status: "PENDING",
                    lockedUntil: null,
                    nextAttemptAt: { lte: now },
                }
                : {
                    id: item.id,
                    status: "PROCESSING",
                    lockedUntil: item.lockedUntil,
                    AND: [{ lockedUntil: { lte: now } }],
                };
            const result = await prisma.notificationOutbox.updateMany({
                where,
                data: {
                    status: "PROCESSING",
                    attempts: { increment: 1 },
                    lockedUntil: leaseUntil,
                },
            });
            return result.count === 1;
        },
        markSent: async (item, leaseUntil, at) => {
            const { prisma } = await import("../lib/prisma.js");
            await prisma.notificationOutbox.updateMany({
                where: { id: item.id, status: "PROCESSING", lockedUntil: leaseUntil },
                data: { status: "SENT", sentAt: at, lockedUntil: null, lastErrorCode: null },
            });
        },
        markFailed: async (item, leaseUntil, failure) => {
            const { prisma } = await import("../lib/prisma.js");
            await prisma.notificationOutbox.updateMany({
                where: { id: item.id, status: "PROCESSING", lockedUntil: leaseUntil },
                data: {
                    status: failure.permanent ? "FAILED" : "PENDING",
                    nextAttemptAt: failure.nextAttemptAt,
                    lockedUntil: null,
                    lastErrorCode: failure.errorCode,
                },
            });
        },
        deliverEmail: async (destination, payload) => {
            const { sendIncidentEmail } = await import("./email.service.js");
            return sendIncidentEmail(destination, payload.monitorName, payload.incidentType, payload.reason);
        },
    };
}

export function createNotificationOutboxProcessor(
    dependencies: NotificationOutboxDependencies = prismaOutboxDependencies(),
) {
    async function processOne(): Promise<boolean> {
        const now = dependencies.now?.() ?? new Date();
        const item = await dependencies.findNext(now);
        if (!item) return false;

        const leaseUntil = new Date(now.getTime() + NOTIFICATION_OUTBOX_LEASE_MS);
        if (!await dependencies.claim(item, now, leaseUntil)) return true;

        const attempts = item.attempts + 1;
        const payload = item.channel === "EMAIL" ? emailPayload(item.payload) : null;
        try {
            if (!payload || !item.destination) {
                await dependencies.markFailed(item, leaseUntil, {
                    permanent: true,
                    attempts,
                    nextAttemptAt: now,
                    errorCode: "INVALID_NOTIFICATION_PAYLOAD",
                });
                return true;
            }

            await dependencies.deliverEmail(item.destination, payload);
            await dependencies.markSent(item, leaseUntil, now);
        } catch (error) {
            const permanent = !isRetryableFailure(error) || attempts >= NOTIFICATION_OUTBOX_MAX_ATTEMPTS;
            const errorCode = !isRetryableFailure(error)
                ? "PERMANENT_DELIVERY_FAILURE"
                : "TRANSIENT_DELIVERY_FAILURE";
            const nextAttemptAt = permanent
                ? now
                : new Date(now.getTime() + backoffForAttempt(attempts));
            try {
                await dependencies.markFailed(item, leaseUntil, {
                    permanent,
                    attempts,
                    nextAttemptAt,
                    errorCode,
                });
            } catch {
                // The processing lease expires and allows another process to recover it.
                console.error("Notification outbox state update failed", { outboxId: item.id });
            }
            console.error("Incident notification delivery failed", {
                outboxId: item.id,
                errorCode,
                permanent,
            });
        }
        return true;
    }

    async function drain(limit = NOTIFICATION_OUTBOX_BATCH_SIZE): Promise<number> {
        let processed = 0;
        while (processed < limit && await processOne()) processed += 1;
        return processed;
    }

    return { processOne, drain };
}

/** Run outbox delivery independently of monitor-check job completion. */
export function startNotificationOutboxProcessor() {
    const processor = createNotificationOutboxProcessor();
    let stopped = false;
    let inFlight: Promise<number> | undefined;
    const run = () => {
        if (stopped || inFlight) return inFlight;
        inFlight = processor.drain().finally(() => { inFlight = undefined; });
        return inFlight;
    };

    const timer = setInterval(() => {
        void run()?.catch(() => {
            console.error("Notification outbox scan failed");
        });
    }, NOTIFICATION_OUTBOX_POLL_INTERVAL_MS);
    void run()?.catch(() => console.error("Notification outbox scan failed"));

    return async (timeoutMs = NOTIFICATION_OUTBOX_STOP_TIMEOUT_MS): Promise<boolean> => {
        stopped = true;
        clearInterval(timer);
        if (!inFlight) return true;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([
                inFlight.then(() => true, () => false),
                new Promise<boolean>((resolve) => {
                    timeout = setTimeout(() => resolve(false), timeoutMs);
                }),
            ]);
        } finally {
            if (timeout) clearTimeout(timeout);
        }
    };
}
