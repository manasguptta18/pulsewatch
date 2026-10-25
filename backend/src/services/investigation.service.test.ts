import { beforeEach, describe, expect, it, vi } from "vitest";

const { incidentFindFirst, monitorCheckFindMany } = vi.hoisted(() => ({
    incidentFindFirst: vi.fn(),
    monitorCheckFindMany: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
    prisma: {
        incident: { findFirst: incidentFindFirst },
        monitorCheck: { findMany: monitorCheckFindMany },
    },
}));

import { AppError } from "../errors/app-error.js";
import { investigationfunction } from "./investigation.service.js";

describe("owner-scoped incident investigation", () => {
    beforeEach(() => {
        incidentFindFirst.mockReset();
        monitorCheckFindMany.mockReset();
    });

    it("fetches the incident only through a monitor owned by the requesting user", async () => {
        incidentFindFirst.mockResolvedValue({
            id: 41,
            monitorId: 12,
            type: "UNKNOWN",
            status: "ONGOING",
            reason: null,
            startedAt: new Date("2026-01-01T00:00:00.000Z"),
            resolvedAt: null,
            baselineLatencyMs: null,
            monitor: { name: "Owned monitor" },
        });

        const result = await investigationfunction(41, 7);

        expect(incidentFindFirst).toHaveBeenCalledWith({
            where: {
                id: 41,
                monitor: { is: { userId: 7 } },
            },
            include: { monitor: true },
        });
        expect(result.incidentId).toBe(41);
        expect(result.monitorName).toBe("Owned monitor");
    });

    it("treats a non-owned incident as missing before loading incident evidence", async () => {
        incidentFindFirst.mockResolvedValue(null);

        await expect(investigationfunction(41, 8)).rejects.toMatchObject({
            message: "Incident not found",
            statusCode: 404,
        } satisfies Partial<AppError>);

        expect(incidentFindFirst).toHaveBeenCalledWith({
            where: {
                id: 41,
                monitor: { is: { userId: 8 } },
            },
            include: { monitor: true },
        });
        expect(monitorCheckFindMany).not.toHaveBeenCalled();
    });
});
