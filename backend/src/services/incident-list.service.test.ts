import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("../lib/prisma.js", () => ({
    prisma: { incident: { findMany: mocks.findMany } },
}));

import { listUserIncidents } from "./incident-list.service.js";

describe("listUserIncidents", () => {
    beforeEach(() => mocks.findMany.mockReset());

    it("scopes rows through monitor ownership and applies stable pagination filters", async () => {
        mocks.findMany.mockResolvedValue([]);
        await listUserIncidents(7, {
            limit: 20,
            afterId: 81,
            status: "ONGOING",
            type: "PERFORMANCE",
        });

        expect(mocks.findMany).toHaveBeenCalledWith({
            where: {
                monitor: { is: { userId: 7 } },
                id: { lt: 81 },
                status: "ONGOING",
                type: "PERFORMANCE",
            },
            select: expect.objectContaining({
                id: true,
                monitorId: true,
                monitor: { select: { id: true, name: true } },
            }),
            orderBy: { id: "desc" },
            take: 21,
        });
    });
});
