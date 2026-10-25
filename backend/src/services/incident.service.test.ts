import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    findChecks: vi.fn(),
    findIncident: vi.fn(),
    createIncidentWithIntents: vi.fn(),
    findIncidentById: vi.fn(),
    updateIncidentMany: vi.fn(),
    emitToUser: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
    prisma: {
        monitorCheck: { findMany: mocks.findChecks },
        incident: {
            findFirst: mocks.findIncident,
            findUnique: mocks.findIncidentById,
            updateMany: mocks.updateIncidentMany,
        },
    },
}));
vi.mock("../lib/socket.js", () => ({ emitToUser: mocks.emitToUser }));
vi.mock("./incident.persistence.js", () => ({
    createIncidentWithNotificationIntents: mocks.createIncidentWithIntents,
}));

import { processIncident } from "./incident.service.js";

const startedAt = new Date("2026-10-25T12:00:00.000Z");
const recentDownChecks = [1, 2, 3].map((id) => ({
    id,
    status: "DOWN",
    checkedAt: startedAt,
}));
const createdIncident = {
    id: 77,
    monitorId: 41,
    type: "AVAILABILITY",
    status: "ONGOING",
    reason: "3 consecutive monitor checks failed",
    startedAt,
    monitor: { userId: 7 },
};

beforeEach(() => {
    vi.clearAllMocks();
    mocks.findChecks.mockResolvedValue(recentDownChecks);
    mocks.findIncident.mockResolvedValue(null);
    mocks.createIncidentWithIntents.mockResolvedValue({ incident: createdIncident, created: true });
    mocks.findIncidentById.mockResolvedValue({
        ...createdIncident,
        status: "RESOLVED",
        resolvedAt: new Date("2026-10-25T12:01:00.000Z"),
    });
    mocks.updateIncidentMany.mockResolvedValue({ count: 1 });
    mocks.emitToUser.mockImplementation(() => undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("availability incident side effects", () => {
    it("creates the incident and durable notification intents before publishing its event", async () => {
        await expect(processIncident(41)).resolves.toBeUndefined();

        expect(mocks.createIncidentWithIntents).toHaveBeenCalledOnce();
        expect(mocks.emitToUser).toHaveBeenCalledOnce();
    });

    it("does not create notification intents again when an ongoing incident already exists", async () => {
        mocks.findIncident.mockResolvedValue(createdIncident);

        await expect(processIncident(41)).resolves.toBeUndefined();

        expect(mocks.createIncidentWithIntents).not.toHaveBeenCalled();
        expect(mocks.emitToUser).not.toHaveBeenCalled();
    });

    it("does not publish a duplicate event when another process won incident creation", async () => {
        mocks.createIncidentWithIntents.mockResolvedValue({
            incident: createdIncident,
            created: false,
        });

        await expect(processIncident(41)).resolves.toBeUndefined();
        expect(mocks.emitToUser).not.toHaveBeenCalled();
    });

    it("publishes a resolution event only for the process that changed the state", async () => {
        mocks.findChecks.mockResolvedValue([{ ...recentDownChecks[0], status: "UP" }]);
        mocks.findIncident.mockResolvedValue(createdIncident);
        mocks.updateIncidentMany.mockResolvedValue({ count: 0 });

        await expect(processIncident(41)).resolves.toBeUndefined();

        expect(mocks.updateIncidentMany).toHaveBeenCalledWith({
            where: { id: createdIncident.id, status: "ONGOING" },
            data: { status: "RESOLVED", resolvedAt: expect.any(Date) },
        });
        expect(mocks.emitToUser).not.toHaveBeenCalled();
    });
});
