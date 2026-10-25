import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    findMonitor: vi.fn(),
    findMonitors: vi.fn(),
    findExistingOccurrence: vi.fn(),
    findLatestCheck: vi.fn(),
    createCheck: vi.fn(),
    emitToUser: vi.fn(),
    processIncident: vi.fn(),
    detectPerformanceDegradation: vi.fn(),
    requestPublicMonitor: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
    prisma: {
        monitor: { findUnique: mocks.findMonitor, findMany: mocks.findMonitors },
        monitorCheck: {
            findUnique: mocks.findExistingOccurrence,
            findFirst: mocks.findLatestCheck,
            create: mocks.createCheck,
        },
    },
}));
vi.mock("../lib/socket.js", () => ({ emitToUser: mocks.emitToUser }));
vi.mock("./incident.service.js", () => ({ processIncident: mocks.processIncident }));
vi.mock("./performance.service.js", () => ({
    detectPerformanceDegradation: mocks.detectPerformanceDegradation,
}));
vi.mock("./safe-monitor-http.js", () => ({
    requestPublicMonitor: mocks.requestPublicMonitor,
    validateMonitorUrl: vi.fn(),
}));

import { checkMonitor, getUserMonitors } from "./monitor.service.js";

const monitor = {
    id: 41,
    userId: 7,
    name: "Public status",
    url: "https://status.example.com",
    method: "GET",
    timeoutSeconds: 5,
    expectedStatus: 200,
};
const check = {
    id: 100,
    monitorId: 41,
    status: "UP",
    statusCode: 200,
    latencyMs: 12,
    errorMessage: null,
    checkedAt: new Date("2026-10-25T12:00:00.000Z"),
};

beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMonitor.mockResolvedValue(monitor);
    mocks.findMonitors.mockResolvedValue([]);
    mocks.findExistingOccurrence.mockResolvedValue(null);
    mocks.findLatestCheck.mockResolvedValue({ id: check.id });
    mocks.createCheck.mockResolvedValue(check);
    mocks.emitToUser.mockImplementation(() => undefined);
    mocks.processIncident.mockResolvedValue(undefined);
    mocks.detectPerformanceDegradation.mockResolvedValue(undefined);
    mocks.requestPublicMonitor.mockResolvedValue({ statusCode: 200 });
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("checkMonitor failure boundaries", () => {
    it("keeps a saved check successful when incident follow-up fails", async () => {
        mocks.processIncident.mockRejectedValue(new Error("database unavailable"));
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

        await expect(checkMonitor(monitor.id)).resolves.toBe(check);

        expect(mocks.createCheck).toHaveBeenCalledOnce();
        expect(mocks.detectPerformanceDegradation).toHaveBeenCalledOnce();
        expect(errorLog).toHaveBeenCalledWith(
            "Availability incident processing failed after check was saved",
            { monitorId: monitor.id },
        );
    });

    it("shares concurrent in-process checks for the same monitor", async () => {
        let finishRequest: ((response: { statusCode: number }) => void) | undefined;
        mocks.requestPublicMonitor.mockImplementation(() => new Promise((resolve) => {
            finishRequest = resolve;
        }));

        const first = checkMonitor(monitor.id);
        const second = checkMonitor(monitor.id);

        expect(second).toBe(first);
        await vi.waitFor(() => expect(finishRequest).toBeDefined());
        finishRequest?.({ statusCode: 200 });
        await expect(Promise.all([first, second])).resolves.toEqual([check, check]);
        expect(mocks.findMonitor).toHaveBeenCalledOnce();
        expect(mocks.requestPublicMonitor).toHaveBeenCalledOnce();
        expect(mocks.createCheck).toHaveBeenCalledOnce();
    });

    it("persists the scheduled occurrence key while leaving manual checks distinct", async () => {
        await checkMonitor(monitor.id, "after-check-99");
        expect(mocks.createCheck).toHaveBeenLastCalledWith({
            data: expect.objectContaining({
                monitorId: monitor.id,
                scheduledOccurrenceId: "after-check-99",
            }),
        });

        mocks.createCheck.mockClear();
        await checkMonitor(monitor.id);
        expect(mocks.createCheck.mock.calls[0]?.[0].data).not.toHaveProperty(
            "scheduledOccurrenceId",
        );
    });

    it("returns an already-recorded scheduled occurrence without probing again", async () => {
        mocks.findExistingOccurrence.mockResolvedValue(check);
        mocks.findLatestCheck.mockResolvedValue({ id: check.id + 1 });

        await expect(checkMonitor(monitor.id, "after-check-99")).resolves.toBe(check);

        expect(mocks.requestPublicMonitor).not.toHaveBeenCalled();
        expect(mocks.createCheck).not.toHaveBeenCalled();
        expect(mocks.processIncident).not.toHaveBeenCalled();
        expect(mocks.detectPerformanceDegradation).not.toHaveBeenCalled();
    });

    it("handles a concurrent scheduled insert by returning the winner's check", async () => {
        const uniqueError = Object.assign(new Error("unique"), { code: "P2002" });
        mocks.createCheck.mockRejectedValueOnce(uniqueError);
        mocks.findExistingOccurrence.mockResolvedValueOnce(null).mockResolvedValueOnce(check);

        await expect(checkMonitor(monitor.id, "after-check-99")).resolves.toBe(check);
        expect(mocks.findExistingOccurrence).toHaveBeenCalledTimes(2);
        expect(mocks.processIncident).toHaveBeenCalledOnce();
    });

    it("retries follow-up work from a saved occurrence without repeating the HTTP check", async () => {
        mocks.processIncident.mockRejectedValueOnce(new Error("temporary database failure"));
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

        await expect(checkMonitor(monitor.id, "after-check-99")).rejects.toThrow(
            "temporary database failure",
        );
        mocks.findExistingOccurrence.mockResolvedValue(check);
        mocks.processIncident.mockResolvedValue(undefined);

        await expect(checkMonitor(monitor.id, "after-check-99")).resolves.toBe(check);
        expect(mocks.requestPublicMonitor).toHaveBeenCalledOnce();
        expect(mocks.createCheck).toHaveBeenCalledOnce();
        expect(mocks.processIncident).toHaveBeenCalledTimes(2);
        errorLog.mockRestore();
    });
});

describe("monitor listing pagination", () => {
    it("applies owner-scoped cursor pagination and a bounded page size", async () => {
        await getUserMonitors(7, { limit: 25, afterId: 42 });

        expect(mocks.findMonitors).toHaveBeenCalledWith(expect.objectContaining({
            where: { userId: 7 },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 26,
            cursor: { id: 42 },
            skip: 1,
        }));
    });

    it("preserves the existing unpaginated array behavior when no options are supplied", async () => {
        await getUserMonitors(7);
        const query = mocks.findMonitors.mock.calls[0]?.[0] as Record<string, unknown>;
        expect(query).not.toHaveProperty("take");
        expect(query).not.toHaveProperty("cursor");
    });
});
