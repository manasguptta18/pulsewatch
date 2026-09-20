import {prisma} from "../lib/prisma.js";
import {sendIncidentEmail} from "./email.service.js";

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
        if(alertRule.type==="EMAIL"){
            await sendIncidentEmail(
                alertRule.destination,
                incident.monitor.name,
                incident.type,
                incident.reason ?? "No reason provided"
            );
        }
    }
}