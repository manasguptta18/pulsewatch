import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    createMonitor: vi.fn(),
    checkMonitorForUser: vi.fn(),
    getUserMonitors: vi.fn(),
    getMonitorByIdForUser: vi.fn(),
    updateMonitorForUser: vi.fn(),
    deleteMonitorForUser: vi.fn(),
}));

vi.mock("dotenv/config", () => ({}));
vi.mock("../services/monitor.service.js", () => mocks);

import monitorRoutes from "./monitor.routes.js";

const previousSecret = process.env.JWT_SECRET;
const secret = "route-test-signing-secret";

function createApp() {
    const app = express();
    app.use(express.json());
    app.use("/monitors", monitorRoutes);
    return app;
}

function token() {
    return jwt.sign({ userId: 7 }, secret, { algorithm: "HS256" });
}

beforeEach(() => {
    process.env.JWT_SECRET = secret;
    vi.clearAllMocks();
});

afterEach(() => {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
});

describe("GET /monitors pagination", () => {
    it("returns an array and a cursor header when another page exists", async () => {
        mocks.getUserMonitors.mockResolvedValue([
            { id: 9 }, { id: 8 }, { id: 7 },
        ]);
        const response = await request(createApp())
            .get("/monitors?limit=2")
            .set("Authorization", `Bearer ${token()}`);

        expect(response.status).toBe(200);
        expect(response.body).toEqual([{ id: 9 }, { id: 8 }]);
        expect(response.headers["x-has-more"]).toBe("true");
        expect(response.headers["x-next-cursor"]).toBe("8");
        expect(mocks.getUserMonitors).toHaveBeenCalledWith(7, { limit: 2 });
    });

    it("rejects invalid pagination without querying monitor data", async () => {
        const response = await request(createApp())
            .get("/monitors?limit=101&after=1e2")
            .set("Authorization", `Bearer ${token()}`);

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ message: "Invalid monitor pagination" });
        expect(mocks.getUserMonitors).not.toHaveBeenCalled();
    });
});
