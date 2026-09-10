import {prisma} from '../lib/prisma.js';

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