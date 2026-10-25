import { prisma } from "../lib/prisma.js";

export interface NewIncidentData {
    monitorId: number;
    type: string;
    reason: string;
    startedAt?: Date;
    baselineLatencyMs?: number;
}

function isUniqueConstraintError(error: unknown): boolean {
    return typeof error === "object" && error !== null &&
        "code" in error && error.code === "P2002";
}

/**
 * Persist an incident and its email intents together. The PostgreSQL partial
 * unique index is the final guard against concurrent incident creation.
 */
export async function createIncidentWithNotificationIntents(data: NewIncidentData) {
    try {
        return await prisma.$transaction(async (transaction) => {
            const incident = await transaction.incident.create({
                data,
                include: {
                    monitor: { select: { userId: true, name: true } },
                },
            });
            const alertRules = await transaction.alertRule.findMany({
                where: { monitorId: data.monitorId, isActive: true, type: "EMAIL" },
                select: { id: true, destination: true },
            });

            if (alertRules.length > 0) {
                await transaction.notificationOutbox.createMany({
                    data: alertRules.map((rule) => ({
                        dedupeKey: `incident:${incident.id}:email:${rule.id}`,
                        channel: "EMAIL",
                        destination: rule.destination,
                        payload: {
                            monitorName: incident.monitor.name,
                            incidentType: incident.type,
                            reason: incident.reason ?? "No reason provided",
                        },
                        incidentId: incident.id,
                    })),
                    skipDuplicates: true,
                });
            }

            return { incident, created: true };
        });
    } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;

        // A competing process may have created the ongoing incident first.
        const existing = await prisma.incident.findFirst({
            where: {
                monitorId: data.monitorId,
                type: data.type,
                status: "ONGOING",
            },
            include: { monitor: { select: { userId: true, name: true } } },
        });
        if (!existing) throw error;
        return { incident: existing, created: false };
    }
}
