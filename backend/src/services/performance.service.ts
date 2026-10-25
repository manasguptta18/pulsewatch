import { prisma } from "../lib/prisma.js";
import { emitToUser } from "../lib/socket.js";
import { createIncidentWithNotificationIntents } from "./incident.persistence.js";

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
        const baselineLatency = ongoingIncident.baselineLatencyMs === null
            ? null
            : Math.max(1, ongoingIncident.baselineLatencyMs);

        if (baselineLatency === null) {
            return;
        }

        if (
            currentCheck.latencyMs <
            baselineLatency * 2
        ) {
            const resolvedAt = new Date();
            const transition = await prisma.incident.updateMany({
                where: { id: ongoingIncident.id, status: "ONGOING" },
                data: { status: "RESOLVED", resolvedAt },
            });
            if (transition.count === 1) {
                const resolvedIncident = await prisma.incident.findUnique({
                    where: { id: ongoingIncident.id },
                    include: { monitor: { select: { userId: true } } },
                });
                if (!resolvedIncident) return;

                try {
                    emitToUser(resolvedIncident.monitor.userId, "incident:resolved", {
                        incidentId: resolvedIncident.id,
                        monitorId: resolvedIncident.monitorId,
                        type: resolvedIncident.type,
                        status: resolvedIncident.status,
                        resolvedAt: resolvedIncident.resolvedAt?.toISOString() ?? null,
                    });
                } catch {
                    console.error("Incident resolved event could not be published", {
                        incidentId: resolvedIncident.id,
                    });
                }
                console.log(`Performance incident resolved for monitor: ${monitorId}`);
            }
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
        const { incident, created } = await createIncidentWithNotificationIntents({
            monitorId,
            type: "PERFORMANCE",
            reason: `Latency increased to ${currentCheck.latencyMs}ms. Previous average was ${Math.round(
                averageLatency
            )}ms.`,
            baselineLatencyMs: Math.max(1, Math.round(averageLatency)),
            startedAt: currentCheck.checkedAt,
        });

        if (created) {
            try {
                emitToUser(incident.monitor.userId, "incident:created", {
                    incidentId: incident.id,
                    monitorId: incident.monitorId,
                    type: incident.type,
                    status: incident.status,
                    reason: incident.reason,
                    startedAt: incident.startedAt.toISOString(),
                });
            } catch {
                console.error("Incident created event could not be published", {
                    incidentId: incident.id,
                });
            }
        }

        console.log(
            `Performance degradation detected for monitor: ${monitorId}`
        );
    }
}
