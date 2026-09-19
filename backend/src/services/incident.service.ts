import {prisma} from "../lib/prisma.js";
import { triggerIncidentAlerts } from "./alert.service.js";

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

                console.log(`Incident created for monitor: ${monitorId}`);
            }
        }
    }

    const latestCheck = recentChecks[0];
    if(latestCheck?.status === "UP"){
        const ongoingIncident = await prisma.incident.findFirst({
            where: {
                monitorId,
                status: "ONGOING",
            },
        });

        if(ongoingIncident){
            await prisma.incident.update({
                where:{
                    id : ongoingIncident.id,
                },
                data:{
                    status: "Resolved",
                    resolvedAt: new Date(),
                },
            });

            console.log(`Incident resolved for monitor: ${monitorId}`);
        }
    }
}