import { prisma } from "../lib/prisma.js";
import { emitToUser } from "../lib/socket.js";
import { processIncident } from "./incident.service.js";
import { detectPerformanceDegradation } from "./performance.service.js";
import { AppError } from "../errors/app-error.js";
import {
    requestPublicMonitor,
    validateMonitorUrl,
} from "./safe-monitor-http.js";

export async function createMonitor(data: {
    userId: number;
    name: string;
    url: string;
}) {
    try {
        await validateMonitorUrl(data.url);
    } catch {
        throw new AppError("Monitor URL is not allowed", 400);
    }

    const monitor = await prisma.monitor.create({
        data: {
            userId: data.userId,
            name: data.name,
            url: data.url,
        },
    });

    return monitor;
}

export async function checkMonitor(
    monitorId: number
) {
    const monitor = await prisma.monitor.findUnique({
        where: {
            id: monitorId,
        },
    });

    if (!monitor) {
        throw new AppError(
            "Monitor not found",
            404
        );
    }

    const startTime = Date.now();

    let status = "DOWN";
    let statusCode: number | null = null;
    let latencyMs: number | null = null;
    let errorMessage: string | null = null;

    try {
        const response = await requestPublicMonitor(
            monitor.url,
            monitor.method,
            monitor.timeoutSeconds * 1000,
        );

        const endTime = Date.now();

        statusCode = response.statusCode;
        latencyMs = endTime - startTime;

        if (
            response.statusCode ===
            monitor.expectedStatus
        ) {
            status = "UP";
        } else {
            status = "DOWN";

            errorMessage = `Expected status ${monitor.expectedStatus}, got ${response.statusCode}`;
        }
    } catch {
        const endTime = Date.now();

        latencyMs = endTime - startTime;

        errorMessage = "Monitor check failed";
    }

    const check = await prisma.monitorCheck.create({
        data: {
            monitorId: monitor.id,
            status,
            statusCode,
            latencyMs,
            errorMessage,
        },
    });

    emitToUser(monitor.userId, "monitor:updated", {
        monitorId: monitor.id,
        check: {
            status: check.status,
            statusCode: check.statusCode,
            latencyMs: check.latencyMs,
            errorMessage: check.errorMessage,
            checkedAt: check.checkedAt.toISOString(),
        },
    });

    console.log(`Realtime update emitted for monitor: ${monitor.name}`);

    await processIncident(monitor.id);

    await detectPerformanceDegradation(
        monitor.id,
        check
    );

    return check;
}

export async function getUserMonitors(
    userId: number
) {
    const monitors = await prisma.monitor.findMany({
        where: {
            userId,
        },

        orderBy: {
            createdAt: "desc",
        },

        include: {
            checks: {
                orderBy: {
                    checkedAt: "desc",
                },

                take: 20,

                select: {
                    status: true,
                    statusCode: true,
                    latencyMs: true,
                    errorMessage: true,
                    checkedAt: true,
                },
            },

            incidents: {
                where: {
                    status: "ONGOING",
                },

                orderBy: {
                    startedAt: "desc",
                },

                take: 1,

                select: {
                    id: true,
                    type: true,
                    status: true,
                    reason: true,
                    startedAt: true,
                    resolvedAt: true,
                },
            },
        },
    });

    return monitors;
}

export async function getMonitorByIdForUser(
    monitorId: number,
    userId: number
) {
    const monitor = await prisma.monitor.findFirst({
        where: {
            id: monitorId,
            userId: userId,
        },
        include: {
            checks: {
                orderBy: {
                    checkedAt: "desc",
                },

                take: 50,

                select: {
                    id: true,
                    status: true,
                    statusCode: true,
                    latencyMs: true,
                    errorMessage: true,
                    checkedAt: true,
                },
            },

            incidents: {
                orderBy: {
                    startedAt: "desc",
                },

                take: 20,

                select: {
                    id: true,
                    type: true,
                    status: true,
                    reason: true,
                    startedAt: true,
                    resolvedAt: true,
                    baselineLatencyMs: true,
                },
            },
        },
    });

    if (!monitor) {
        throw new AppError(
            "Monitor not found",
            404
        );
    }

    return monitor;
}

export async function checkMonitorForUser(
    monitorId: number,
    userId: number
) {
    const monitor = await prisma.monitor.findFirst({
        where: {
            id: monitorId,
            userId: userId,
        },
    });

    if (!monitor) {
        throw new AppError(
            "Monitor not found",
            404
        );
    }

    return checkMonitor(monitorId);
}

export async function updateMonitorForUser(
    monitorId: number,
    userId: number,
    data: {
        name?: string;
        url?: string;
        method?: string;
        intervalSeconds?: number;
        timeoutSeconds?: number;
        expectedStatus?: number;
        isActive?: boolean;
    }
) {
    const monitor = await prisma.monitor.findFirst({
        where: {
            id: monitorId,
            userId: userId,
        },
    });

    if (!monitor) {
        throw new AppError(
            "Monitor not found",
            404
        );
    }

    if (data.url !== undefined) {
        try {
            await validateMonitorUrl(data.url);
        } catch {
            throw new AppError("Monitor URL is not allowed", 400);
        }
    }

    const updatedMonitor =
        await prisma.monitor.update({
            where: {
                id: monitorId,
            },
            data,
        });

    return updatedMonitor;
}

export async function deleteMonitorForUser(
    monitorId: number,
    userId: number
) {
    const monitor = await prisma.monitor.findFirst({
        where: {
            id: monitorId,
            userId: userId,
        },
    });

    if (!monitor) {
        throw new AppError(
            "Monitor not found",
            404
        );
    }

    await prisma.monitor.delete({
        where: {
            id: monitorId,
        },
    });

    return {
        message: "Monitor deleted successfully",
    };
}
