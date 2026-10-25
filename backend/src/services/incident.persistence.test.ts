import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    transaction: vi.fn(),
    createIncident: vi.fn(),
    findAlertRules: vi.fn(),
    createOutboxRows: vi.fn(),
    findOngoingIncident: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
    prisma: {
        $transaction: mocks.transaction,
        incident: { findFirst: mocks.findOngoingIncident },
    },
}));

import { createIncidentWithNotificationIntents } from "./incident.persistence.js";

const incident = {
    id: 77,
    monitorId: 41,
    type: "AVAILABILITY",
    status: "ONGOING",
    reason: "Down",
    startedAt: new Date("2026-10-25T12:00:00.000Z"),
    monitor: { userId: 7, name: "Public API" },
};

beforeEach(() => {
    vi.clearAllMocks();
    mocks.createIncident.mockResolvedValue(incident);
    mocks.findAlertRules.mockResolvedValue([{ id: 6, destination: "ops@example.test" }]);
    mocks.createOutboxRows.mockResolvedValue({ count: 1 });
    mocks.findOngoingIncident.mockResolvedValue(incident);
    mocks.transaction.mockImplementation(async (operation: (tx: unknown) => unknown) =>
        operation({
            incident: { create: mocks.createIncident },
            alertRule: { findMany: mocks.findAlertRules },
            notificationOutbox: { createMany: mocks.createOutboxRows },
        }),
    );
});

describe("incident persistence", () => {
    it("writes an incident and deduplicated email intents in one transaction", async () => {
        await expect(createIncidentWithNotificationIntents({
            monitorId: 41,
            type: "AVAILABILITY",
            reason: "Down",
        })).resolves.toEqual({ incident, created: true });

        expect(mocks.createIncident).toHaveBeenCalledOnce();
        expect(mocks.createOutboxRows).toHaveBeenCalledWith({
            data: [{
                dedupeKey: "incident:77:email:6",
                channel: "EMAIL",
                destination: "ops@example.test",
                payload: { monitorName: "Public API", incidentType: "AVAILABILITY", reason: "Down" },
                incidentId: 77,
            }],
            skipDuplicates: true,
        });

        await createIncidentWithNotificationIntents({
            monitorId: 41,
            type: "AVAILABILITY",
            reason: "Down",
        });
        expect(mocks.createOutboxRows).toHaveBeenCalledTimes(2);
        expect(mocks.createOutboxRows.mock.calls[0]?.[0]).toEqual(
            mocks.createOutboxRows.mock.calls[1]?.[0],
        );
    });

    it("returns the existing incident when the database uniqueness constraint wins a race", async () => {
        mocks.transaction.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }));

        await expect(createIncidentWithNotificationIntents({
            monitorId: 41,
            type: "AVAILABILITY",
            reason: "Down",
        })).resolves.toEqual({ incident, created: false });

        expect(mocks.findOngoingIncident).toHaveBeenCalledWith({
            where: { monitorId: 41, type: "AVAILABILITY", status: "ONGOING" },
            include: { monitor: { select: { userId: true, name: true } } },
        });
    });
});
