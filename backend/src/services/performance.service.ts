import { prisma } from "../lib/prisma.js";

export async function detectPerformanceDegradation(
    monitorId: number
) {
    const recentChecks = await prisma.monitorCheck.findMany({
        where: {
            monitorId,
            status: "UP",
            latencyMs: {
                not: null,
            },
        },
        orderBy: {
            checkedAt: "desc",
        },
        take: 6,
    });

    if (recentChecks.length < 6) {
        return;
    }

    const currentCheck = recentChecks[0];
    if (!currentCheck) {
        return;
    }


    if (currentCheck.latencyMs === null) {
        return;
    }

    const previousChecks = recentChecks.slice(1);

    const totalLatency = previousChecks.reduce(
        (sum, check) => sum + (check.latencyMs ?? 0),
        0
    );

    const averageLatency =
        totalLatency / previousChecks.length;

     const ongoingIncident = await prisma.incident.findFirst({
            where: {
                monitorId,
                status: "ONGOING",
                type: "PERFORMANCE",
            },
        });


    if (
        averageLatency > 0 &&
        currentCheck.latencyMs >= averageLatency * 2
    ) {
        if (!ongoingIncident) {
            await prisma.incident.create({
                data: {
                    monitorId,
                    type: "PERFORMANCE",
                    reason: `Latency increased to ${currentCheck.latencyMs}ms. Previous average was ${Math.round(
                        averageLatency
                    )}ms.`,
                },
            });
                
            console.log(
                `Performance degradation detected for monitor: ${monitorId}`
            );
        }
    }

    if(ongoingIncident && currentCheck.latencyMs < averageLatency*2){
        await prisma.incident.update({
            where:{
                id: ongoingIncident.id,
            },
            data:{
                status: "RESOLVED",
                resolvedAt: new Date(),
            },
        });

        console.log(`Performance incident resolved for monitor: ${monitorId}`);
    }
}