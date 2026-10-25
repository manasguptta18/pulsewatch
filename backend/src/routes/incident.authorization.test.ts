import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import incidentRoutes from "./incident.routes.js";
import { errorMiddleware } from "../middleware/error.middleware.js";
import { AppError } from "../errors/app-error.js";

const mocks = vi.hoisted(() => ({
    investigate: vi.fn(),
    summarize: vi.fn(),
}));

vi.mock("../services/investigation.service", () => ({
    investigationfunction: mocks.investigate,
}));

vi.mock("../services/ai.services.js", () => ({
    generateIncidentSummary: mocks.summarize,
}));

const app = express();
app.use("/api/v1/incidents", incidentRoutes);
app.use(errorMiddleware);

function tokenFor(userId: number) {
    return jwt.sign({ userId }, "incident-auth-test-secret");
}

describe("incident summary authorization", () => {
    beforeEach(() => {
        vi.stubEnv("JWT_SECRET", "incident-auth-test-secret");
        mocks.investigate.mockReset();
        mocks.summarize.mockReset();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("allows the owner and passes the verified user ID to investigation", async () => {
        const investigation = { incidentId: 41, monitorName: "Owned monitor" };
        mocks.investigate.mockResolvedValue(investigation);
        mocks.summarize.mockResolvedValue("Summary");

        const response = await request(app)
            .get("/api/v1/incidents/41/ai-summary")
            .set("Authorization", `Bearer ${tokenFor(7)}`);

        expect(response.status).toBe(200);
        expect(mocks.investigate).toHaveBeenCalledWith(41, 7);
        expect(mocks.summarize).toHaveBeenCalledWith(investigation);
        expect(response.body).toEqual({ investigation, aiSummary: "Summary" });
    });

    it("returns the same 404 for a non-owned or missing incident and skips AI summary", async () => {
        mocks.investigate.mockRejectedValue(new AppError("Incident not found", 404));

        const nonOwned = await request(app)
            .get("/api/v1/incidents/41/ai-summary")
            .set("Authorization", `Bearer ${tokenFor(8)}`);
        const missing = await request(app)
            .get("/api/v1/incidents/999/ai-summary")
            .set("Authorization", `Bearer ${tokenFor(8)}`);

        expect(nonOwned.status).toBe(404);
        expect(nonOwned.body).toEqual(missing.body);
        expect(mocks.investigate).toHaveBeenNthCalledWith(1, 41, 8);
        expect(mocks.investigate).toHaveBeenNthCalledWith(2, 999, 8);
        expect(mocks.summarize).not.toHaveBeenCalled();
    });

    it.each([
        ["missing", undefined],
        ["invalid", "not-a-valid-token"],
    ])("rejects %s REST authentication", async (_kind, authToken) => {
        const call = request(app).get("/api/v1/incidents/41/ai-summary");
        const response = authToken
            ? await call.set("Authorization", `Bearer ${authToken}`)
            : await call;

        expect(response.status).toBe(401);
        expect(mocks.investigate).not.toHaveBeenCalled();
    });
});
