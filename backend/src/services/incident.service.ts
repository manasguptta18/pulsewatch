import {prisma} from "../lib/prisma.js";
import { triggerIncidentAlerts } from "./alert.service.js";
import { getIO } from "../lib/socket.js";

export async function processIncident(monitorId: number){
    const recentChecks = await prisma.monitorCheck.findMany({
        where:{
            monitorId,
        },
        orderBy:{
            checkedAt: "desc",
        },
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
                const incident  = await prisma.incident.create({
                    data:{
                        monitorId,
                        type: "AVAILABILITY",
                        reason: "3 consecutive monitor checks failed",
                    },
                });
                
                await triggerIncidentAlerts(incident.id);
                const io = getIO();

                if(io){
                    io.emit("incident:created",{
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
                    `Availability incident created for monitor: ${monitorId}`
                );
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
            const resolvedIncident = await prisma.incident.update({
                where:{
                    id : ongoingIncident.id,
                },
                data:{
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
                `Availability incident resolved for monitor: ${monitorId}`
            );
        }
    }
}