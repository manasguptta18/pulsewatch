import {prisma} from "../lib/prisma.js";

export async function triggerIncidentAlerts(incidentId: number){
    const incident = await prisma.incident.findUnique({
        where:{
            id: incidentId,
        },
        include:{
            monitor: true,
        },
    });

    if(!incident){
        throw new Error("Incident not found");
    }

    const alertRules = await prisma.alertRule.findMany({
        where:{
            monitorId : incident.monitorId,
            isActive: true,
        },
    });

    for(const alertRule of alertRules){
        console.log("ALERT TRIGGERED");

        console.log(`Monitor: ${incident.monitor.name}`);
        console.log(`Incident type: ${incident.type}`);
        console.log(`Destination: ${alertRule.destination}`);
        console.log(`Alert type: ${alertRule.type}`);
        console.log(`Reason: ${incident.reason}`);
    }
}