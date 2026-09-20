import {prisma} from '../lib/prisma.js';
import {processIncident} from "./incident.service.js";
import { detectPerformanceDegradation } from "./performance.service.js";

export async function createMonitor(data:{
    userId: number;
    name: string;
    url: string;
}) {
    const monitor = await prisma.monitor.create({
        data: {
            userId: data.userId,
            name: data.name,
            url: data.url,
        },
    });

    return monitor;
}

export async function checkMonitor(monitorId: number){
    const monitor = await prisma.monitor.findUnique({
        where:{
            id: monitorId,
        },
    });

    if(!monitor){
        throw new Error("Monitor not found");
    }

    const startTime = Date.now();

    let status = "DOWN";
    let statusCode: number | null = null;
    let latencyMs: number| null = null;
    let errorMessage: string | null = null;

    try{
        const response = await fetch(monitor.url, {
            method: monitor.method,
            signal: AbortSignal.timeout(monitor.timeoutSeconds * 1000),
        });

        const endTime = Date.now();

        statusCode = response.status;
        latencyMs = endTime - startTime;

        if(response.status === monitor.expectedStatus){
            status = "UP";
        }
        else{
            status = "DOWN";
            errorMessage = `Expected status ${monitor.expectedStatus}, got ${response.status}`;
        }
    }catch(error){
        const endTime = Date.now();

        latencyMs = endTime - startTime;

        if(error instanceof Error){
            errorMessage = error.message;
        }
        else{
            errorMessage = "Unknown error";
        }
    }

    const check = await prisma.monitorCheck.create({
        data: {
            monitorId: monitor.id,
            status,
            statusCode,
            latencyMs,
            errorMessage,
        },
    });

    await processIncident(monitor.id);
    await detectPerformanceDegradation(monitor.id , check);

    return check;
}