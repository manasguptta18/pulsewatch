import { describe, expect, it, vi } from "vitest";

const persistenceMocks = vi.hoisted(() => ({
    findFirst: vi.fn(),
    updateMany: vi.fn(),
    sendEmail: vi.fn(),
}));
vi.mock("../lib/prisma.js", () => ({
    prisma: { notificationOutbox: {
        findFirst: persistenceMocks.findFirst,
        updateMany: persistenceMocks.updateMany,
    } },
}));
vi.mock("./email.service.js", () => ({ sendIncidentEmail: persistenceMocks.sendEmail }));
import {
    createNotificationOutboxProcessor,
    NOTIFICATION_OUTBOX_BASE_BACKOFF_MS,
    NOTIFICATION_OUTBOX_MAX_ATTEMPTS,
    startNotificationOutboxProcessor,
    type NotificationOutboxDependencies,
    type NotificationOutboxItem,
} from "./notification-outbox.service.js";

const now = new Date("2026-10-25T12:00:00.000Z");

function item(overrides: Partial<NotificationOutboxItem> = {}): NotificationOutboxItem {
    return {
        id: 18,
        channel: "EMAIL",
        destination: "ops@example.test",
        payload: { monitorName: "Public API", incidentType: "AVAILABILITY", reason: "Down" },
        status: "PENDING",
        attempts: 0,
        lockedUntil: null,
        nextAttemptAt: now,
        ...overrides,
    };
}

function dependencies(overrides: Partial<NotificationOutboxDependencies> = {}) {
    return {
        findNext: vi.fn(async () => item()),
        claim: vi.fn(async () => true),
        markSent: vi.fn(async () => undefined),
        markFailed: vi.fn(async () => undefined),
        deliverEmail: vi.fn(async () => undefined),
        now: () => now,
        ...overrides,
    } satisfies NotificationOutboxDependencies;
}

describe("notification outbox processor", () => {
    it("does not silently mark a delivery sent after losing its database lease", async () => {
        persistenceMocks.findFirst.mockReset().mockResolvedValue(item());
        persistenceMocks.updateMany.mockReset()
            .mockResolvedValueOnce({ count: 1 })
            .mockResolvedValueOnce({ count: 0 })
            .mockResolvedValueOnce({ count: 0 });
        persistenceMocks.sendEmail.mockReset().mockResolvedValue({ id: "email-1" });
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

        await expect(createNotificationOutboxProcessor().processOne()).resolves.toBe(true);

        expect(persistenceMocks.sendEmail).toHaveBeenCalledOnce();
        expect(persistenceMocks.sendEmail).toHaveBeenCalledWith(
            "ops@example.test", "Public API", "AVAILABILITY", "Down", 18,
        );
        expect(persistenceMocks.updateMany).toHaveBeenCalledTimes(3);
        expect(persistenceMocks.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
            data: expect.objectContaining({ status: "SENT" }),
        }));
        expect(errorLog.mock.calls.map(([message]) => message)).toEqual([
            "Notification outbox state update failed",
            "Incident notification delivery failed",
        ]);
        errorLog.mockRestore();
    });

    it("reports safe codes when an outbox scan fails", async () => {
        const cause = Object.assign(new Error("missing relation detail"), { code: "42P01" });
        const failure = Object.assign(new Error("postgres://user:secret@localhost/pulsewatch"), {
            code: "P2021",
            cause,
        });
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const deps = dependencies({
            findNext: vi.fn(async () => { throw failure; }),
        });

        const stop = startNotificationOutboxProcessor(deps);
        await vi.waitFor(() => expect(errorLog).toHaveBeenCalledOnce());
        await stop(100);

        expect(errorLog).toHaveBeenCalledExactlyOnceWith("Notification outbox scan failed", {
            errorName: "Error",
            errorCodes: ["P2021", "42P01"],
        });
        expect(JSON.stringify(errorLog.mock.calls)).not.toContain("secret");
        expect(JSON.stringify(errorLog.mock.calls)).not.toContain("localhost");
        errorLog.mockRestore();
    });

    it("delivers a claimed email and marks its outbox row sent", async () => {
        const deps = dependencies();
        const processor = createNotificationOutboxProcessor(deps);

        await expect(processor.processOne()).resolves.toBe(true);
        expect(deps.deliverEmail).toHaveBeenCalledExactlyOnceWith(
            "ops@example.test",
            { monitorName: "Public API", incidentType: "AVAILABILITY", reason: "Down" },
            18,
        );
        expect(deps.markSent).toHaveBeenCalledOnce();
        expect(deps.markFailed).not.toHaveBeenCalled();
    });

    it("schedules transient failures with exponential backoff", async () => {
        const deps = dependencies({
            deliverEmail: vi.fn(async () => {
                throw Object.assign(new Error("temporary"), { retryable: true });
            }),
        });
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

        await createNotificationOutboxProcessor(deps).processOne();

        expect(deps.markFailed).toHaveBeenCalledWith(item(), expect.any(Date), {
            permanent: false,
            attempts: 1,
            nextAttemptAt: new Date(now.getTime() + NOTIFICATION_OUTBOX_BASE_BACKOFF_MS),
            errorCode: "TRANSIENT_DELIVERY_FAILURE",
        });
        expect(deps.markSent).not.toHaveBeenCalled();
        expect(JSON.stringify(errorLog.mock.calls)).not.toContain("temporary");
        errorLog.mockRestore();
    });

    it("dead-letters permanent errors and exhausted retries", async () => {
        const permanent = dependencies({
            deliverEmail: vi.fn(async () => {
                throw Object.assign(new Error("bad recipient"), { retryable: false });
            }),
        });
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

        await createNotificationOutboxProcessor(permanent).processOne();
        expect(permanent.markFailed).toHaveBeenCalledWith(item(), expect.any(Date), expect.objectContaining({
            permanent: true,
            errorCode: "PERMANENT_DELIVERY_FAILURE",
        }));
        expect(permanent.markSent).not.toHaveBeenCalled();

        const exhausted = dependencies({
            findNext: vi.fn(async () => item({ attempts: NOTIFICATION_OUTBOX_MAX_ATTEMPTS - 1 })),
            deliverEmail: vi.fn(async () => { throw new Error("temporary"); }),
        });
        await createNotificationOutboxProcessor(exhausted).processOne();
        expect(exhausted.markFailed).toHaveBeenCalledWith(
            item({ attempts: NOTIFICATION_OUTBOX_MAX_ATTEMPTS - 1 }),
            expect.any(Date),
            expect.objectContaining({ permanent: true, attempts: NOTIFICATION_OUTBOX_MAX_ATTEMPTS }),
        );
        expect(exhausted.markSent).not.toHaveBeenCalled();
        errorLog.mockRestore();
    });

    it("does not deliver when another processor already claimed the row", async () => {
        let claimed = false;
        const deps = dependencies({
            claim: vi.fn(async () => {
                if (claimed) return false;
                claimed = true;
                return true;
            }),
        });
        const first = createNotificationOutboxProcessor(deps);
        const second = createNotificationOutboxProcessor(deps);

        await Promise.all([first.processOne(), second.processOne()]);
        expect(deps.deliverEmail).toHaveBeenCalledOnce();
    });

    it("moves malformed payloads directly to the failed state", async () => {
        const deps = dependencies({ findNext: vi.fn(async () => item({ payload: { reason: "missing fields" } })) });
        await createNotificationOutboxProcessor(deps).processOne();
        expect(deps.deliverEmail).not.toHaveBeenCalled();
        expect(deps.markFailed).toHaveBeenCalledWith(expect.anything(), expect.any(Date), expect.objectContaining({
            permanent: true,
            errorCode: "INVALID_NOTIFICATION_PAYLOAD",
        }));
    });
});
