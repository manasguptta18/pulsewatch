import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    findIncident: vi.fn(),
    findChecks: vi.fn(),
    updateIncident: vi.fn(),
    findIncidentById: vi.fn(),
    createIncident: vi.fn(),
    emit: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
    prisma: {
        incident: {
            findFirst: mocks.findIncident,
            updateMany: mocks.updateIncident,
            findUnique: mocks.findIncidentById,
        },
        monitorCheck: { findMany: mocks.findChecks },
    },
}));
vi.mock("../lib/socket.js", () => ({ emitToUser: mocks.emit }));
vi.mock("./incident.persistence.js", () => ({
    createIncidentWithNotificationIntents: mocks.createIncident,
}));

import { detectPerformanceDegradation } from "./performance.service.js";

describe("performance degradation baselines", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.findIncident.mockResolvedValue(null);
        mocks.findChecks.mockResolvedValue([
            { latencyMs: 0 },
            { latencyMs: 0 },
            { latencyMs: 0 },
            { latencyMs: 0 },
            { latencyMs: 1 },
        ]);
        mocks.createIncident.mockResolvedValue({
            created: true,
            incident: {
                id: 7,
                monitorId: 3,
                type: "PERFORMANCE",
                status: "ONGOING",
                reason: "slow",
                startedAt: new Date(),
                monitor: { userId: 2 },
            },
        });
    });

    it("stores a nonzero baseline when rounded prior latency is below one millisecond", async () => {
        await detectPerformanceDegradation(3, {
            id: 9,
            status: "UP",
            latencyMs: 1,
            checkedAt: new Date(),
        });

        expect(mocks.createIncident).toHaveBeenCalledWith(expect.objectContaining({
            baselineLatencyMs: 1,
        }));
    });

    it("can resolve legacy performance incidents with a zero baseline", async () => {
        const ongoingIncident = {
            id: 10,
            baselineLatencyMs: 0,
        };
        mocks.findIncident.mockResolvedValue(ongoingIncident);
        mocks.updateIncident.mockResolvedValue({ count: 1 });
        mocks.findIncidentById.mockResolvedValue({
            ...ongoingIncident,
            type: "PERFORMANCE",
            status: "RESOLVED",
            monitorId: 3,
            resolvedAt: new Date(),
            monitor: { userId: 2 },
        });

        await detectPerformanceDegradation(3, {
            id: 11,
            status: "UP",
            latencyMs: 1,
            checkedAt: new Date(),
        });

        expect(mocks.updateIncident).toHaveBeenCalledOnce();
        expect(mocks.emit).toHaveBeenCalledOnce();
    });
});
