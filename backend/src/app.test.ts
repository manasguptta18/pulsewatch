import "dotenv/config";
import request from "supertest";
import {describe, it, expect} from "vitest";
import jwt from "jsonwebtoken";
import {app} from "./app.js";
import { prisma } from "./lib/prisma.js";
import { processIncident } from "./services/incident.service.js";
import { detectPerformanceDegradation } from "./services/performance.service.js";
import { investigationfunction } from "./services/investigation.service.js";

describe("GET/health", ()=>{
    it("should return a healty response", async()=>{
        const response = await request(app).get("/health");

        expect(response.status).toBe(200);
        expect(response.body.status).toBe("ok");
        expect(response.body.database).toBe("connected");
        expect(response.body.users).toBeTypeOf("number");
    });
});

describe("GET /api/v1/monitors", ()=>{
    it("should reject request without authentication", async()=>{
        const response = await request(app).get("/api/v1/monitors");

        expect(response.status).toBe(401);
        expect(response.body.message).toBe(
            "Authentication required"
        );
    });

    it("should allow requests with a valid jwt", async()=>{
        const jwtSecret = process.env.JWT_SECRET;

        if(!jwtSecret){
            throw new Error("JWT_SECRET is not defined");
        }

        const token = jwt.sign(
            {
                userId: 3,
            },
            jwtSecret,
            {
                expiresIn: "1h",
            }
        );

        const response = await request(app).get("/api/v1/monitors").set("Authorization", `Bearer ${token}`);

        expect(response.status).toBe(200);
        expect(response.body).toBeInstanceOf(Array);
    });

    it("should reject an invalid JWT", async () => {
        const response = await request(app)
            .get("/api/v1/monitors")
            .set(
                "Authorization",
                "Bearer this-is-not-a-real-jwt"
            );

        expect(response.status).toBe(401);

        expect(response.body.message).toBe(
            "Invalid or expired token"
        );
    });
});

describe("Monitor ownership", ()=>{
    it("should prevent User 3 from accessing User 1's monitor", async()=>{
        const jwtSecret = process.env.JWT_SECRET;

        if(!jwtSecret){
            throw new Error("JWT_SECRET is not defined");
        }

        const token = jwt.sign(
            {
                userId: 3,
            },
            jwtSecret,
            {
                expiresIn: "1h",
            }
        );

        const response = await request(app).get("/api/v1/monitors/1").set("Authorization", `Bearer ${token}`);

        expect(response.status).toBe(404);
        expect(response.body.message).toBe("Monitor not found");
    });
});

describe("POST /api/v1/monitors", () => {
    it("should reject monitor creation without authentication", async () => {
        const response = await request(app)
            .post("/api/v1/monitors")
            .send({
                name: "Test Monitor",
                url: "https://example.com",
            });

        expect(response.status).toBe(401);

        expect(response.body.message).toBe(
            "Authentication required"
        );
    });

    it("should create a monitor with a valid JWT", async () => {
        const jwtSecret = process.env.JWT_SECRET;

        if (!jwtSecret) {
            throw new Error("JWT_SECRET is not defined");
        }

        const token = jwt.sign(
            {
                userId: 3,
            },
            jwtSecret,
            {
                expiresIn: "1h",
            }
        );

        let monitorId: number | undefined;

        try{
             const response = await request(app)
                .post("/api/v1/monitors")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    name: "Automated Test Monitor",
                    url: "https://example.com",
            });

            expect(response.status).toBe(201);

            expect(response.body.name).toBe(
                "Automated Test Monitor"
            );

            expect(response.body.userId).toBe(3);
        }finally {
            if (monitorId) {
                await prisma.monitor.delete({
                    where: {
                        id: monitorId,
                    },
                });
            }
        }

    });
});

describe("GET /api/v1/monitors/:id", () => {
    it("should return a monitor owned by the authenticated user", async () => {
        const jwtSecret = process.env.JWT_SECRET;

        if (!jwtSecret) {
            throw new Error("JWT_SECRET is not defined");
        }

        const token = jwt.sign(
            {
                userId: 3,
            },
            jwtSecret,
            {
                expiresIn: "1h",
            }
        );

        let monitorId: number | undefined;

        try {
            const createResponse = await request(app)
                .post("/api/v1/monitors")
                .set(
                    "Authorization",
                    `Bearer ${token}`
                )
                .send({
                    name: "Get Test Monitor",
                    url: "https://example.com",
                });

            expect(createResponse.status).toBe(201);

            monitorId = createResponse.body.id;

            const response = await request(app)
                .get(
                    `/api/v1/monitors/${monitorId}`
                )
                .set(
                    "Authorization",
                    `Bearer ${token}`
                );

            expect(response.status).toBe(200);
            expect(response.body.id).toBe(monitorId);
            expect(response.body.userId).toBe(3);
            expect(response.body.name).toBe(
                "Get Test Monitor"
            );
        } finally {
            if (monitorId) {
                await prisma.monitor.delete({
                    where: {
                        id: monitorId,
                    },
                });
            }
        }
    });
});

describe("PATCH /api/v1/monitors/:id", () => {
    it("should update a monitor owned by the authenticated user", async () => {
        const jwtSecret = process.env.JWT_SECRET;

        if (!jwtSecret) {
            throw new Error("JWT_SECRET is not defined");
        }

        const token = jwt.sign(
            {
                userId: 3,
            },
            jwtSecret,
            {
                expiresIn: "1h",
            }
        );

        let monitorId: number | undefined;

        try {
            const createResponse = await request(app)
                .post("/api/v1/monitors")
                .set(
                    "Authorization",
                    `Bearer ${token}`
                )
                .send({
                    name: "Patch Test Monitor",
                    url: "https://example.com",
                });

            expect(createResponse.status).toBe(201);

            monitorId = createResponse.body.id;

            const response = await request(app)
                .patch(`/api/v1/monitors/${monitorId}`)
                .set(
                    "Authorization",
                    `Bearer ${token}`
                )
                .send({
                    name: "Updated Test Monitor",
                });

            expect(response.status).toBe(200);
            expect(response.body.id).toBe(monitorId);
            expect(response.body.name).toBe(
                "Updated Test Monitor"
            );
            expect(response.body.userId).toBe(3);
        } finally {
            if (monitorId) {
                await prisma.monitor.delete({
                    where: {
                        id: monitorId,
                    },
                });
            }
        }
    });
});

describe("DELETE /api/v1/monitors/:id", () => {
    it("should delete a monitor owned by the authenticated user", async () => {
        const jwtSecret = process.env.JWT_SECRET;

        if (!jwtSecret) {
            throw new Error("JWT_SECRET is not defined");
        }

        const token = jwt.sign(
            {
                userId: 3,
            },
            jwtSecret,
            {
                expiresIn: "1h",
            }
        );

        let monitorId: number | undefined;

        try {
            const createResponse = await request(app)
                .post("/api/v1/monitors")
                .set(
                    "Authorization",
                    `Bearer ${token}`
                )
                .send({
                    name: "Delete Test Monitor",
                    url: "https://example.com",
                });

            expect(createResponse.status).toBe(201);

            monitorId = createResponse.body.id;

            const deleteResponse = await request(app)
                .delete(
                    `/api/v1/monitors/${monitorId}`
                )
                .set(
                    "Authorization",
                    `Bearer ${token}`
                );

            expect(deleteResponse.status).toBe(200);

            expect(deleteResponse.body.message).toBe(
                "Monitor deleted successfully"
            );

            const getResponse = await request(app)
                .get(
                    `/api/v1/monitors/${monitorId}`
                )
                .set(
                    "Authorization",
                    `Bearer ${token}`
                );

            expect(getResponse.status).toBe(404);
        } finally {
            if (monitorId) {
                await prisma.monitor.deleteMany({
                    where: {
                        id: monitorId,
                    },
                });
            }
        }
    });

    it("should prevent another user from deleting the monitor", async () => {
    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
        throw new Error("JWT_SECRET is not defined");
    }

    const ownerToken = jwt.sign(
        {
            userId: 3,
        },
        jwtSecret,
        {
            expiresIn: "1h",
        }
    );

    const otherUserToken = jwt.sign(
        {
            userId: 1,
        },
        jwtSecret,
        {
            expiresIn: "1h",
        }
    );

    let monitorId: number | undefined;

    try {
        const createResponse = await request(app)
            .post("/api/v1/monitors")
            .set(
                "Authorization",
                `Bearer ${ownerToken}`
            )
            .send({
                name: "Ownership Delete Test",
                url: "https://example.com",
            });

        expect(createResponse.status).toBe(201);

        monitorId = createResponse.body.id;

        const deleteResponse = await request(app)
            .delete(
                `/api/v1/monitors/${monitorId}`
            )
            .set(
                "Authorization",
                `Bearer ${otherUserToken}`
            );

        expect(deleteResponse.status).toBe(404);

        expect(deleteResponse.body.message).toBe(
            "Monitor not found"
        );

        const getResponse = await request(app)
            .get(
                `/api/v1/monitors/${monitorId}`
            )
            .set(
                "Authorization",
                `Bearer ${ownerToken}`
            );

        expect(getResponse.status).toBe(200);
    } finally {
        if (monitorId) {
            await prisma.monitor.deleteMany({
                where: {
                    id: monitorId,
                },
            });
        }
    }
});
});

describe("processIncident", ()=>{
    it("shoud create an availability incident after 3 consecutive failures", async ()=>{
        const monitor = await prisma.monitor.create({
            data:{
                name: "Incident test monitor",
                url: "https://example.com",
                userId: 3,
            },
        });

        try{
            await prisma.monitorCheck.createMany({
                data: [
                    {
                        monitorId: monitor.id,
                        status: "DOWN",
                        errorMessage: "Connection failed",
                    },
                     {
                        monitorId: monitor.id,
                        status: "DOWN",
                        errorMessage: "Connection failed",
                    },
                     {
                        monitorId: monitor.id,
                        status: "DOWN",
                        errorMessage: "Connection failed",
                    },
                ],
            });

            await processIncident(monitor.id);

            const incident = await prisma.incident.findFirst({
                where: {
                    monitorId: monitor.id,
                    type: "AVAILABILITY",
                    status: "ONGOING",
                },
            });

            expect(incident).not.toBeNull();

            expect(incident?.reason).toBe(
                "3 consecutive monitor checks failed"
            );
        }finally{
            await prisma.monitor.delete({
                where:{
                    id: monitor.id,
                },
            });
        }
    });

    it("should resolve an ongoing availability incident when the monitor recovers", async () => {
        const monitor = await prisma.monitor.create({
            data: {
                name: "Incident Resolution Test Monitor",
                url: "https://example.com",
                userId: 3,
            },
        });

        try {
            await prisma.monitorCheck.createMany({
                data: [
                    {
                        monitorId: monitor.id,
                        status: "DOWN",
                        errorMessage: "Connection failed",
                    },
                    {
                        monitorId: monitor.id,
                        status: "DOWN",
                        errorMessage: "Connection failed",
                    },
                    {
                        monitorId: monitor.id,
                        status: "DOWN",
                        errorMessage: "Connection failed",
                    },
                ],
            });

            await processIncident(monitor.id);

            const ongoingIncident =
                await prisma.incident.findFirst({
                    where: {
                        monitorId: monitor.id,
                        type: "AVAILABILITY",
                        status: "ONGOING",
                    },
                });

            expect(ongoingIncident).not.toBeNull();

            await prisma.monitorCheck.create({
                data: {
                    monitorId: monitor.id,
                    status: "UP",
                    statusCode: 200,
                    latencyMs: 100,
                },
            });

            await processIncident(monitor.id);

            const resolvedIncident =
                await prisma.incident.findFirst({
                    where: {
                        monitorId: monitor.id,
                        type: "AVAILABILITY",
                    },
                });

            expect(resolvedIncident?.status).toBe("RESOLVED");
            expect(resolvedIncident?.resolvedAt).not.toBeNull();
        } finally {
            await prisma.monitor.delete({
                where: {
                    id: monitor.id,
                },
            });
        }
    });

    it("should not create duplicate availability incidents", async () => {
        const monitor = await prisma.monitor.create({
            data: {
                name: "Duplicate Incident Test Monitor",
                url: "https://example.com",
                userId: 3,
            },
        });

        try {
            await prisma.monitorCheck.createMany({
                data: [
                    {
                        monitorId: monitor.id,
                        status: "DOWN",
                        errorMessage: "Connection failed",
                    },
                    {
                        monitorId: monitor.id,
                        status: "DOWN",
                        errorMessage: "Connection failed",
                    },
                    {
                        monitorId: monitor.id,
                        status: "DOWN",
                        errorMessage: "Connection failed",
                    },
                ],
            });

            await processIncident(monitor.id);

            await prisma.monitorCheck.createMany({
                data: [
                    {
                        monitorId: monitor.id,
                        status: "DOWN",
                        errorMessage: "Connection failed",
                    },
                    {
                        monitorId: monitor.id,
                        status: "DOWN",
                        errorMessage: "Connection failed",
                    },
                    {
                        monitorId: monitor.id,
                        status: "DOWN",
                        errorMessage: "Connection failed",
                    },
                ],
            });

            await processIncident(monitor.id);

            const incidents = await prisma.incident.findMany({
                where: {
                    monitorId: monitor.id,
                    type: "AVAILABILITY",
                },
            });



            expect(incidents).toHaveLength(1);

            expect(incidents[0]?.status).toBe("ONGOING");
        } finally {
            await prisma.monitor.delete({
                where: {
                    id: monitor.id,
                },
            });
        }
    });
});

describe("detectPerformanceDegradation", () => {
    it("should create a performance incident when latency reaches 2x the baseline", async () => {
        const monitor = await prisma.monitor.create({
            data: {
                name: "Performance Test Monitor",
                url: "https://example.com",
                userId: 3,
            },
        });

        let currentCheckId: number | undefined;

        try {
            const baseTime = new Date();

            const previousChecks =
                await prisma.monitorCheck.createMany({
                    data: [
                        {
                            monitorId: monitor.id,
                            status: "UP",
                            latencyMs: 100,
                            checkedAt: new Date(
                                baseTime.getTime() - 5000
                            ),
                        },
                        {
                            monitorId: monitor.id,
                            status: "UP",
                            latencyMs: 100,
                            checkedAt: new Date(
                                baseTime.getTime() - 4000
                            ),
                        },
                        {
                            monitorId: monitor.id,
                            status: "UP",
                            latencyMs: 100,
                            checkedAt: new Date(
                                baseTime.getTime() - 3000
                            ),
                        },
                        {
                            monitorId: monitor.id,
                            status: "UP",
                            latencyMs: 100,
                            checkedAt: new Date(
                                baseTime.getTime() - 2000
                            ),
                        },
                        {
                            monitorId: monitor.id,
                            status: "UP",
                            latencyMs: 100,
                            checkedAt: new Date(
                                baseTime.getTime() - 1000
                            ),
                        },
                    ],
                });

            expect(previousChecks.count).toBe(5);

            const currentCheck =
                await prisma.monitorCheck.create({
                    data: {
                        monitorId: monitor.id,
                        status: "UP",
                        latencyMs: 200,
                        checkedAt: baseTime,
                    },
                });

            currentCheckId = currentCheck.id;

            await detectPerformanceDegradation(
                monitor.id,
                currentCheck
            );

            const incident =
                await prisma.incident.findFirst({
                    where: {
                        monitorId: monitor.id,
                        type: "PERFORMANCE",
                        status: "ONGOING",
                    },
                });

            expect(incident).not.toBeNull();

            expect(
                incident?.baselineLatencyMs
            ).toBe(100);

            expect(incident?.reason).toContain(
                "Latency increased to 200ms"
            );
        } finally {
            await prisma.monitor.delete({
                where: {
                    id: monitor.id,
                },
            });
        }
    });

    it("should resolve a performance incident when latency returns below 2x the baseline", async () => {
        const monitor = await prisma.monitor.create({
            data: {
                name: "Performance Resolution Test Monitor",
                url: "https://example.com",
                userId: 3,
            },
        });

        try {
            const incident = await prisma.incident.create({
                data: {
                    monitorId: monitor.id,
                    type: "PERFORMANCE",
                    status: "ONGOING",
                    reason: "Latency increased",
                    baselineLatencyMs: 100,
                },
            });

            const currentCheck =
                await prisma.monitorCheck.create({
                    data: {
                        monitorId: monitor.id,
                        status: "UP",
                        latencyMs: 150,
                    },
                });

            await detectPerformanceDegradation(
                monitor.id,
                currentCheck
            );

            const resolvedIncident =
                await prisma.incident.findUnique({
                    where: {
                        id: incident.id,
                    },
                });

            expect(resolvedIncident?.status).toBe(
                "RESOLVED"
            );

            expect(
                resolvedIncident?.resolvedAt
            ).not.toBeNull();
        } finally {
            await prisma.monitor.delete({
                where: {
                    id: monitor.id,
                },
            });
        }
    });

    it("should keep a performance incident ongoing when latency is still at 2x the baseline", async () => {
        const monitor = await prisma.monitor.create({
            data: {
                name: "Performance Boundary Test Monitor",
                url: "https://example.com",
                userId: 3,
            },
        });

        try {
            const incident = await prisma.incident.create({
                data: {
                    monitorId: monitor.id,
                    type: "PERFORMANCE",
                    status: "ONGOING",
                    reason: "Latency increased",
                    baselineLatencyMs: 100,
                },
            });

            const currentCheck =
                await prisma.monitorCheck.create({
                    data: {
                        monitorId: monitor.id,
                        status: "UP",
                        latencyMs: 200,
                    },
                });

            await detectPerformanceDegradation(
                monitor.id,
                currentCheck
            );

            const unchangedIncident =
                await prisma.incident.findUnique({
                    where: {
                        id: incident.id,
                    },
                });

            expect(unchangedIncident?.status).toBe(
                "ONGOING"
            );

            expect(
                unchangedIncident?.resolvedAt
            ).toBeNull();
        } finally {
            await prisma.monitor.delete({
                where: {
                    id: monitor.id,
                },
            });
        }
    });

    it("should not create a performance incident for a DOWN check", async () => {
        const monitor = await prisma.monitor.create({
            data: {
                name: "Performance Down Test Monitor",
                url: "https://example.com",
                userId: 3,
            },
        });

        try {
            const previousChecks =
                await prisma.monitorCheck.createMany({
                    data: [
                        {
                            monitorId: monitor.id,
                            status: "UP",
                            latencyMs: 100,
                        },
                        {
                            monitorId: monitor.id,
                            status: "UP",
                            latencyMs: 100,
                        },
                        {
                            monitorId: monitor.id,
                            status: "UP",
                            latencyMs: 100,
                        },
                        {
                            monitorId: monitor.id,
                            status: "UP",
                            latencyMs: 100,
                        },
                        {
                            monitorId: monitor.id,
                            status: "UP",
                            latencyMs: 100,
                        },
                    ],
                });

            expect(previousChecks.count).toBe(5);

            const currentCheck =
                await prisma.monitorCheck.create({
                    data: {
                        monitorId: monitor.id,
                        status: "DOWN",
                        latencyMs: 500,
                        errorMessage: "Connection failed",
                    },
                });

            await detectPerformanceDegradation(
                monitor.id,
                currentCheck
            );

            const incident =
                await prisma.incident.findFirst({
                    where: {
                        monitorId: monitor.id,
                        type: "PERFORMANCE",
                    },
                });

            expect(incident).toBeNull();
        } finally {
            await prisma.monitor.delete({
                where: {
                    id: monitor.id,
                },
            });
        }
    });

    it("should not create a performance incident when fewer than 5 previous checks exist", async () => {
        const monitor = await prisma.monitor.create({
            data: {
                name: "Insufficient History Test Monitor",
                url: "https://example.com",
                userId: 3,
            },
        });

        try {
            const previousChecks =
                await prisma.monitorCheck.createMany({
                    data: [
                        {
                            monitorId: monitor.id,
                            status: "UP",
                            latencyMs: 100,
                        },
                        {
                            monitorId: monitor.id,
                            status: "UP",
                            latencyMs: 100,
                        },
                        {
                            monitorId: monitor.id,
                            status: "UP",
                            latencyMs: 100,
                        },
                        {
                            monitorId: monitor.id,
                            status: "UP",
                            latencyMs: 100,
                        },
                    ],
                });

            expect(previousChecks.count).toBe(4);

            const currentCheck =
                await prisma.monitorCheck.create({
                    data: {
                        monitorId: monitor.id,
                        status: "UP",
                        latencyMs: 500,
                    },
                });

            await detectPerformanceDegradation(
                monitor.id,
                currentCheck
            );

            const incident =
                await prisma.incident.findFirst({
                    where: {
                        monitorId: monitor.id,
                        type: "PERFORMANCE",
                    },
                });

            expect(incident).toBeNull();
        } finally {
            await prisma.monitor.delete({
                where: {
                    id: monitor.id,
                },
            });
        }
    });
});

describe("investigationfunction", () => {
    it("should return evidence for a performance incident", async () => {
        const monitor = await prisma.monitor.create({
            data: {
                name: "Investigation Performance Monitor",
                url: "https://example.com",
                userId: 3,
            },
        });

        try {
            const incidentStart = new Date(
                Date.now() - 10_000
            );

            const incident = await prisma.incident.create({
                data: {
                    monitorId: monitor.id,
                    type: "PERFORMANCE",
                    status: "ONGOING",
                    reason: "Latency increased",
                    baselineLatencyMs: 100,
                    startedAt: incidentStart,
                },
            });

            await prisma.monitorCheck.create({
                data: {
                    monitorId: monitor.id,
                    status: "UP",
                    statusCode: 200,
                    latencyMs: 200,
                    checkedAt: new Date(
                        incidentStart.getTime() + 1000
                    ),
                },
            });

            const result =
                await investigationfunction(incident.id);

            expect(result.incidentId).toBe(
                incident.id
            );

            expect(result.monitorName).toBe(
                "Investigation Performance Monitor"
            );

            expect(result.type).toBe("PERFORMANCE");

            expect(result.hypothesis).toBe(
                "PERFORMANCE_DEGRADATION"
            );

            expect(result.summary).toContain("100ms");
            expect(result.summary).toContain("200ms");

            expect(result.evidence).toContain(
                "Normal baseline latency: 100ms"
            );

            expect(result.evidence).toContain(
                "Incident-start latency: 200ms"
            );

            expect(result.evidence).toContain(
                "Latency increased by approximately 100%"
            );

            expect(
                result.recommendedChecks.length
            ).toBeGreaterThan(0);
        } finally {
            await prisma.monitor.delete({
                where: {
                    id: monitor.id,
                },
            });
        }
    });

    it("should identify a possible server-side failure for an availability incident", async () => {
        const monitor = await prisma.monitor.create({
            data: {
                name: "Investigation Availability Monitor",
                url: "https://example.com",
                userId: 3,
            },
        });

        try {
            const incidentStart = new Date(
                Date.now() - 10_000
            );

            const incident = await prisma.incident.create({
                data: {
                    monitorId: monitor.id,
                    type: "AVAILABILITY",
                    status: "ONGOING",
                    reason: "3 consecutive monitor checks failed",
                    startedAt: incidentStart,
                },
            });

            await prisma.monitorCheck.createMany({
                data: [
                    {
                        monitorId: monitor.id,
                        status: "DOWN",
                        statusCode: 500,
                        errorMessage: "Internal server error",
                        checkedAt: new Date(
                            incidentStart.getTime() - 3000
                        ),
                    },
                    {
                        monitorId: monitor.id,
                        status: "DOWN",
                        statusCode: 503,
                        errorMessage: "Service unavailable",
                        checkedAt: new Date(
                            incidentStart.getTime() - 2000
                        ),
                    },
                    {
                        monitorId: monitor.id,
                        status: "DOWN",
                        statusCode: 500,
                        errorMessage: "Internal server error",
                        checkedAt: new Date(
                            incidentStart.getTime() - 1000
                        ),
                    },
                ],
            });

            const result =
                await investigationfunction(incident.id);

            expect(result.incidentId).toBe(
                incident.id
            );

            expect(result.monitorName).toBe(
                "Investigation Availability Monitor"
            );

            expect(result.type).toBe("AVAILABILITY");

            expect(result.hypothesis).toBe(
                "POSSIBLE_SERVER_SIDE_FAILURE"
            );

            expect(result.summary).toContain(
                "3 failed checks"
            );

            expect(result.evidence).toHaveLength(3);

            expect(result.evidence[0]).toContain(
                "HTTP status: 500"
            );

            expect(
                result.recommendedChecks.length
            ).toBeGreaterThan(0);
        } finally {
            await prisma.monitor.delete({
                where: {
                    id: monitor.id,
                },
            });
        }
    });
    it("should throw an error when the incident does not exist", async () => {
    await expect(
        investigationfunction(999999)
    ).rejects.toThrow("Incident not found");
});
});

describe("GET /api/v1/incidents/:id/ai-summary", () => {
        it("should reject an invalid incident ID", async () => {
        const jwtSecret = process.env.JWT_SECRET;

        if (!jwtSecret) {
            throw new Error("JWT_SECRET is not defined");
        }

        const token = jwt.sign(
            {
                userId: 3,
            },
            jwtSecret,
            {
                expiresIn: "1h",
            }
        );

        const response = await request(app)
            .get("/api/v1/incidents/abc/ai-summary")
            .set(
                "Authorization",
                `Bearer ${token}`
            );

        expect(response.status).toBe(400);

        expect(response.body.message).toBe(
            "Invalid incident ID"
        );
    });

    it("should reject AI summary requests without authentication", async () => {
    const response = await request(app)
        .get(
            "/api/v1/incidents/1/ai-summary"
        );

    expect(response.status).toBe(401);

    expect(response.body.message).toBe(
        "Authentication required"
    );
});

it("should return an error when the incident does not exist", async () => {
    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
        throw new Error("JWT_SECRET is not defined");
    }

    const token = jwt.sign(
        {
            userId: 3,
        },
        jwtSecret,
        {
            expiresIn: "1h",
        }
    );

    const response = await request(app)
        .get(
            "/api/v1/incidents/999999/ai-summary"
        )
        .set(
            "Authorization",
            `Bearer ${token}`
        );

    expect(response.status).toBe(404);

    expect(response.body.message).toBe(
        "Incident not found"
    );
});
});

it("should reject an invalid monitor body", async () => {
    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
        throw new Error(
            "JWT_SECRET is not defined"
        );
    }

    const token = jwt.sign(
        {
            userId: 3,
        },
        jwtSecret,
        {
            expiresIn: "1h",
        }
    );

    const response = await request(app)
        .post("/api/v1/monitors")
        .set(
            "Authorization",
            `Bearer ${token}`
        )
        .send({
            name: "",
            url: "hello",
        });

    expect(response.status).toBe(400);

    expect(response.body.message).toBe(
        "Validation failed"
    );

    expect(response.body.errors.length)
        .toBeGreaterThan(0);
});

it("should reject an invalid monitor update", async () => {
    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
        throw new Error(
            "JWT_SECRET is not defined"
        );
    }

    const token = jwt.sign(
        {
            userId: 3,
        },
        jwtSecret,
        {
            expiresIn: "1h",
        }
    );

    const response = await request(app)
        .patch("/api/v1/monitors/999999")
        .set(
            "Authorization",
            `Bearer ${token}`
        )
        .send({
            timeoutSeconds: -5,
        });

    expect(response.status).toBe(400);

    expect(response.body.message).toBe(
        "Validation failed"
    );
});

describe("POST /api/v1/users", () => {
    it("should reject invalid registration data", async () => {
        const response = await request(app)
            .post("/api/v1/users")
            .send({
                name: "",
                email: "not-an-email",
                password: "123",
            });

        expect(response.status).toBe(400);

        expect(response.body.message).toBe(
            "Validation failed"
        );

        expect(response.body.errors.length)
            .toBeGreaterThan(0);
    });
});

describe("POST /api/v1/auth/login", () => {
    it("should reject invalid login data", async () => {
        const response = await request(app)
            .post("/api/v1/auth/login")
            .send({
                email: "not-an-email",
                password: "123",
            });

        expect(response.status).toBe(400);

        expect(response.body.message).toBe(
            "Validation failed"
        );

        expect(response.body.errors.length)
            .toBeGreaterThan(0);
    });
});