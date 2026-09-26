import {prisma} from "../lib/prisma.js";

export async function investigationfunction(incidentId: number){
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

    if(incident.type==="PERFORMANCE"){
        const incidentChecks = await prisma.monitorCheck.findMany({
            where:{
                monitorId: incident.monitorId,
                checkedAt:{
                    gte: incident.startedAt,
                    lte: incident.resolvedAt ?? new Date(),
                },
            },
            orderBy:{
                checkedAt: "asc",
            },
            take: 10,
        });

        const firstIncidentCheck = incidentChecks[0];

        const baselineLatency = incident.baselineLatencyMs;

        if(baselineLatency !== null && firstIncidentCheck?.latencyMs !==null && firstIncidentCheck?.latencyMs !== undefined){
            const increasePercent = Math.round(((firstIncidentCheck.latencyMs - baselineLatency)/ baselineLatency)*100);

            return {
                incidentId: incident.id,
                monitorName: incident.monitor.name,
                type: incident.type,
                status: incident.status,

                hypothesis: "PERFORMANCE_DEGRADATION",

                summary: `Response latency increased from about ${baselineLatency}ms to ${firstIncidentCheck.latencyMs}ms.`,

                evidence: [
                    `Normal baseline latency: ${baselineLatency}ms`,
                    `Incident-start latency: ${firstIncidentCheck.latencyMs}ms`,
                    `Latency increased by approximately ${increasePercent}%`,
                    `The endpoint returned an expected HTTP response, so the service was reachable.`,
                ],

                recommendedChecks: [
                    "Check application logs for slow operations",
                    "Check database query latency",
                    "Check CPU and memory usage",
                    "Check for recent deployments or configuration changes",
                ],
            };
        }

        return {
            incidentId: incident.id,
            monitorName: incident.monitor.name,
            type: incident.type,
            status: incident.status,

            hypothesis: "PERFORMANCE_DEGRADATION",

            summary:
                "The monitor detected unusually high response latency.",

            evidence: [
                `Normal baseline latency: ${
                    baselineLatency ?? "unknown"
                }ms`,
            ],

            recommendedChecks: [
                "Check application logs",
                "Check database latency",
                "Check infrastructure metrics",
            ],
        };
    }

    if(incident.type === "AVAILABILITY"){
        const failedChecks = await prisma.monitorCheck.findMany({
            where: {
                monitorId: incident.monitorId,
                status: "DOWN",
                checkedAt: {
                    lte: incident.startedAt,
                },
            },
            orderBy: {
                checkedAt: "desc",
            },
            take: 3,
        });

        const serverErrors = failedChecks.filter(
            (check)=>
                check.statusCode !==null && check.statusCode >=500
        ).length;

        const timeoutOrNetworkErrors = failedChecks.filter(
            (check) => check.statusCode === null
        ).length;

        let hypothesis = "AVAILABILITY_FAILURE"; 

        if (serverErrors > 0) {
            hypothesis = "POSSIBLE_SERVER_SIDE_FAILURE";
        } else if (timeoutOrNetworkErrors > 0) {
            hypothesis = "POSSIBLE_TIMEOUT_OR_CONNECTIVITY_ISSUE";
        }

         return {
            incidentId: incident.id,
            monitorName: incident.monitor.name,
            type: incident.type,
            status: incident.status,

            hypothesis,

            summary: `The monitor experienced ${failedChecks.length} failed checks before the availability incident.`,

            evidence: failedChecks.map(
                (check) =>
                    `Status: ${check.status}, HTTP status: ${
                        check.statusCode ?? "none"
                    }, Error: ${
                        check.errorMessage ?? "none"
                    }`
            ),

            recommendedChecks: [
                "Check application logs",
                "Check server and infrastructure health",
                "Check DNS and network connectivity",
                "Check for recent deployments or configuration changes",
            ],
        };
    }

    return {
        incidentId: incident.id,
        monitorName: incident.monitor.name,
        type: incident.type,
        status: incident.status,
        hypothesis: "UNKNOWN",
        summary:
            "No investigation logic is available for this incident type.",
        evidence: [],
        recommendedChecks: [],
    };
}