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

const inFlightMonitorChecks = new Map<string, Promise<unknown>>();

function isPrismaUniqueConstraintError(error: unknown): boolean {
    return typeof error === "object" && error !== null &&
        "code" in error && error.code === "P2002";
}

/** Share an in-process check when a manual request and queued job overlap. */
export function checkMonitor(monitorId: number, scheduledOccurrenceId?: string) {
    const checkKey = scheduledOccurrenceId === undefined
        ? `${monitorId}:manual`
        : `${monitorId}:scheduled:${scheduledOccurrenceId}`;
    const existing = inFlightMonitorChecks.get(checkKey);
    if (existing) return existing;

    const execution = runMonitorCheck(monitorId, scheduledOccurrenceId).finally(() => {
        if (inFlightMonitorChecks.get(checkKey) === execution) {
            inFlightMonitorChecks.delete(checkKey);
        }
    });
    inFlightMonitorChecks.set(checkKey, execution);
    return execution;
}

async function runMonitorCheck(
    monitorId: number,
    scheduledOccurrenceId?: string,
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

    if (scheduledOccurrenceId !== undefined) {
        const recordedOccurrence = await prisma.monitorCheck.findUnique({
            where: {
                monitorId_scheduledOccurrenceId: {
                    monitorId,
                    scheduledOccurrenceId,
                },
            },
        });
        if (recordedOccurrence) {
            const latestCheck = await prisma.monitorCheck.findFirst({
                where: { monitorId },
                orderBy: [{ checkedAt: "desc" }, { id: "desc" }],
                select: { id: true },
            });
            if (latestCheck?.id === recordedOccurrence.id) {
                await processCheckConsequences(monitor, recordedOccurrence, true);
            }
            return recordedOccurrence;
        }
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

    let check;
    try {
        check = await prisma.monitorCheck.create({
            data: {
                monitorId: monitor.id,
                status,
                statusCode,
                latencyMs,
                errorMessage,
                ...(scheduledOccurrenceId === undefined ? {} : { scheduledOccurrenceId }),
            },
        });
    } catch (error) {
        if (!scheduledOccurrenceId || !isPrismaUniqueConstraintError(error)) throw error;

        // A concurrent worker may have committed this occurrence while this
        // process was performing the HTTP request. Reuse its durable result.
        const recordedOccurrence = await prisma.monitorCheck.findUnique({
            where: {
                monitorId_scheduledOccurrenceId: {
                    monitorId: monitor.id,
                    scheduledOccurrenceId,
                },
            },
        });
        if (!recordedOccurrence) throw error;
        const latestCheck = await prisma.monitorCheck.findFirst({
            where: { monitorId },
            orderBy: [{ checkedAt: "desc" }, { id: "desc" }],
            select: { id: true },
        });
        if (latestCheck?.id === recordedOccurrence.id) {
            await processCheckConsequences(monitor, recordedOccurrence, true);
        }
        return recordedOccurrence;
    }

    let monitorUpdatePublished = false;
    try {
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
        monitorUpdatePublished = true;
    } catch {
        console.error("Monitor update event could not be published", {
            monitorId: monitor.id,
        });
    }

    if (monitorUpdatePublished) {
        console.log(`Realtime update emitted for monitor: ${monitor.name}`);
    }

    await processCheckConsequences(monitor, check, scheduledOccurrenceId !== undefined);

    return check;
}

async function processCheckConsequences(
    monitor: { id: number },
    check: { id: number; status: string; latencyMs: number | null; checkedAt: Date },
    retryOnFailure: boolean,
) {
    try {
        await processIncident(monitor.id);
    } catch (error) {
        console.error("Availability incident processing failed after check was saved", {
            monitorId: monitor.id,
        });
        if (retryOnFailure) throw error;
    }

    try {
        await detectPerformanceDegradation(monitor.id, check);
    } catch (error) {
        console.error("Performance incident processing failed after check was saved", {
            monitorId: monitor.id,
        });
        if (retryOnFailure) throw error;
    }
}

export async function getUserMonitors(
    userId: number,
    pagination?: { limit: number; afterId?: number },
) {
    const monitors = await prisma.monitor.findMany({
        where: {
            userId,
        },

        orderBy: [{ createdAt: "desc" }, { id: "desc" }],

        ...(pagination === undefined ? {} : {
            take: pagination.limit + 1,
            ...(pagination.afterId === undefined ? {} : {
                cursor: { id: pagination.afterId },
                skip: 1,
            }),
        }),

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
