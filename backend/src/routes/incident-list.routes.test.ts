import jwt from "jsonwebtoken";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    findMany: vi.fn(),
    investigate: vi.fn(),
    summarize: vi.fn(),
}));
vi.mock("../lib/prisma.js", () => ({
    prisma: { incident: { findMany: mocks.findMany } },
}));
vi.mock("../services/investigation.service", () => ({
    investigationfunction: mocks.investigate,
}));
vi.mock("../services/ai.services.js", () => ({
    generateIncidentSummary: mocks.summarize,
}));

import { app } from "../app.js";

function tokenFor(userId: number) {
    return jwt.sign({ userId }, "incident-list-test-secret");
}

describe("GET /api/v1/incidents", () => {
    beforeEach(() => {
        vi.stubEnv("JWT_SECRET", "incident-list-test-secret");
        mocks.findMany.mockReset();
    });
    afterEach(() => vi.unstubAllEnvs());

    it("requires a verified token before querying incidents", async () => {
        const response = await request(app).get("/api/v1/incidents");
        expect(response.status).toBe(401);
        expect(mocks.findMany).not.toHaveBeenCalled();
    });

    it("returns one owner-scoped page with a cursor", async () => {
        const incidents = [
            { id: 9, monitorId: 4, monitor: { id: 4, name: "API" }, type: "AVAILABILITY", status: "ONGOING" },
            { id: 8, monitorId: 4, monitor: { id: 4, name: "API" }, type: "PERFORMANCE", status: "RESOLVED" },
        ];
        mocks.findMany.mockResolvedValue(incidents);
        const response = await request(app)
            .get("/api/v1/incidents?limit=1&status=ONGOING&type=AVAILABILITY")
            .set("Authorization", `Bearer ${tokenFor(7)}`);

        expect(response.status).toBe(200);
        expect(response.body).toEqual([incidents[0]]);
        expect(response.headers["x-has-more"]).toBe("true");
        expect(response.headers["x-next-cursor"]).toBe("9");
        expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                monitor: { is: { userId: 7 } },
                status: "ONGOING",
                type: "AVAILABILITY",
            },
            take: 2,
        }));
    });

    it("uses the verified user's ID to exclude another user's incidents", async () => {
        const incident = {
            id: 12,
            monitorId: 3,
            monitor: { id: 3, name: "Owner's API" },
            type: "AVAILABILITY",
            status: "ONGOING",
            reason: "HTTP 503",
            startedAt: new Date("2026-10-28T08:00:00.000Z"),
            resolvedAt: null,
        };
        mocks.findMany.mockImplementation(async ({ where }: { where: { monitor: { is: { userId: number } } } }) =>
            where.monitor.is.userId === 7 ? [incident] : []);

        const owner = await request(app)
            .get("/api/v1/incidents")
            .set("Authorization", `Bearer ${tokenFor(7)}`);
        const otherUser = await request(app)
            .get("/api/v1/incidents")
            .set("Authorization", `Bearer ${tokenFor(8)}`);

        expect(owner.status).toBe(200);
        expect(owner.body).toEqual([{
            ...incident,
            startedAt: "2026-10-28T08:00:00.000Z",
        }]);
        expect(otherUser.status).toBe(200);
        expect(otherUser.body).toEqual([]);
        expect(mocks.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
            where: { monitor: { is: { userId: 7 } } },
        }));
        expect(mocks.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
            where: { monitor: { is: { userId: 8 } } },
        }));
    });

    it.each([
        "limit=0",
        "limit=101",
        "after=abc",
        "status=OTHER",
        "type=OTHER",
    ])("rejects invalid query %s", async (query) => {
        const response = await request(app)
            .get(`/api/v1/incidents?${query}`)
            .set("Authorization", `Bearer ${tokenFor(7)}`);
        expect(response.status).toBe(400);
        expect(mocks.findMany).not.toHaveBeenCalled();
    });
});
