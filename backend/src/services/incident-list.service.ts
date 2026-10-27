import { prisma } from "../lib/prisma.js";

export interface IncidentListOptions {
    limit: number;
    afterId?: number;
    status?: "ONGOING" | "RESOLVED";
    type?: "AVAILABILITY" | "PERFORMANCE";
}

export async function listUserIncidents(userId: number, options: IncidentListOptions) {
    return prisma.incident.findMany({
        where: {
            monitor: { is: { userId } },
            ...(options.afterId ? { id: { lt: options.afterId } } : {}),
            ...(options.status ? { status: options.status } : {}),
            ...(options.type ? { type: options.type } : {}),
        },
        select: {
            id: true,
            monitorId: true,
            type: true,
            status: true,
            reason: true,
            startedAt: true,
            resolvedAt: true,
            monitor: { select: { id: true, name: true } },
        },
        orderBy: { id: "desc" },
        take: options.limit + 1,
    });
}
