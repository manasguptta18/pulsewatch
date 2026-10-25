import {prisma} from "../lib/prisma.js";
import { emitToUser } from "../lib/socket.js";
import { createIncidentWithNotificationIntents } from "./incident.persistence.js";

export async function processIncident(monitorId: number){
    const recentChecks = await prisma.monitorCheck.findMany({
        where:{
            monitorId,
        },
        orderBy: [{ checkedAt: "desc" }, { id: "desc" }],
        take: 3,
    });

    if(recentChecks.length>=3){
        const allFailed = recentChecks.every((check)=> check.status ==="DOWN");

        if(allFailed){
            const ongoingIncident = await prisma.incident.findFirst({
                where:{
                    monitorId,
                    status: "ONGOING",
                    type: "AVAILABILITY",
                },
            }); 

            if(!ongoingIncident){
                const { incident, created } = await createIncidentWithNotificationIntents({
                    monitorId,
                    type: "AVAILABILITY",
                    reason: "3 consecutive monitor checks failed",
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
                if (created) {
                    console.log(`Availability incident created for monitor: ${monitorId}`);
                }
            }
        }
    }

    const latestCheck = recentChecks[0];
    if(latestCheck?.status === "UP"){
        const ongoingIncident = await prisma.incident.findFirst({
            where: {
                monitorId,
                status: "ONGOING",
                type: "AVAILABILITY",
            },
        });

        if(ongoingIncident){
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
                if (resolvedIncident) {
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
                }
            }

            if (transition.count === 1) {
                console.log(`Availability incident resolved for monitor: ${monitorId}`);
            }
        }
    }
}
