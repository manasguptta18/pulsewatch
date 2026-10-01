import { prisma } from "../lib/prisma.js";
import { getIO } from "../lib/socket.js";
import { triggerIncidentAlerts } from "./alert.service.js";

export async function detectPerformanceDegradation(
    monitorId: number,
    currentCheck: {
        id: number;
        status: string;
        latencyMs: number | null;
        checkedAt: Date;
    }
) {
    if (currentCheck.status !== "UP") {
        return;
    }

    if (currentCheck.latencyMs === null) {
        return;
    }

  
    const ongoingIncident =
        await prisma.incident.findFirst({
            where: {
                monitorId,
                status: "ONGOING",
                type: "PERFORMANCE",
            },
        });

    if (ongoingIncident) {
        const baselineLatency =
            ongoingIncident.baselineLatencyMs;

        if (baselineLatency === null) {
            return;
        }

        if (
            currentCheck.latencyMs <
            baselineLatency * 2
        ) {
            const resolvedIncident =
                await prisma.incident.update({
                    where: {
                        id: ongoingIncident.id,
                    },
                    data: {
                        status: "RESOLVED",
                        resolvedAt: new Date(),
                    },
                });

           
            const io = getIO();

            if (io) {
                io.emit("incident:resolved", {
                    incidentId:
                        resolvedIncident.id,
                    monitorId:
                        resolvedIncident.monitorId,
                    type:
                        resolvedIncident.type,
                    status:
                        resolvedIncident.status,
                    resolvedAt:
                        resolvedIncident.resolvedAt
                            ?.toISOString() ?? null,
                });

                console.log(
                    `Realtime incident:resolved emitted for monitor: ${monitorId}`
                );
            }

            console.log(
                `Performance incident resolved for monitor: ${monitorId}`
            );
        }

        return;
    }

    const previousChecks =
        await prisma.monitorCheck.findMany({
            where: {
                monitorId,
                status: "UP",
                latencyMs: {
                    not: null,
                },
                checkedAt: {
                    lt: currentCheck.checkedAt,
                },
            },
            orderBy: {
                checkedAt: "desc",
            },
            take: 5,
        });

    if (previousChecks.length < 5) {
        return;
    }

    const totalLatency =
        previousChecks.reduce(
            (sum, check) =>
                sum + (check.latencyMs ?? 0),
            0
        );

    const averageLatency =
        totalLatency /
        previousChecks.length;

    
    if (
        averageLatency > 0 &&
        currentCheck.latencyMs >=
            averageLatency * 2
    ) {
        const incident =
            await prisma.incident.create({
                data: {
                    monitorId,
                    type: "PERFORMANCE",
                    reason: `Latency increased to ${currentCheck.latencyMs}ms. Previous average was ${Math.round(
                        averageLatency
                    )}ms.`,
                    baselineLatencyMs:
                        Math.round(
                            averageLatency
                        ),
                    startedAt:
                        currentCheck.checkedAt,
                },
            });

        await triggerIncidentAlerts(
            incident.id
        );

        
        const io = getIO();

        if (io) {
            io.emit("incident:created", {
                incidentId: incident.id,
                monitorId: incident.monitorId,
                type: incident.type,
                status: incident.status,
                reason: incident.reason,
                startedAt:
                    incident.startedAt.toISOString(),
            });

            console.log(
                `Realtime incident:created emitted for monitor: ${monitorId}`
            );
        }

        console.log(
            `Performance degradation detected for monitor: ${monitorId}`
        );
    }
}