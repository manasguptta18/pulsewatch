import { prisma } from "../lib/prisma.js";
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

    const ongoingIncident = await prisma.incident.findFirst({
        where: {
            monitorId,
            status: "ONGOING",
            type: "PERFORMANCE",
        },
    });

    // --------------------------------
    // CASE 1: Incident already exists
    // --------------------------------

    if (ongoingIncident) {
        const baselineLatency =
            ongoingIncident.baselineLatencyMs;

        if (baselineLatency === null) {
            return;
        }

        if (currentCheck.latencyMs < baselineLatency * 2) {
            await prisma.incident.update({
                where: {
                    id: ongoingIncident.id,
                },
                data: {
                    status: "RESOLVED",
                    resolvedAt: new Date(),
                },
            });

            console.log(
                `Performance incident resolved for monitor: ${monitorId}`
            );
        }

        return;
    }

    // --------------------------------
    // CASE 2: No incident exists
    // --------------------------------

    const previousChecks = await prisma.monitorCheck.findMany({
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

    const totalLatency = previousChecks.reduce(
        (sum, check) => sum + (check.latencyMs ?? 0),
        0
    );

    const averageLatency =
        totalLatency / previousChecks.length;

    if (
        averageLatency > 0 &&
        currentCheck.latencyMs >= averageLatency * 2
    ) {
        const incident = await prisma.incident.create({
            data: {
                monitorId,
                type: "PERFORMANCE",
                reason: `Latency increased to ${currentCheck.latencyMs}ms. Previous average was ${Math.round(
                    averageLatency
                )}ms.`,
                baselineLatencyMs: Math.round(averageLatency),
                startedAt: currentCheck.checkedAt,
            },
        });

        await triggerIncidentAlerts(incident.id);

        console.log(
            `Performance degradation detected for monitor: ${monitorId}`
        );
    }
}